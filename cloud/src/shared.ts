// Shared helpers for the Glidepath cloud functions (Supabase Edge Functions, Deno).
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: { env: { get(k: string): string | undefined } };

export const env = (k: string) => Deno.env.get(k) ?? "";
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export function admin() {
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("GLIDEPATH_SERVICE_KEY");
  if (!key) throw new Error("Missing service key. Add a GLIDEPATH_SERVICE_KEY secret with your project's secret key.");
  return createClient(env("SUPABASE_URL"), key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The signed-in user behind this request, or null. */
export async function userFrom(req: Request, db: any): Promise<{ id: string; email: string } | null> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data?.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}
