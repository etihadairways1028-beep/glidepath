/**
 * Your SimBrief name lives on your PC too, so every device you pair (and the Home Screen
 * copy of the app, which has its own storage) loads your flight with nothing to type.
 */
import { activeBridge, type BridgeClient } from "./bridge";
import { settingsStore, store } from "./store";

export function startPrefsSync(): void {
  let done: BridgeClient | null = null;
  let last = settingsStore.get().simbriefUser.trim();
  const pull = async () => {
    const b = activeBridge();
    if (!b || done === b || store.get().mode !== "bridge" || store.get().conn !== "live") return;
    done = b;
    try {
      const r = await b.get<{ simbriefUser?: string }>("/api/prefs");
      const local = settingsStore.get().simbriefUser.trim(), remote = (r.simbriefUser ?? "").trim();
      if (!local && remote) { last = remote; settingsStore.set({ simbriefUser: remote }); }
      else if (local && local !== remote) await b.post("/api/prefs", { simbriefUser: local });
    } catch { /* an older Bridge without preferences: nothing to do */ }
  };
  store.subscribe(() => void pull());
  settingsStore.subscribe(() => {
    const u = settingsStore.get().simbriefUser.trim();
    if (u === last) return;
    last = u;
    const b = activeBridge();
    if (b && store.get().conn === "live") void b.post("/api/prefs", { simbriefUser: u }).catch(() => undefined);
  });
}
