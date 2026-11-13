/**
 * Connect anywhere: one small relay per account (a Durable Object, free plan).
 *
 * The Bridge on the PC signs in once and keeps a WebSocket open here. Any device
 * signed in to the same account opens its own WebSocket here, and the relay
 * passes messages between them, so the iPad and the PC don't need to be on the
 * same Wi-Fi (or any Wi-Fi: mobile data works too).
 *
 * Wire format (text only):
 *   app    -> relay: anything                     -> bridge gets "<cid>\n<message>"
 *   bridge -> relay: "<cid>\n<message>"           -> that app gets "<message>"
 *                    "*\n<message>"               -> every app gets it
 *   relay  -> bridge: "<cid>\n{"$":"open"}" / "<cid>\n{"$":"close"}" when an app comes or goes
 *   relay  -> app:    {"$":"bridge","online":true|false} when the PC comes or goes
 *
 * The relay never reads or stores the messages. Hibernation keeps it free while
 * nobody is talking; "ping" is answered without waking it.
 */

interface Att { role: "bridge" | "app"; cid?: string; name?: string | null }

const att = (ws: WebSocket): Att => (ws.deserializeAttachment() as Att | null) ?? { role: "app" };
const OPEN = 1;

export class Relay {
  constructor(private readonly ctx: DurableObjectState) {
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private bridges(except?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets("bridge").filter((s) => s !== except && s.readyState === OPEN);
  }

  async fetch(req: Request): Promise<Response> {
    const role = req.headers.get("x-gp-role");
    if (role === "status") {
      const b = this.bridges()[0];
      return Response.json({ online: !!b, name: b ? att(b).name ?? null : null });
    }
    if ((req.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    if (role === "bridge") {
      // One PC per account at a time: a new sign-in replaces the old connection.
      for (const old of this.bridges()) { try { old.close(4000, "Another PC connected to this account"); } catch { /* already gone */ } }
      this.ctx.acceptWebSocket(server, ["bridge"]);
      server.serializeAttachment({ role: "bridge", name: (req.headers.get("x-gp-name") ?? "").slice(0, 80) || null } satisfies Att);
      for (const a of this.ctx.getWebSockets("app")) {
        server.send(`${att(a).cid}\n{"$":"open"}`);
        try { a.send('{"$":"bridge","online":true}'); } catch { /* closing */ }
      }
    } else {
      const cid = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
      this.ctx.acceptWebSocket(server, ["app", `app:${cid}`]);
      server.serializeAttachment({ role: "app", cid } satisfies Att);
      const b = this.bridges()[0];
      server.send(JSON.stringify({ $: "bridge", online: !!b }));
      if (b) b.send(`${cid}\n{"$":"open"}`);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): void {
    if (typeof msg !== "string") return;
    const a = att(ws);
    if (a.role === "app") {
      const b = this.bridges()[0];
      if (b) b.send(`${a.cid}\n${msg}`);
      else ws.send('{"$":"bridge","online":false}');
      return;
    }
    const i = msg.indexOf("\n");
    if (i < 1) return;
    const cid = msg.slice(0, i), body = msg.slice(i + 1);
    const to = cid === "*" ? this.ctx.getWebSockets("app") : this.ctx.getWebSockets(`app:${cid}`);
    for (const s of to) { try { s.send(body); } catch { /* closing */ } }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void { this.gone(ws, code, reason); }
  webSocketError(ws: WebSocket): void { this.gone(ws, 1011, "error"); }

  private gone(ws: WebSocket, code: number, reason: string): void {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason); } catch { /* already closed */ }
    const a = att(ws);
    if (a.role === "app") {
      for (const b of this.bridges()) { try { b.send(`${a.cid}\n{"$":"close"}`); } catch { /* closing */ } }
    } else if (this.bridges(ws).length === 0) {
      for (const s of this.ctx.getWebSockets("app")) { try { s.send('{"$":"bridge","online":false}'); } catch { /* closing */ } }
    }
  }
}
