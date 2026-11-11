/**
 * Send one email through Gmail's own mail server (smtp.gmail.com, TLS on 465)
 * using a Google "app password". No third-party email service needed.
 * Gmail allows about 500 emails a day from a personal account.
 */
import { connect } from "cloudflare:sockets";

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (s: string) => btoa(String.fromCharCode(...enc.encode(s)));
/** RFC 2047 encoded header text, for names and subjects with any characters. */
const hdr = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
/** Base64 body, wrapped at 76 characters. */
const body64 = (s: string) => b64(s).replace(/.{1,76}/g, "$&\r\n");

export async function sendGmail(user: string, appPassword: string, to: string, toName: string | null, subject: string, html: string, text: string): Promise<string | null> {
  const socket = connect({ hostname: "smtp.gmail.com", port: 465 }, { secureTransport: "on", allowHalfOpen: false });
  const w = socket.writable.getWriter();
  const r = socket.readable.getReader();
  let buf = "";
  /** Read one full SMTP reply (all its lines) and return its code and text. */
  async function reply(): Promise<[number, string]> {
    for (;;) {
      const lines = buf.split("\r\n");
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i]!)) {
          const all = lines.slice(0, i + 1).join("\n");
          buf = lines.slice(i + 1).join("\r\n");
          return [Number(lines[i]!.slice(0, 3)), all];
        }
      }
      const { value, done } = await r.read();
      if (done) throw new Error("Gmail closed the connection.");
      buf += dec.decode(value, { stream: true });
    }
  }
  async function cmd(line: string, ok: number[]): Promise<string> {
    await w.write(enc.encode(line + "\r\n"));
    const [code, msg] = await reply();
    if (!ok.includes(code)) throw new Error(`Gmail said ${code}: ${msg.split("\n").pop()?.slice(4, 160)}`);
    return msg;
  }
  try {
    const [hello] = await reply();
    if (hello !== 220) throw new Error("Gmail didn't greet us.");
    await cmd("EHLO glidepath.app", [250]);
    await cmd("AUTH LOGIN", [334]);
    await cmd(b64(user), [334]);
    await cmd(b64(appPassword.replace(/\s+/g, "")), [235]);
    await cmd(`MAIL FROM:<${user}>`, [250]);
    await cmd(`RCPT TO:<${to}>`, [250, 251]);
    await cmd("DATA", [354]);
    const boundary = "gp" + crypto.randomUUID().replace(/-/g, "");
    const msg = [
      `From: ${hdr("Glidepath")} <${user}>`,
      `To: ${toName ? `${hdr(toName)} ` : ""}<${to}>`,
      `Subject: ${hdr(subject)}`,
      `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
      `Message-ID: <${crypto.randomUUID()}@glidepath.app>`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      body64(text),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      body64(html),
      `--${boundary}--`,
      ".",
    ].join("\r\n");
    await cmd(msg, [250]);
    await cmd("QUIT", [221]).catch(() => "");
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    try { await socket.close(); } catch { /* already closed */ }
  }
}
