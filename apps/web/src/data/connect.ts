/**
 * Picks how this device reaches the PC, without the person having to think:
 *
 *  1. Paired on this device (same Wi-Fi): connect directly. Fastest, and add-on
 *     screens (EFB, GSX) can show inside Glidepath.
 *  2. Signed in, and a PC is signed in to the same account: go through the
 *     account relay ("Connect anywhere"). Works on any Wi-Fi or mobile data.
 *     Used when there's no direct pairing, or the direct link isn't live
 *     within a few seconds (different Wi-Fi, router blocking, firewall…).
 */
import { activeBridge, BridgeClient, setActiveBridge } from "./bridge";
import { cloudStore, relayStatus, relayTarget } from "./cloud";
import { settingsStore, store } from "./store";

let started = false;
let stuckSince = 0;
let lastCheck = 0;
let checking = false;
let account: string | null = null;

/** Switch to the account relay if a PC is signed in to this account. Returns true if it did. */
export async function tryRelay(): Promise<boolean> {
  const t = relayTarget();
  if (!t || checking || store.get().mode === "demo") return false;
  const cur = activeBridge();
  if (cur?.isRelay) return true;
  checking = true; lastCheck = Date.now();
  try {
    const st = await relayStatus();
    if (!st?.linked) return false;
    const now = activeBridge();
    if (store.get().mode === "demo" || (now && !now.isRelay && store.get().conn === "live")) return false;
    setActiveBridge(new BridgeClient(location.origin, t.token, t));
    return true;
  } finally { checking = false; }
}

/* ---- Same Wi-Fi: find this PC again by itself when its address changes (like a router handing out a new one) ---- */
const KNOWN = "glidepath.knownBridge";
interface Known { id: string; host: string; urls: string[] }
const readKnown = (): Known | null => { try { return JSON.parse(localStorage.getItem(KNOWN) ?? "null") as Known | null; } catch { return null; } };
let lastSeek = 0, seeking = false;
function remember(b: BridgeClient): void {
  const st = store.get().status;
  if (!st?.bridgeId || b.isRelay) return;
  const k = readKnown();
  const urls = [b.base, ...(k && k.id === st.bridgeId ? k.urls : [])].filter((u, i, a) => a.indexOf(u) === i).slice(0, 6);
  if (k && k.id === st.bridgeId && k.urls[0] === b.base && k.host === st.hostname) return;
  try { localStorage.setItem(KNOWN, JSON.stringify({ id: st.bridgeId, host: st.hostname, urls })); } catch { /* storage off */ }
}
async function seekBridge(): Promise<void> {
  const k = readKnown(), token = settingsStore.get().token;
  if (!k || !token || seeking) return;
  // A page on https can't reach a PC on http; the account link covers that case.
  if (location.protocol === "https:") return;
  seeking = true; lastSeek = Date.now();
  try {
    const port = (() => { try { return new URL(k.urls[0]!).port || "4810"; } catch { return "4810"; } })();
    const names = [k.host, "glidepath"].filter(Boolean).map((h) => `http://${h.toLowerCase().replace(/[^a-z0-9-]/g, "-")}.local:${port}`);
    const current = activeBridge()?.base;
    for (const u of [...k.urls, ...names].filter((x, i, a) => a.indexOf(x) === i && x !== current)) {
      try {
        const r = await fetch(`${u}/healthz`, { signal: AbortSignal.timeout(2500), cache: "no-store" });
        const j = (await r.json()) as { bridgeId?: string };
        if (j.bridgeId !== k.id) continue;
        settingsStore.set({ bridgeUrl: u });
        setActiveBridge(new BridgeClient(u, token));
        return;
      } catch { /* not there */ }
    }
  } finally { seeking = false; }
}

export function initAutoConnect(): void {
  if (started) return;
  started = true;
  // Remember the PC each time it's live; look for it if the link stays down.
  window.setInterval(() => {
    const b = activeBridge();
    if (!b || store.get().mode === "demo") return;
    if (store.get().conn === "live") { remember(b); return; }
    if (!b.isRelay && Date.now() - lastSeek > 15_000) void seekBridge();
  }, 5000);
  window.setInterval(() => {
    if (store.get().mode === "demo" || !relayTarget()) { stuckSince = 0; return; }
    const b = activeBridge();
    if (b?.isRelay) { stuckSince = 0; return; }
    if (b && store.get().conn === "live") { stuckSince = 0; return; }
    if (!stuckSince) { stuckSince = Date.now(); return; }
    // Direct link not live for 6 s (or no PC at all): try the relay. Re-check at most every 45 s.
    if (Date.now() - stuckSince > 6000 && Date.now() - lastCheck > (b ? 6000 : 45_000)) void tryRelay();
  }, 2000);
  // Switching or signing out of an account: drop a relay link that belonged to the old one.
  cloudStore.subscribe(() => {
    const a = cloudStore.get().active;
    if (a === account) return;
    const was = account;
    account = a;
    if (was !== null && activeBridge()?.isRelay) { setActiveBridge(null); store.reset("none"); }
    // With a direct link starting up, give it its 6 s first (same Wi-Fi is faster and shows add-on screens).
    if (a && !activeBridge()) { lastCheck = 0; void tryRelay(); }
  });
}
