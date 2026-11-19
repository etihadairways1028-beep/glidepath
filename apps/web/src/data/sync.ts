/**
 * Your choices follow you across devices: map style, traffic layers, units, theme, alerts,
 * SimBrief name and runway/procedure picks, through your Glidepath account. The newest copy wins.
 * Device-only settings (Bridge address, spoken callouts, glass level, your own photo) stay on each device.
 */
import { settingsStore, type Settings } from "./store";
import { authed, cloudStore, signedIn } from "./cloud";

const SYNCED: Array<keyof Settings> = ["simbriefUser", "showVatsim", "showIvao", "showSayIntentions", "showSimTraffic", "fuelUnit", "accent", "theme", "wallpaper", "mapStyle", "map3d", "flightMessages", "approachCoach", "lightMessages", "atcAlerts", "showAtc", "showRadar", "showMetars"];
const STAMP = "glidepath.syncAt";
interface Blob { settings: Partial<Settings>; procs: Record<string, unknown> }

const stamp = () => { try { return Number(localStorage.getItem(STAMP) ?? "0") || 0; } catch { return 0; } };
const setStamp = (t: number) => { try { localStorage.setItem(STAMP, String(t)); } catch { /* ignore */ } };

function collect(): Blob {
  const s = settingsStore.get();
  const settings: Partial<Settings> = {};
  for (const k of SYNCED) (settings as Record<string, unknown>)[k] = s[k];
  if (settings.wallpaper === "photo") delete settings.wallpaper; // the photo itself lives on this device only
  const procs: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length && Object.keys(procs).length < 30; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("glidepath.procs.")) procs[k.slice(16)] = JSON.parse(localStorage.getItem(k) ?? "{}");
    }
  } catch { /* ignore */ }
  return { settings, procs };
}

let applying = false, pending = 0, busy = false;
function apply(b: Blob) {
  applying = true;
  try {
    const patch: Partial<Settings> = {};
    for (const k of SYNCED) if (k in (b.settings ?? {}) && (b.settings as Record<string, unknown>)[k] !== undefined) (patch as Record<string, unknown>)[k] = (b.settings as Record<string, unknown>)[k];
    if (patch.wallpaper === "photo") delete patch.wallpaper;
    const cur = settingsStore.get();
    if (Object.entries(patch).some(([k, v]) => (cur as unknown as Record<string, unknown>)[k] !== v)) settingsStore.set(patch, { remote: true });
    let procsChanged = false;
    for (const [dep, c] of Object.entries(b.procs ?? {})) {
      const key = `glidepath.procs.${dep}`, v = JSON.stringify(c);
      try { if (localStorage.getItem(key) !== v) { localStorage.setItem(key, v); procsChanged = true; } } catch { /* ignore */ }
    }
    if (procsChanged) window.dispatchEvent(new Event("glidepath-procs"));
  } finally { applying = false; }
}

async function push() {
  pending = 0;
  if (!signedIn()) return;
  const at = Date.now();
  try { const r = await authed<{ updatedAt: number }>("/me/sync", "PUT", { data: collect(), updatedAt: at }); setStamp(r.updatedAt ?? at); } catch { /* offline: the next change or pull tries again */ }
}
function schedulePush() {
  if (applying || !signedIn()) return;
  window.clearTimeout(pending);
  pending = window.setTimeout(() => void push(), 1500);
}

export async function pullSync(): Promise<void> {
  if (!signedIn() || busy || pending) return; // a change of ours is about to go up: don't overwrite it
  busy = true;
  try {
    const r = await authed<{ data: Blob | null; updatedAt: number }>("/me/sync");
    if (r.data && r.updatedAt > stamp()) { apply(r.data); setStamp(r.updatedAt); }
    else if (!r.data) void push(); // first device on this account: start the copy from here
  } catch { /* offline */ } finally { busy = false; }
}

let started = false;
export function initSync(): void {
  if (started) return;
  started = true;
  settingsStore.onLocalChange((patch) => { if (Object.keys(patch).some((k) => SYNCED.includes(k as keyof Settings))) schedulePush(); });
  window.addEventListener("glidepath-procs-local", schedulePush);
  window.addEventListener("focus", () => void pullSync());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void pullSync(); });
  window.setInterval(() => { if (document.visibilityState === "visible") void pullSync(); }, 20_000);
  let lastActive = cloudStore.get().active;
  cloudStore.subscribe(() => { const a = cloudStore.get().active; if (a !== lastActive) { lastActive = a; setStamp(0); void pullSync(); } });
  void pullSync();
}
