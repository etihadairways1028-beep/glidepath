/**
 * Glidepath accounts (Cloudflare Workers + D1, see cloud/cloudflare). Optional:
 * with no cloud config, everything here reports "not set up" and the app works
 * exactly as before.
 *
 *  - Config is public (just the service address). It's read from ./cloud.json,
 *    falling back to the hosted site's copy so the app inside the Bridge finds it too.
 *  - Several accounts can be signed in on one device; each keeps its own
 *    session token. One is active at a time.
 *  - Completed flight summaries are copied to the account (no telemetry),
 *    and paired Bridges are remembered so other signed-in devices find them.
 */
import { useSyncExternalStore } from "react";
import type { FlightSummary } from "@glidepath/protocol";

const HOSTED_CONFIG = "https://etihadairways1028-beep.github.io/glidepath/cloud.json";

export interface CloudAccount { slot: string; userId: string; email: string; name: string | null }
export interface CloudProfile { email: string; display_name: string | null; monthly_email: boolean }
export interface SavedBridge { bridge_id: string; name: string | null; addresses: string[]; port: number; token: string; updated_at: string }

interface CloudState {
  status: "loading" | "off" | "ready";
  accounts: CloudAccount[];
  active: string | null;
  profile: CloudProfile | null;
  lastSync: number | null;
  syncError: string | null;
}

let state: CloudState = { status: "loading", accounts: [], active: null, profile: null, lastSync: null, syncError: null };
const subs = new Set<() => void>();
const set = (p: Partial<CloudState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const cloudStore = { get: () => state, subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); } };
export function useCloud(): CloudState {
  return useSyncExternalStore(cloudStore.subscribe, cloudStore.get, cloudStore.get);
}

let api: string | null = null;

const ls = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const tokenKey = (slot: string) => `gp-auth-${slot}`;
const activeAccount = () => state.accounts.find((a) => a.slot === state.active) ?? null;

class CloudError extends Error {}
/** Call the accounts service as the given account (or none). Throws CloudError with a message for people. */
async function call<T>(path: string, init: { method?: string; body?: unknown; slot?: string | null } = {}): Promise<T> {
  if (!api) throw new CloudError("Accounts aren't set up yet.");
  const token = init.slot ? ls.get<string | null>(tokenKey(init.slot), null) : null;
  let r: Response;
  try {
    r = await fetch(`${api}${path}`, {
      method: init.method ?? "GET",
      headers: { ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new CloudError("Couldn't reach the account service. Check your internet connection.");
  }
  const j = await r.json().catch(() => ({})) as T & { error?: string };
  if (!r.ok) {
    if (r.status === 401 && init.slot && path !== "/auth/login") dropAccount(init.slot);
    throw new CloudError(j.error ?? `The account service said ${r.status}.`);
  }
  return j;
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function readConfig(): Promise<string | null> {
  for (const src of ["cloud.json", HOSTED_CONFIG]) {
    try {
      const r = await fetch(src, { cache: "no-cache" });
      if (!r.ok) continue;
      const j = (await r.json()) as { provider?: string; api?: string };
      if (j.api && /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(j.api)) return j.api.replace(/\/$/, "");
    } catch { /* try the next one */ }
  }
  return null;
}

export async function initCloud(): Promise<void> {
  api = await readConfig();
  if (!api) { set({ status: "off" }); return; }
  const accounts = ls.get<CloudAccount[]>("gp.accounts", []).filter((a) => ls.get<string | null>(tokenKey(a.slot), null));
  const active = ls.get<string | null>("gp.activeAccount", accounts[0]?.slot ?? null);
  set({ status: "ready", accounts, active: accounts.some((a) => a.slot === active) ? active : accounts[0]?.slot ?? null });
  void loadProfile();
}

function saveAccounts(accounts: CloudAccount[], active: string | null) {
  ls.set("gp.accounts", accounts);
  ls.set("gp.activeAccount", active);
  set({ accounts, active, profile: null });
}
/** Session ended on the server (signed out elsewhere, or expired): forget it here. */
function dropAccount(slot: string) {
  ls.del(tokenKey(slot));
  const rest = state.accounts.filter((a) => a.slot !== slot);
  saveAccounts(rest, state.active === slot ? rest[0]?.slot ?? null : state.active);
}

interface AuthReply { token: string; user: { id: string; email: string; display_name: string | null; monthly_email: boolean } }
function addSignedIn(r: AuthReply, slot: string) {
  ls.set(tokenKey(slot), r.token);
  const acct: CloudAccount = { slot, userId: r.user.id, email: r.user.email, name: r.user.display_name };
  saveAccounts([...state.accounts.filter((a) => a.slot !== slot && a.userId !== r.user.id), acct], slot);
  set({ profile: { email: r.user.email, display_name: r.user.display_name, monthly_email: r.user.monthly_email } });
}

/** Sign in. Adds the account if it's new on this device and makes it active. */
export async function signIn(email: string, password: string): Promise<string | null> {
  try {
    const existing = state.accounts.find((a) => a.email.toLowerCase() === email.trim().toLowerCase());
    const r = await call<AuthReply>("/auth/login", { method: "POST", body: { email: email.trim(), password } });
    addSignedIn(r, existing?.slot ?? crypto.randomUUID().slice(0, 8));
    return null;
  } catch (e) { return msg(e); }
}

/** Create an account (signed in straight away). */
export async function signUp(name: string, email: string, password: string): Promise<{ error: string | null; confirm: boolean }> {
  try {
    const r = await call<AuthReply>("/auth/signup", { method: "POST", body: { name: name.trim(), email: email.trim(), password } });
    addSignedIn(r, crypto.randomUUID().slice(0, 8));
    return { error: null, confirm: false };
  } catch (e) { return { error: msg(e), confirm: false }; }
}

export function switchAccount(slot: string): void {
  if (!state.accounts.some((a) => a.slot === slot)) return;
  saveAccounts(state.accounts, slot);
  void loadProfile();
}

export async function signOut(slot: string): Promise<void> {
  try { await call("/auth/logout", { method: "POST", body: {}, slot }); } catch { /* already gone */ }
  ls.del(`gp.synced.${slot}`);
  dropAccount(slot);
  void loadProfile();
}

async function loadProfile(): Promise<void> {
  const a = activeAccount();
  if (!a) { set({ profile: null }); return; }
  try { set({ profile: await call<CloudProfile>("/me", { slot: a.slot }) }); } catch { set({ profile: null }); }
}

export async function setMonthlyEmail(on: boolean): Promise<string | null> {
  const a = activeAccount();
  if (!a) return "Sign in first.";
  try { set({ profile: await call<CloudProfile>("/me", { method: "PATCH", body: { monthly_email: on }, slot: a.slot }) }); return null; } catch (e) { return msg(e); }
}

/** Copy completed flight summaries that this account doesn't have yet. */
export async function syncFlights(flights: FlightSummary[]): Promise<void> {
  const a = activeAccount();
  if (!a) return;
  const key = `gp.synced.${a.slot}`;
  const synced = ls.get<Record<string, string>>(key, {});
  const todo = flights.filter((f) => (f.status === "completed" || f.status === "incomplete") && synced[f.id] !== `${f.status}:${f.lastSeq}`);
  if (!todo.length) { set({ lastSync: Date.now(), syncError: null }); return; }
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    try {
      await call("/flights", { method: "PUT", slot: a.slot, body: batch.map((f) => ({ id: f.id, status: f.status, off_block_at: f.offBlockAt ?? f.startedAt, summary: f })) });
    } catch (e) { set({ syncError: msg(e) }); return; }
    for (const f of batch) synced[f.id] = `${f.status}:${f.lastSeq}`;
    ls.set(key, synced);
  }
  set({ lastSync: Date.now(), syncError: null });
}

/** Every flight saved to the active account, newest first (for the logbook away from the PC). */
export async function cloudFlights(): Promise<FlightSummary[] | null> {
  const a = activeAccount();
  if (!a) return null;
  try { return await call<FlightSummary[]>("/flights", { slot: a.slot }); } catch { return null; }
}

/** Remember this Bridge on the account so other signed-in devices can find it. */
export async function saveBridge(b: { bridgeId: string; name: string; addresses: string[]; port: number; token: string }): Promise<void> {
  const a = activeAccount();
  if (!a) return;
  try { await call("/bridges", { method: "PUT", slot: a.slot, body: { bridge_id: b.bridgeId, name: b.name, addresses: b.addresses, port: b.port, token: b.token } }); } catch { /* best effort */ }
}

export async function savedBridges(): Promise<SavedBridge[]> {
  const a = activeAccount();
  if (!a) return [];
  try { return await call<SavedBridge[]>("/bridges", { slot: a.slot }); } catch { return []; }
}

export async function forgetBridge(bridgeId: string): Promise<void> {
  const a = activeAccount();
  if (!a) return;
  try { await call(`/bridges/${encodeURIComponent(bridgeId)}`, { method: "DELETE", slot: a.slot }); } catch { /* best effort */ }
}

/** Delete the active account and everything stored with it. */
export async function deleteAccount(): Promise<string | null> {
  const a = activeAccount();
  if (!a) return "Sign in first.";
  try { await call("/me", { method: "DELETE", slot: a.slot }); dropAccount(a.slot); void loadProfile(); return null; } catch (e) { return msg(e); }
}

/**
 * Try every saved Bridge address on this network and return the first that answers.
 * Browsers only allow this from a page that isn't https, or for localhost.
 */
export async function findBridgeOnNetwork(): Promise<{ url: string; token: string; name: string | null } | null> {
  const list = await savedBridges();
  const https = location.protocol === "https:";
  const tries = list.flatMap((b) => {
    const hosts = [...(https ? [] : b.addresses), "localhost"];
    return hosts.map((h) => ({ url: `http://${h}:${b.port}`, token: b.token, name: b.name }));
  });
  if (!tries.length) return null;
  return new Promise((resolve) => {
    let left = tries.length;
    const done = (v: { url: string; token: string; name: string | null } | null) => { if (v) { resolve(v); left = -1; } else if (--left === 0) resolve(null); };
    for (const t of tries) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 2500);
      fetch(`${t.url}/api/status`, { headers: { Authorization: `Bearer ${t.token}` }, signal: ctl.signal })
        .then((r) => done(r.ok ? t : null)).catch(() => done(null)).finally(() => clearTimeout(timer));
    }
  });
}

/** Ask the server to email this month's brief so far to the active account (at most once an hour). */
export async function sendBriefPreview(): Promise<string> {
  const a = activeAccount();
  if (!a) return "Sign in first.";
  try {
    const d = await call<{ sent?: boolean; reason?: string }>("/brief/preview", { method: "POST", body: {}, slot: a.slot });
    return d.sent ? `Sent to ${a.email}. Check your inbox (and spam, the first time).` : d.reason ?? "Nothing was sent.";
  } catch (e) { return msg(e); }
}

/** The Windows Bridge download, for signed-in accounts. */
export async function downloadLink(): Promise<{ url: string | null; error: string | null }> {
  const a = activeAccount();
  if (!a) return { url: null, error: "Sign in to download." };
  try { return { url: (await call<{ url: string }>("/download", { slot: a.slot })).url, error: null }; } catch (e) { return { url: null, error: msg(e) }; }
}
