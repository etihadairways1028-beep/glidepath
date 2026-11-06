// download: gives a signed-in person a 10-minute link to the Windows Bridge zip in the private "releases" bucket.
import { admin, CORS, reply, userFrom } from "./shared.ts";

declare const Deno: { serve(h: (req: Request) => Response | Promise<Response>): void };
const FILE = "GlidepathBridge-windows-x64.zip";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const db = admin();
  const me = await userFrom(req, db);
  if (!me) return reply(401, { error: "Sign in to download." });
  const { data, error } = await db.storage.from("releases").createSignedUrl(FILE, 600, { download: FILE });
  if (error || !data?.signedUrl) return reply(404, { error: "The download hasn't been uploaded to the releases bucket yet." });
  return reply(200, { url: data.signedUrl, expiresIn: 600 });
});
