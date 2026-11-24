/**
 * Unloading a flight while your PC is out of reach: remembered here and sent to the Bridge
 * as soon as it's connected again, with the time you pressed it, so the logbook gets the right hours.
 */
import { activeBridge } from "./bridge";
import { store } from "./store";

const KEY = "glidepath.pendingUnload";
export interface PendingUnload { id: string; at: number }
export function pendingUnload(): PendingUnload | null { try { return JSON.parse(localStorage.getItem(KEY) ?? "null") as PendingUnload | null; } catch { return null; } }
export function queueUnload(p: PendingUnload | null): void { try { if (p) localStorage.setItem(KEY, JSON.stringify(p)); else localStorage.removeItem(KEY); } catch { /* private */ } window.dispatchEvent(new Event("glidepath-unload")); }

/** Ask the Bridge to unload now. Falls back to "finish" on an older Bridge. */
export async function unloadOnBridge(id: string, at: number): Promise<void> {
  const b = activeBridge();
  if (!b) throw new Error("Your PC isn't connected.");
  try { await b.post("/api/flight/unload", { id, at }); }
  catch (e) {
    const m = (e as Error).message;
    if (/no flight loaded/i.test(m)) return; // already finished on the PC
    if (/405|404|Not found|Method not allowed/i.test(m)) { await b.post("/api/flight/complete", {}); return; }
    throw e;
  }
}

let busy = false;
export function startUnloadFlush(): void {
  const tryNow = async () => {
    const p = pendingUnload();
    if (!p || busy || store.get().mode !== "bridge" || store.get().conn !== "live") return;
    busy = true;
    try { await unloadOnBridge(p.id, p.at); queueUnload(null); } catch { /* try again on the next change */ }
    busy = false;
  };
  store.subscribe(() => void tryNow());
  void tryNow();
}
