/**
 * Web Push: notifications on the lock screen and home screen of the pilot's devices
 * (iPhone and iPad home-screen app, Android, Mac, Windows), free, no app store.
 *
 * Standard Web Push, built on WebCrypto only:
 *  - each message is encrypted for the receiving device (RFC 8291, aes128gcm), so only it can read it;
 *  - each request is signed with Glidepath's key (VAPID, RFC 8292), so the push service knows it's us.
 * The VAPID key pair lives in the worker secret VAPID_JWK (created once by the deploy workflow).
 */

export interface PushEnv { DB: D1Database; VAPID_JWK?: string }
export interface Sub { endpoint: string; p256dh: string; auth: string }
export interface PushMessage { title: string; body: string; url?: string; tag?: string }

const enc = new TextEncoder();
export const b64u = {
  enc(b: ArrayBuffer | Uint8Array): string {
    const u = b instanceof Uint8Array ? b : new Uint8Array(b);
    let s = ""; for (const x of u) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(s: string): Uint8Array {
    const t = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    const r = atob(t); const u = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) u[i] = r.charCodeAt(i); return u;
  },
};
const concat = (...parts: Uint8Array[]) => { const n = parts.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };

/** Only real push services: never post to an arbitrary address someone sends us. */
export function allowedEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com|push\.api\.chromium\.org)$/.test(u.hostname) || /^wns2-[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname);
  } catch { return false; }
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** RFC 8291 aes128gcm: the encrypted body for one subscription. `fixed` is for tests only. */
export async function encryptPayload(sub: Sub, payload: Uint8Array, fixed?: { salt: Uint8Array; keys: CryptoKeyPair }): Promise<Uint8Array> {
  const uaPublic = b64u.dec(sub.p256dh), authSecret = b64u.dec(sub.auth);
  const keys = fixed?.keys ?? (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // Standard WebCrypto field name is `public` (the Workers type file calls it `$public`).
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, keys.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** VAPID: a short-lived signed token for the push service, plus our public key. */
export async function vapidHeader(endpoint: string, jwk: JsonWebKey, subject = "https://glidepath-ad9.pages.dev"): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64u.enc(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u.enc(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64u.enc(sig)}, k=${publicKeyOf(jwk)}`;
}

/** The public key in the form browsers want (uncompressed point, base64url). */
export function publicKeyOf(jwk: JsonWebKey): string {
  return b64u.enc(concat(new Uint8Array([4]), b64u.dec(jwk.x!), b64u.dec(jwk.y!)));
}

export function vapidKey(env: PushEnv): JsonWebKey | null {
  try { const j = JSON.parse(env.VAPID_JWK ?? "") as JsonWebKey; return j.d && j.x && j.y ? j : null; } catch { return null; }
}

/** Send one message to one subscription. Returns "gone" when the device has dropped the subscription. */
export async function sendPush(env: PushEnv, sub: Sub, msg: PushMessage, doFetch: typeof fetch = fetch): Promise<"ok" | "gone" | "error"> {
  const jwk = vapidKey(env);
  if (!jwk || !allowedEndpoint(sub.endpoint)) return "error";
  const body = await encryptPayload(sub, enc.encode(JSON.stringify({ title: msg.title.slice(0, 80), body: msg.body.slice(0, 240), url: msg.url ?? "/app/", tag: msg.tag ?? "glidepath" })));
  try {
    const r = await doFetch(sub.endpoint, {
      method: "POST",
      headers: { Authorization: await vapidHeader(sub.endpoint, jwk), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "3600", Urgency: "high" },
      body,
    });
    if (r.status === 404 || r.status === 410) return "gone";
    return r.ok ? "ok" : "error";
  } catch { return "error"; }
}

/** Send to all of a pilot's devices; forget the ones that have gone. */
export async function pushToUser(env: PushEnv, userId: string, msg: PushMessage, doFetch: typeof fetch = fetch): Promise<{ sent: number; failed: number }> {
  const rows = (await env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ?").bind(userId).all<Sub>()).results ?? [];
  let sent = 0, failed = 0;
  for (const s of rows) {
    const r = await sendPush(env, s, msg, doFetch);
    if (r === "ok") sent++;
    else { failed++; if (r === "gone") await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(s.endpoint).run(); }
  }
  return { sent, failed };
}
