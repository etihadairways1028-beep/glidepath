/**
 * Follow my flight (a public, read-only live link the pilot turns on) and the
 * monthly landing challenge (opt-in leaderboard built from synced flights).
 */
type D1 = D1Database;
const num = (v: unknown, lo: number, hi: number): number | null => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const icao = (v: unknown) => { const s = str(v, 8); return s && /^[A-Z0-9]{3,8}$/i.test(s) ? s.toUpperCase() : null; };

export function shareId(): string {
  const a = new Uint8Array(9); crypto.getRandomValues(a);
  return [...a].map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
}

export interface LivePos { lat: number; lon: number; alt: number | null; gs: number | null; hdg: number | null; vs: number | null; onGround: boolean; t: number }
export interface LiveInfo { callsign: string | null; dep: string | null; arr: string | null; depName: string | null; arrName: string | null; aircraft: string | null; phase: string | null; pilot: string | null; distToGoNm: number | null; etaUtc: number | null; depLat: number | null; depLon: number | null; arrLat: number | null; arrLon: number | null }

export function cleanLive(b: Record<string, unknown> | null): { pos: LivePos; info: LiveInfo } | null {
  const p = (b?.pos ?? {}) as Record<string, unknown>, i = (b?.info ?? {}) as Record<string, unknown>;
  const lat = num(p.lat, -90, 90), lon = num(p.lon, -180, 180);
  if (lat === null || lon === null) return null;
  return {
    pos: { lat, lon, alt: num(p.alt, -2000, 70000), gs: num(p.gs, 0, 2000), hdg: num(p.hdg, 0, 360), vs: num(p.vs, -20000, 20000), onGround: p.onGround === true, t: Date.now() },
    info: { callsign: str(i.callsign, 12), dep: icao(i.dep), arr: icao(i.arr), depName: str(i.depName, 60), arrName: str(i.arrName, 60), aircraft: str(i.aircraft, 40), phase: str(i.phase, 24), pilot: str(i.pilot, 40), distToGoNm: num(i.distToGoNm, 0, 20000), etaUtc: num(i.etaUtc, 0, 1e13), depLat: num(i.depLat, -90, 90), depLon: num(i.depLon, -180, 180), arrLat: num(i.arrLat, -90, 90), arrLon: num(i.arrLon, -180, 180) },
  };
}

/** Add a point to the trail when the aircraft has moved enough, keeping the last 600. */
export function addTrail(trailJson: string | null, pos: LivePos): string {
  let trail: Array<[number, number, number | null, number]> = [];
  try { trail = trailJson ? JSON.parse(trailJson) : []; } catch { trail = []; }
  const last = trail.at(-1);
  const moved = !last || Math.abs(last[0] - pos.lat) + Math.abs(last[1] - pos.lon) > 0.01 || pos.t - last[3] > 60_000;
  if (moved) trail.push([+pos.lat.toFixed(5), +pos.lon.toFixed(5), pos.alt === null ? null : Math.round(pos.alt), pos.t]);
  return JSON.stringify(trail.slice(-600));
}

// ---------------------------------------------------------------- challenge

export interface Entry { name: string; score: number; fpm: number | null; grade: string | null; airport: string | null; aircraft: string | null; at: number; you?: boolean }

/** Best landing per pilot for a month, from flights the pilots synced. Demo/replay flights don't count. */
export async function leaderboard(db: D1, from: number, to: number, me: string | null): Promise<{ entries: Entry[]; you: (Entry & { rank: number }) | null; pilots: number }> {
  const { results } = await db.prepare(
    "SELECT c.user_id AS uid, c.name AS name, f.summary AS summary FROM challenge c JOIN flights f ON f.user_id = c.user_id WHERE f.status = 'completed' AND f.off_block_at >= ? AND f.off_block_at < ? LIMIT 5000",
  ).bind(from, to).all<{ uid: string; name: string; summary: string }>();
  const best = new Map<string, Entry & { uid: string }>();
  for (const r of results) {
    let f: Record<string, unknown>;
    try { f = JSON.parse(r.summary); } catch { continue; }
    if ((f.simulator as { source?: string } | undefined)?.source === "replay") continue;
    const ls = Array.isArray(f.landings) ? (f.landings as Array<Record<string, unknown>>) : [];
    for (const l of ls) {
      const score = num(l.score, 0, 100);
      if (score === null) continue;
      const fpm = num(l.touchdownVsFpm, -5000, 5000);
      const e: Entry & { uid: string } = { uid: r.uid, name: r.name, score: Math.round(score), fpm: fpm === null ? null : Math.round(Math.abs(fpm)), grade: str(l.grade, 3), airport: icao(f.arrivalIcao), aircraft: str((f.aircraft as { icaoType?: string } | undefined)?.icaoType, 8), at: Number(l.t ?? f.wheelsDownAt ?? 0) };
      const cur = best.get(r.uid);
      if (!cur || e.score > cur.score || (e.score === cur.score && (e.fpm ?? 9999) < (cur.fpm ?? 9999))) best.set(r.uid, e);
    }
  }
  const all = [...best.values()].sort((a, b) => b.score - a.score || (a.fpm ?? 9999) - (b.fpm ?? 9999) || a.at - b.at);
  const strip = ({ uid, ...e }: Entry & { uid: string }): Entry => (uid === me ? { ...e, you: true } : e);
  const mineIdx = me ? all.findIndex((e) => e.uid === me) : -1;
  return { entries: all.slice(0, 50).map(strip), you: mineIdx >= 0 ? { ...strip(all[mineIdx]!), rank: mineIdx + 1 } : null, pilots: all.length };
}

export function monthRange(month: string | null): { from: number; to: number; key: string } {
  const now = new Date();
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  const y = m ? Number(m[1]) : now.getUTCFullYear(), mo = m ? Number(m[2]) - 1 : now.getUTCMonth();
  return { from: Date.UTC(y, mo, 1), to: Date.UTC(y, mo + 1, 1), key: `${y}-${String(mo + 1).padStart(2, "0")}` };
}

export const cleanName = (v: unknown): string | null => { const s = str(v, 24); return s && s.length >= 2 && !/[<>]/.test(s) ? s : null; };
