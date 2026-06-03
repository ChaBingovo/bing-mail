type NotifyPayload = {
  messageId: string;
  receivedAt: number;
};

export class MailEventsDO {
  private state: DurableObjectState;
  private maxConnections: number;

  constructor(state: DurableObjectState, env: Record<string, unknown>) {
    this.state = state;
    const raw = Number(typeof env.WS_MAX_CONNECTIONS === "string" ? env.WS_MAX_CONNECTIONS.trim() : env.WS_MAX_CONNECTIONS);
    this.maxConnections = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
  }

  async fetch(request: Request) {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("upgrade required", { status: 426 });
      }

      if (this.state.getWebSockets().length >= this.maxConnections) {
        return new Response("rate limited", { status: 429 });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      this.state.acceptWebSocket(server);
      server.addEventListener("message", (evt) => {
        const msg = typeof evt.data === "string" ? evt.data : "";
        if (msg === "ping") server.send("pong");
      });

      const res = new Response(null, { status: 101, webSocket: client } as any);
      if (!(res as any).webSocket) Object.defineProperty(res, "webSocket", { value: client, configurable: true });
      return res;
    }

    if (url.pathname === "/notify" && request.method === "POST") {
      let payload: NotifyPayload | null = null;
      try {
        payload = (await request.json()) as NotifyPayload;
      } catch {
        payload = null;
      }

      if (!payload?.messageId || typeof payload.receivedAt !== "number") {
        return new Response("bad request", { status: 400 });
      }

      const data = JSON.stringify({ type: "hint", ...payload });
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.send(data);
        } catch {
          try {
            ws.close();
          } catch {}
        }
      }

      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }
}
