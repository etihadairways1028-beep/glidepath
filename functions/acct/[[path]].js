// Cloudflare Pages Function: forwards /acct/* to the Glidepath accounts service.
// Some networks block *.workers.dev; this keeps sign-in on the website's own address.
export async function onRequest(ctx) {
  const url = new URL(ctx.request.url);
  let api;
  try {
    const cfg = await ctx.env.ASSETS.fetch(new URL("/cloud.json", url)).then((r) => r.json());
    api = cfg.api;
  } catch { /* handled below */ }
  if (!api) return new Response(JSON.stringify({ error: "Accounts aren't switched on yet." }), { status: 503, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  const target = api.replace(/\/$/, "") + url.pathname.replace(/^\/acct/, "") + url.search;
  // Connect anywhere: pass WebSocket connections (relay) straight through.
  if ((ctx.request.headers.get("Upgrade") || "").toLowerCase() === "websocket") {
    const h = new Headers(ctx.request.headers);
    h.delete("host");
    return fetch(target, { method: "GET", headers: h });
  }
  // Pass on only what the service needs (never the Host header, which would mis-route the request).
  const headers = new Headers();
  for (const h of ["content-type", "authorization", "accept"]) { const v = ctx.request.headers.get(h); if (v) headers.set(h, v); }
  const init = { method: ctx.request.method, headers, body: ["GET", "HEAD"].includes(ctx.request.method) ? undefined : await ctx.request.arrayBuffer() };
  return fetch(target, init);
}
