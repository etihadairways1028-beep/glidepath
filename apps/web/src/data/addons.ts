/**
 * Which cockpit add-ons are running on the simmer's PC right now (Fenix EFB,
 * FSLabs EFB, GSX remote, FBW SimBridge), asked from the Bridge every 15 s and
 * shared by every screen.
 */
import { useEffect, useSyncExternalStore } from "react";
import { activeBridge } from "./bridge";
import { useApp } from "./store";

export interface Addon { id: string; name: string; aircraft: string; port: number; up: boolean; localUrl: string; lanUrls: string[]; secureUrl?: string | null; help: string }

const EXTRA_KEY = "glidepath.addonPorts";
export const loadExtraPorts = (): number[] => { try { return (JSON.parse(localStorage.getItem(EXTRA_KEY) ?? "[]") as number[]).filter((n) => Number.isInteger(n)); } catch { return []; } };
export const saveExtraPorts = (p: number[]) => { try { localStorage.setItem(EXTRA_KEY, JSON.stringify(p)); } catch { /* ignore */ } void refreshAddons(); };

interface State { list: Addon[] | null; error: string | null; busy: boolean; at: number }
let state: State = { list: null, error: null, busy: false, at: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };

export async function refreshAddons(): Promise<void> {
  const b = activeBridge();
  if (!b) { set({ list: null, error: null }); return; }
  set({ busy: true });
  try {
    const extra = loadExtraPorts();
    const list = await b.get<Addon[]>(`/api/addons${extra.length ? `?extra=${extra.join(",")}` : ""}`);
    set({ list, error: null, busy: false, at: Date.now() });
  } catch (e) {
    set({ busy: false, error: /404/.test(String(e)) ? "Your Bridge is older than this app. Download the latest Bridge to use cockpit tools." : "Couldn't ask the Bridge which add-ons are running." });
  }
}

let users = 0, timer: ReturnType<typeof setInterval> | null = null;
/** Live list of add-ons; polls while any screen is showing it. */
export function useAddons(): State {
  const mode = useApp((s) => s.mode), conn = useApp((s) => s.conn);
  useEffect(() => {
    if (mode !== "bridge") { set({ list: null }); return; }
    users++;
    void refreshAddons();
    if (!timer) timer = setInterval(() => void refreshAddons(), 15_000);
    return () => { users--; if (users <= 0 && timer) { clearInterval(timer); timer = null; } };
  }, [mode, conn]);
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);
}

/** Can this copy of the app show the add-on inside itself? (https pages need the Bridge's secure door.) */
export const canEmbed = (a: Addon) => !activeBridge()?.isRelay && (location.protocol === "http:" || !!a.secureUrl);

/** The address this device should open. */
export function addonHref(a: Addon, preferSecure = location.protocol === "https:"): string {
  const b = activeBridge();
  // Through the account relay the PC's own pages can only be reached on its Wi-Fi: use its network address.
  if (b?.isRelay) return a.lanUrls?.[0] ?? a.localUrl;
  if (preferSecure && a.secureUrl) return a.secureUrl;
  let host = "localhost";
  try { if (b) host = new URL(b.baseUrl).hostname; } catch { /* keep localhost */ }
  // A secure (local-ip.sh) Bridge address is the PC's IP with dashes.
  const m = /^(\d+)-(\d+)-(\d+)-(\d+)\.local-ip\.sh$/.exec(host);
  if (m) host = `${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
  return a.localUrl.replace("localhost", host);
}

export const ADDON_KIND: Record<string, { short: string; verb: string; tint: string }> = {
  fenix: { short: "Fenix EFB", verb: "Open the EFB", tint: "linear-gradient(140deg,#30D158,#0E9F6E)" },
  fslabs: { short: "FSLabs EFB", verb: "Open the EFB", tint: "linear-gradient(140deg,#64D2FF,#0A84FF)" },
  gsx: { short: "GSX", verb: "Call ground services", tint: "linear-gradient(140deg,#FFB340,#FF7A00)" },
  simbridge: { short: "FBW flyPad & MCDU", verb: "Open the MCDU", tint: "linear-gradient(140deg,#BF5AF2,#5E5CE6)" },
};
