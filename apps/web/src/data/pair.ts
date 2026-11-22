/**
 * Pair this device with a PC using the 6-digit code from the Bridge window.
 *
 * - App opened from the Bridge itself (http://<pc>:4810/app): ask it directly.
 * - App opened from the Glidepath website (https): find the PC's secure address
 *   (https://192-168-x-x.local-ip.sh:4811) from the ntfy.sh topic the Bridge
 *   posts it to, or from the address the person types, then pair over HTTPS.
 *   The website can't reach a plain-http PC, so this secure address is the way in.
 */
import { settingsStore } from "./store";
import { cloudBases } from "./cloud";

const onBridge = () => location.protocol === "http:" && location.pathname.startsWith("/app");

async function topicFor(code: string): Promise<string> {
  const data = new TextEncoder().encode(`glidepath:${code}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return `glidepath-${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24)}`;
}

/** "192.168.1.20" (or with :4810) -> the PC's secure address. */
export function secureBaseFromAddress(addr: string): string | null {
  const m = /(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})/.exec(addr.trim());
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return `https://${parts.join("-")}.local-ip.sh:4811`;
}

/** "https://192-168-1-20.local-ip.sh:4811" -> "192.168.1.20". */
function plainAddress(base: string): string | null {
  const m = /\/\/(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\.local-ip\.sh/.exec(base);
  return m ? m.slice(1, 5).join(".") : null;
}

async function findPc(code: string): Promise<string | null> {
  try {
    const r = await fetch(`https://ntfy.sh/${await topicFor(code)}/json?poll=1&since=24h`, { cache: "no-store" });
    if (!r.ok) return null;
    const lines = (await r.text()).trim().split("\n").filter(Boolean);
    for (const line of lines.reverse()) {
      try {
        const msg = JSON.parse(JSON.parse(line).message) as { h?: string; p?: number };
        if (msg.h && /^[\d-]+\.local-ip\.sh$/.test(msg.h) && msg.p) return `https://${msg.h}:${msg.p}`;
      } catch { /* skip */ }
    }
  } catch { /* fall through */ }
  return null;
}

/** Pairs and saves the PC. Throws an Error with a message meant for the person. */
export async function pairWithCode(rawCode: string, address?: string): Promise<void> {
  const code = rawCode.replace(/\D/g, "");
  if (code.length !== 6) throw new Error("The code has 6 numbers. Check the Glidepath Bridge window on your PC.");
  let base: string | null;
  if (onBridge()) base = location.origin;
  else if (address?.trim()) {
    base = secureBaseFromAddress(address);
    if (!base) throw new Error("That address doesn't look right. It's four numbers like 192.168.1.20, shown in the Bridge window.");
  } else {
    base = await findPc(code);
    if (!base && await pairViaRelay(code)) return;
    if (!base) throw new Error("Couldn't find your PC from that code. Check the Bridge is open on your PC and the code matches, or type your PC's address below.");
  }
  let r: Response;
  try {
    r = await fetch(`${base}/api/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(6000) });
  } catch {
    // Many routers (and iCloud Private Relay) block the secure local name even on the same Wi-Fi.
    // Pair through the Glidepath relay instead, and stay on this page.
    if (await pairViaRelay(code)) return;
    // Never leave this page: tell the pilot what to do instead.
    throw new Error("Found your PC, but couldn't connect to it from this network. Open Glidepath on the PC once so the Bridge updates itself (it does when MSFS is closed), then try the code again. Or sign in with the same Glidepath account on both.");
  }
  const j = await r.json().catch(() => ({})) as { token?: string; error?: string };
  if (!r.ok || !j.token) throw new Error(j.error ?? "Your PC didn't accept the code. Check it and try again.");
  settingsStore.set({ bridgeUrl: base, token: j.token, pcRelay: null });
}

/**
 * Pair through the Glidepath relay: find the PC by its code, then send the code to it there.
 * The PC checks the code itself (wrong codes count towards its lockout). Returns false if this
 * PC's Bridge doesn't have the relay (older versions) or the service can't be reached.
 */
export async function pairViaRelay(code: string): Promise<boolean> {
  const urls = cloudBases();
  if (!urls.length) return false;
  let bid: string | null = null, lastErr: string | null = null;
  for (const u of urls) {
    try {
      const r = await fetch(`${u}/pc/find?code=${code}`, { signal: AbortSignal.timeout(8000) });
      const j = await r.json().catch(() => ({})) as { bid?: string; error?: string };
      if (r.ok && j.bid) { bid = j.bid; break; }
      if (r.status === 429 || r.status === 404) { lastErr = j.error ?? null; break; }
    } catch { /* try the next address */ }
  }
  if (!bid) { if (lastErr && /Too many/.test(lastErr)) throw new Error(lastErr); return false; }
  const token = await new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(`${urls[0]!.replace(/^http/, "ws")}/relay/pcapp?bid=${encodeURIComponent(bid!)}`);
    const done = (e: Error | null, t?: string) => { clearTimeout(timer); try { ws.close(); } catch { /* closed */ } if (e) reject(e); else resolve(t!); };
    const timer = window.setTimeout(() => done(new Error("Your PC didn't answer. Check Glidepath is open on the PC and try again.")), 15000);
    let sent = false;
    ws.onmessage = (ev) => {
      let m: { $?: string; online?: boolean; id?: string; status?: number; text?: string };
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.$ === "bridge" && m.online && !sent) { sent = true; ws.send(JSON.stringify({ $: "req", id: "pair", method: "POST", path: "/api/pair", body: { code } })); }
      else if (m.$ === "bridge" && !m.online) done(new Error("Your PC isn't online right now. Open Glidepath on the PC and try again."));
      else if (m.$ === "res" && m.id === "pair") {
        let j: { token?: string; error?: string } = {};
        try { j = JSON.parse(m.text ?? "{}"); } catch { /* not json */ }
        if (m.status === 200 && j.token) done(null, j.token);
        else done(new Error(j.error ?? "Your PC didn't accept the code. Check it and try again."));
      }
    };
    ws.onerror = () => done(new Error("Couldn't reach Glidepath. Check your internet connection."));
  });
  settingsStore.set({ token, pcRelay: bid, bridgeUrl: "" });
  return true;
}
