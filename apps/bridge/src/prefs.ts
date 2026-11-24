/**
 * Small preferences the PC keeps for every paired device, so a new iPad or a Home Screen
 * copy of the app (which has its own storage) loads your flight with nothing to type.
 * Only the SimBrief username today: it's not secret (it's in every SimBrief share link).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Prefs { simbriefUser: string }
const NAME = /^[A-Za-z0-9_.\- ]{0,40}$/;

export class PrefsStore {
  private v: Prefs = { simbriefUser: "" };
  constructor(private readonly dir: string) {
    try { const j = JSON.parse(readFileSync(join(dir, "prefs.json"), "utf8")) as Partial<Prefs>; if (typeof j.simbriefUser === "string" && NAME.test(j.simbriefUser)) this.v.simbriefUser = j.simbriefUser.trim(); } catch { /* none yet */ }
  }
  get(): Prefs { return { ...this.v }; }
  /** Returns an error message, or null when saved. */
  set(patch: Partial<Prefs>): string | null {
    if (patch.simbriefUser !== undefined) {
      if (typeof patch.simbriefUser !== "string" || !NAME.test(patch.simbriefUser)) return "That isn't a SimBrief username.";
      this.v.simbriefUser = patch.simbriefUser.trim();
    }
    try { writeFileSync(join(this.dir, "prefs.json"), JSON.stringify(this.v)); } catch { /* keep in memory */ }
    return null;
  }
}
