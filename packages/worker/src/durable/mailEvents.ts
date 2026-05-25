type NotifyPayload = {
  messageId: string;
  receivedAt: number;
};

export class MailEventsDO {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request) {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("upgrade required", { status: 426 });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      this.state.acceptWebSocket(server);
      server.addEventListener("message", (evt) => {
        const msg = typeof evt.data === "string" ? evt.data : "";
        if (msg === "ping") server.send("pong");
      });

      return new Response(null, { status: 101, webSocket: client });
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

