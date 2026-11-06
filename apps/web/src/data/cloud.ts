/**
 * Glidepath accounts (Supabase). Optional: with no cloud config, everything
 * here reports "not set up" and the app works exactly as before.
 *
 *  - Config is public (project URL + publishable/anon key, protected by
 *    row-level security). It's read from ./cloud.json, falling back to the
 *    hosted site's copy so the app inside the Bridge picks it up too.
 *  - Several accounts can be signed in on one device; each keeps its own
 *    session under its own storage key. One is active at a time.
 *  - Completed flight summaries are copied to the account (no telemetry),
 *    and paired Bridges are remembered so other signed-in devices find them.
 */
import { useSyncExternalStore } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

let conf: { url: string; key: string } | null = null;
const clients = new Map<string, SupabaseClient>();

const ls = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

function clientFor(slot: string): SupabaseClient {
  let c = clients.get(slot);
  if (!c) {
    c = createClient(conf!.url, conf!.key, { auth: { storageKey: `gp-auth-${slot}`, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    clients.set(slot, c);
  }
  return c;
}
export function activeClient(): SupabaseClient | null {
  return conf && state.active ? clientFor(state.active) : null;
}
const activeAccount = () => state.accounts.find((a) => a.slot === state.active) ?? null;

async function readConfig(): Promise<{ url: string; key: string } | null> {
  for (const src of ["cloud.json", HOSTED_CONFIG]) {
    try {
      const r = await fetch(src, { cache: "no-cache" });
      if (!r.ok) continue;
      const j = (await r.json()) as { supabaseUrl?: string; supabaseKey?: string };
      if (j.supabaseUrl && j.supabaseKey) return { url: j.supabaseUrl.replace(/\/$/, ""), key: j.supabaseKey };
    } catch { /* try the next one */ }
  }
  return null;
}

export async function initCloud(): Promise<void> {
  conf = await readConfig();
  if (!conf) { set({ status: "off" }); return; }
  const accounts = ls.get<CloudAccount[]>("gp.accounts", []);
  const active = ls.get<string | null>("gp.activeAccount", accounts[0]?.slot ?? null);
  set({ status: "ready", accounts, active: accounts.some((a) => a.slot === active) ? active : accounts[0]?.slot ?? null });
  void loadProfile();
}

function saveAccounts(accounts: CloudAccount[], active: string | null) {
  ls.set("gp.accounts", accounts);
  ls.set("gp.activeAccount", active);
  set({ accounts, active, profile: null });
}

const friendly = (m: string) =>
  /invalid login/i.test(m) ? "That email and password don't match an account." :
  /email not confirmed/i.test(m) ? "Confirm your email first: we sent you a link when you signed up." :
  /already registered|already exists/i.test(m) ? "There's already an account with that email. Sign in instead." :
  /password should be/i.test(m) ? "Use a password of at least 8 characters." :
  /rate limit/i.test(m) ? "Too many tries. Wait a minute and try again." :
  /fetch|network/i.test(m) ? "Couldn't reach the account service. Check your internet connection." : m;

/** Sign in. Adds the account if it's new on this device and makes it active. */
export async function signIn(email: string, password: string): Promise<string | null> {
  if (!conf) return "Accounts aren't set up yet.";
  const existing = state.accounts.find((a) => a.email.toLowerCase() === email.trim().toLowerCase());
  const slot = existing?.slot ?? crypto.randomUUID().slice(0, 8);
  const { data, error } = await clientFor(slot).auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.user) { if (!existing) clients.delete(slot); return friendly(error?.message ?? "Couldn't sign in."); }
  const acct: CloudAccount = { slot, userId: data.user.id, email: data.user.email ?? email, name: (data.user.user_metadata?.display_name as string | undefined) ?? null };
  saveAccounts([...state.accounts.filter((a) => a.slot !== slot), acct], slot);
  void loadProfile();
  return null;
}

/** Create an account. Returns { error } or { confirm: true } when the email needs confirming first. */
export async function signUp(name: string, email: string, password: string): Promise<{ error: string | null; confirm: boolean }> {
  if (!conf) return { error: "Accounts aren't set up yet.", confirm: false };
  const slot = crypto.randomUUID().slice(0, 8);
  const { data, error } = await clientFor(slot).auth.signUp({
    email: email.trim(), password,
    options: { data: { display_name: name.trim() || null }, emailRedirectTo: "https://etihadairways1028-beep.github.io/glidepath/#signed-in" },
  });
  if (error) { clients.delete(slot); return { error: friendly(error.message), confirm: false }; }
  if (!data.session || !data.user) { clients.delete(slot); return { error: null, confirm: true }; }
  saveAccounts([...state.accounts, { slot, userId: data.user.id, email: data.user.email ?? email, name: name.trim() || null }], slot);
  void loadProfile();
  return { error: null, confirm: false };
}

export function switchAccount(slot: string): void {
  if (!state.accounts.some((a) => a.slot === slot)) return;
  saveAccounts(state.accounts, slot);
  void loadProfile();
}

export async function signOut(slot: string): Promise<void> {
  try { await clientFor(slot).auth.signOut({ scope: "local" }); } catch { /* already gone */ }
  clients.delete(slot);
  ls.del(`gp-auth-${slot}`);
  ls.del(`gp.synced.${slot}`);
  const rest = state.accounts.filter((a) => a.slot !== slot);
  saveAccounts(rest, state.active === slot ? rest[0]?.slot ?? null : state.active);
  void loadProfile();
}

async function loadProfile(): Promise<void> {
  const c = activeClient();
  if (!c) { set({ profile: null }); return; }
  const { data } = await c.from("profiles").select("email, display_name, monthly_email").maybeSingle();
  set({ profile: (data as CloudProfile | null) ?? null });
}

export async function setMonthlyEmail(on: boolean): Promise<string | null> {
  const c = activeClient(); const a = activeAccount();
  if (!c || !a) return "Sign in first.";
  const { error } = await c.from("profiles").update({ monthly_email: on }).eq("id", a.userId);
  if (error) return friendly(error.message);
  await loadProfile();
  return null;
}

/** Copy completed flight summaries that this account doesn't have yet. */
export async function syncFlights(flights: FlightSummary[]): Promise<void> {
  const c = activeClient(); const a = activeAccount();
  if (!c || !a) return;
  const key = `gp.synced.${a.slot}`;
  const synced = ls.get<Record<string, string>>(key, {});
  const todo = flights.filter((f) => (f.status === "completed" || f.status === "incomplete") && synced[f.id] !== `${f.status}:${f.lastSeq}`);
  if (!todo.length) { set({ lastSync: Date.now(), syncError: null }); return; }
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const { error } = await c.from("flights").upsert(batch.map((f) => ({
      user_id: a.userId, id: f.id, status: f.status,
      off_block_at: f.offBlockAt ? new Date(f.offBlockAt).toISOString() : new Date(f.startedAt).toISOString(),
      summary: f, updated_at: new Date().toISOString(),
    })));
    if (error) { set({ syncError: friendly(error.message) }); return; }
    for (const f of batch) synced[f.id] = `${f.status}:${f.lastSeq}`;
    ls.set(key, synced);
  }
  set({ lastSync: Date.now(), syncError: null });
}

/** Every flight saved to the active account, newest first (for the logbook away from the PC). */
export async function cloudFlights(): Promise<FlightSummary[] | null> {
  const c = activeClient();
  if (!c) return null;
  const { data, error } = await c.from("flights").select("summary").order("off_block_at", { ascending: false }).limit(2000);
  if (error) return null;
  return ((data ?? []) as Array<{ summary: FlightSummary }>).map((r) => r.summary);
}

/** Remember this Bridge on the account so other signed-in devices can find it. */
export async function saveBridge(b: { bridgeId: string; name: string; addresses: string[]; port: number; token: string }): Promise<void> {
  const c = activeClient(); const a = activeAccount();
  if (!c || !a) return;
  await c.from("bridges").upsert({ user_id: a.userId, bridge_id: b.bridgeId, name: b.name, addresses: b.addresses, port: b.port, token: b.token, updated_at: new Date().toISOString() });
}

export async function savedBridges(): Promise<SavedBridge[]> {
  const c = activeClient();
  if (!c) return [];
  const { data } = await c.from("bridges").select("bridge_id, name, addresses, port, token, updated_at").order("updated_at", { ascending: false });
  return (data as SavedBridge[] | null) ?? [];
}

export async function forgetBridge(bridgeId: string): Promise<void> {
  const c = activeClient(); const a = activeAccount();
  if (!c || !a) return;
  await c.from("bridges").delete().eq("user_id", a.userId).eq("bridge_id", bridgeId);
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
  const c = activeClient();
  if (!c) return "Sign in first.";
  const { data, error } = await c.functions.invoke("monthly-brief", { body: { preview: true } });
  if (error) {
    let msg = error.message;
    try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) msg = b.error; } catch { /* keep message */ }
    return friendly(msg);
  }
  const d = data as { sent?: boolean; reason?: string; error?: string | null };
  return d.sent ? `Sent to ${activeAccount()?.email}. Check your inbox (and spam, the first time).` : d.reason ?? d.error ?? "Nothing was sent.";
}

/** A short-lived download link for the Windows Bridge, for signed-in accounts. */
export async function downloadLink(): Promise<{ url: string | null; error: string | null }> {
  const c = activeClient();
  if (!c) return { url: null, error: "Sign in to download." };
  const { data, error } = await c.functions.invoke("download", { body: {} });
  if (error) return { url: null, error: friendly(error.message) };
  return { url: (data as { url?: string }).url ?? null, error: null };
}
