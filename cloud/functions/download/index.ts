// Built from cloud/src/download.ts by cloud/build.sh. Paste this whole file into the Supabase editor.

// src/shared.ts
import { createClient } from "npm:@supabase/supabase-js@2";
var env = (k) => Deno.env.get(k) ?? "";
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
function admin() {
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("GLIDEPATH_SERVICE_KEY");
  if (!key) throw new Error("Missing service key. Add a GLIDEPATH_SERVICE_KEY secret with your project's secret key.");
  return createClient(env("SUPABASE_URL"), key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function userFrom(req, db) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data?.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}

// src/download.ts
var FILE = "GlidepathBridge-windows-x64.zip";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const db = admin();
  const me = await userFrom(req, db);
  if (!me) return reply(401, { error: "Sign in to download." });
  const { data, error } = await db.storage.from("releases").createSignedUrl(FILE, 600, { download: FILE });
  if (error || !data?.signedUrl) return reply(404, { error: "The download hasn't been uploaded to the releases bucket yet." });
  return reply(200, { url: data.signedUrl, expiresIn: 600 });
});
