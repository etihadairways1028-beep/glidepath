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
    if (!base) throw new Error("Couldn't find your PC from that code. Check the Bridge is open on your PC (version 0.8 or newer) and the code matches, or type your PC's address below.");
  }
  let r: Response;
  try {
    r = await fetch(`${base}/api/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  } catch {
    throw new Error("Found your PC but couldn't reach it. Make sure this device is on the same Wi-Fi as the PC. If it still fails, your router may block this: open Safari and go to glidepath.local:4810 instead.");
  }
  const j = await r.json().catch(() => ({})) as { token?: string; error?: string };
  if (!r.ok || !j.token) throw new Error(j.error ?? "Your PC didn't accept the code. Check it and try again.");
  settingsStore.set({ bridgeUrl: base, token: j.token });
}
