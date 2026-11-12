// Offline shell for the hosted app. Live data always comes from the network;
// only the app's own files are cached, so it opens instantly from the Home Screen.
const CACHE = "glidepath-v8";
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

/** Safari refuses a page that a service worker answers with a redirected response
 *  (Cloudflare redirects /app to /app/, for example), so hand it back as a clean copy. */
async function clean(res) {
  if (!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Accounts and live data never go through the cache.
  if (url.pathname.startsWith("/acct") || url.pathname.endsWith("cloud.json")) return;
  const isPage = e.request.mode === "navigate";
  const fromCache = async () => (await caches.match(isPage ? "./index.html" : e.request)) || (await caches.match("./index.html")) || Response.error();
  const fromNet = () => fetch(e.request).then(async (res) => {
    const out = await clean(res);
    if (out.ok) { const copy = out.clone(); caches.open(CACHE).then((c) => c.put(isPage ? "./index.html" : e.request, copy)); }
    return out;
  });
  // Built files have their content in the name, so a saved copy is always right: use it straight away.
  if (/\/assets\/[^/]+-[\w-]{6,}\.\w+$/.test(url.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fromNet()).catch(fromCache));
    return;
  }
  // Everything else: the newest copy if the network answers quickly, otherwise the saved one,
  // so the Home Screen app always opens, even with bad or no internet.
  e.respondWith(new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    const timer = setTimeout(() => fromCache().then((r) => { if (r && r.type !== "error") finish(r); }), isPage ? 2500 : 4000);
    fromNet().then((r) => { clearTimeout(timer); finish(r); }, () => { clearTimeout(timer); fromCache().then(finish); });
  }));
});

// Tapping a Glidepath notification opens the app on the right screen.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) { c.navigate(target).catch(() => undefined); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
