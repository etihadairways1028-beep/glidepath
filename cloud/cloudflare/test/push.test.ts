import { describe, expect, it } from "vitest";
import { createECDH, randomBytes } from "node:crypto";
// An independent implementation (the one web-push tools use) decrypts what we encrypt, like a browser would.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import ece from "http_ece";
import { allowedEndpoint, b64u, encryptPayload, publicKeyOf, pushToUser, sendPush, vapidHeader } from "../src/push";

function browserSubscription() {
  const ua = createECDH("prime256v1"); ua.generateKeys();
  const auth = randomBytes(16);
  return { ua, auth, sub: { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", p256dh: b64u.enc(ua.getPublicKey()), auth: b64u.enc(auth) } };
}
async function vapidJwk() {
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  return { priv: await crypto.subtle.exportKey("jwk", k.privateKey) as JsonWebKey, pub: k.publicKey };
}

describe("Web Push", () => {
  it("encrypts so the receiving device (and only it) can read the message (RFC 8291)", async () => {
    const { ua, auth, sub } = browserSubscription();
    const msg = JSON.stringify({ title: "Top of descent", body: "Start down now.", url: "/app/" });
    const body = await encryptPayload(sub, new TextEncoder().encode(msg));
    const plain = ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: ua, authSecret: auth });
    expect(plain.toString("utf8")).toBe(msg);
    // Someone else's keys can't read it.
    const other = createECDH("prime256v1"); other.generateKeys();
    expect(() => ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: other, authSecret: auth })).toThrow();
  });
  it("signs a VAPID token the push service can verify", async () => {
    const { priv, pub } = await vapidJwk();
    const h = await vapidHeader("https://fcm.googleapis.com/fcm/send/abc", priv);
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(h)!;
    const [hd, cl, sig] = m[1]!.split(".");
    const claims = JSON.parse(new TextDecoder().decode(b64u.dec(cl!)));
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64u.dec(sig!), new TextEncoder().encode(`${hd}.${cl}`));
    expect(ok).toBe(true);
    expect(m[2]).toBe(publicKeyOf(priv));
    expect(b64u.dec(m[2]!).length).toBe(65);
  });
  it("only posts to real push services", () => {
    expect(allowedEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
    expect(allowedEndpoint("https://web.push.apple.com/QGx")).toBe(true);
    expect(allowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(allowedEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
    expect(allowedEndpoint("https://evil.example.com/fcm.googleapis.com")).toBe(false);
    expect(allowedEndpoint("http://fcm.googleapis.com/x")).toBe(false);
  });
  it("sends with the right headers, and forgets devices that have gone", async () => {
    const { priv } = await vapidJwk();
    const a = browserSubscription().sub, gone = { ...browserSubscription().sub, endpoint: "https://web.push.apple.com/gone" };
    const deleted: string[] = [];
    const DB = {
      prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({
        all: async () => ({ results: [a, gone] }),
        run: async () => { if (sql.startsWith("DELETE")) deleted.push(String(args[0])); return {}; },
      }) }),
    };
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => { seen.push({ url, headers: init.headers as Record<string, string> }); return new Response(null, { status: url.includes("gone") ? 410 : 201 }); }) as unknown as typeof fetch;
    const env = { DB: DB as never, VAPID_JWK: JSON.stringify(priv) };
    const r = await pushToUser(env, "u1", { title: "Landed", body: "140 fpm" }, fakeFetch);
    expect(r).toEqual({ sent: 1, failed: 1 });
    expect(deleted).toEqual(["https://web.push.apple.com/gone"]);
    expect(seen[0]!.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(seen[0]!.headers.Authorization).toMatch(/^vapid t=/);
    expect(seen[0]!.headers.TTL).toBe("3600");
    expect(await sendPush({ DB: DB as never }, a, { title: "x", body: "y" }, fakeFetch)).toBe("error"); // no key set
  });
});
