/**
 * Secure link: lets the Glidepath website (https) talk to this PC.
 *
 * Browsers won't let an https page reach a plain-http address, so the Bridge
 * also serves HTTPS on port+1 under a public name that points at this PC's own
 * Wi-Fi address, e.g. 192-168-1-20.local-ip.sh, using the free wildcard
 * certificate local-ip.sh publishes for exactly this purpose. Traffic still
 * goes straight across your Wi-Fi; nothing is relayed.
 *
 * So the website can find the PC from just the 6-digit code, the Bridge posts
 * its secure address (never the pairing key) to a ntfy.sh topic named from a
 * hash of that code. The code itself is still needed to pair.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:https";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { Logger } from "./log.js";

const CERT_URL = "https://local-ip.sh/server.pem";
const KEY_URL = "https://local-ip.sh/server.key";
export const SECURE_DOMAIN = "local-ip.sh";

export const secureHost = (ip: string) => `${ip.replace(/\./g, "-")}.${SECURE_DOMAIN}`;
/** Topic the website polls to find this PC from the code. Shared with the web app. */
export const rendezvousTopic = (code: string) => `glidepath-${createHash("sha256").update(`glidepath:${code}`).digest("hex").slice(0, 24)}`;

async function loadCert(dir: string, log: Logger): Promise<{ cert: string; key: string } | null> {
  const certPath = join(dir, "server.pem"), keyPath = join(dir, "server.key");
  const fresh = existsSync(certPath) && Date.now() - statSync(certPath).mtimeMs < 3 * 24 * 3600_000;
  if (!fresh) {
    try {
      const [cert, key] = await Promise.all([CERT_URL, KEY_URL].map(async (u) => {
        const r = await fetch(u, { signal: AbortSignal.timeout(10_000) });
        if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
        return r.text();
      }));
      if (!cert!.includes("BEGIN CERTIFICATE") || !key!.includes("PRIVATE KEY")) throw new Error("unexpected certificate download");
      mkdirSync(dir, { recursive: true });
      writeFileSync(certPath, cert!);
      writeFileSync(keyPath, key!);
    } catch (e) {
      log.warn(`Couldn't download the secure-link certificate (${(e as Error).message}); using the saved one if there is one`);
    }
  }
  if (!existsSync(certPath) || !existsSync(keyPath)) return null;
  return { cert: readFileSync(certPath, "utf8"), key: readFileSync(keyPath, "utf8") };
}

export async function startSecure(opts: {
  dataDir: string; host: string; port: number; log: Logger;
  handler: (req: IncomingMessage, res: ServerResponse) => void;
  upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}): Promise<Server | null> {
  const tls = await loadCert(join(opts.dataDir, "tls"), opts.log);
  if (!tls) { opts.log.warn("Secure link is off: no certificate. The website can't reach this PC; use glidepath.local instead."); return null; }
  const srv = createServer({ cert: tls.cert, key: tls.key }, opts.handler);
  srv.on("upgrade", opts.upgrade);
  try {
    await new Promise<void>((resolve, reject) => { srv.once("error", reject); srv.listen(opts.port, opts.host, () => resolve()); });
  } catch (e) {
    opts.log.warn(`Secure link couldn't start on port ${opts.port}: ${(e as Error).message}`);
    return null;
  }
  opts.log.info(`Secure link on port ${opts.port}`);
  return srv;
}

/** Post the secure address so the website can find this PC by code. Best effort. */
export async function announce(code: string, host: string, port: number, log: Logger): Promise<void> {
  try {
    const r = await fetch(`https://ntfy.sh/${rendezvousTopic(code)}`, {
      method: "POST", body: JSON.stringify({ h: host, p: port, v: 1 }),
      headers: { "Cache": "yes", "Title": "Glidepath" }, signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    log.warn(`Couldn't post the address for code pairing (${(e as Error).message}). Type the PC's address on the iPad instead.`);
  }
}
