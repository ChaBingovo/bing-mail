import { expect, test } from "bun:test";
import { signJwt } from "../src/auth";
import { handleUserRoutes } from "../src/handlers/fetch.routes.user";
import { MailEventsDO } from "../src/durable/mailEvents";

type Listener = (evt: { data?: unknown }) => void;

class MockWebSocket {
  private peer: MockWebSocket | null = null;
  private listeners: Record<string, Listener[]> = {};

  attachPeer(peer: MockWebSocket) {
    this.peer = peer;
  }

  addEventListener(type: string, cb: Listener) {
    (this.listeners[type] ||= []).push(cb);
  }

  send(data: unknown) {
    this.peer?._emit("message", { data });
  }

  close() {}

  private _emit(type: string, evt: { data?: unknown }) {
    for (const cb of this.listeners[type] || []) cb(evt);
  }
}

class MockWebSocketPair {
  constructor() {
    const a = new MockWebSocket();
    const b = new MockWebSocket();
    a.attachPeer(b);
    b.attachPeer(a);
    return [a, b] as any;
  }
}

function createState() {
  const sockets: any[] = [];
  return {
    acceptWebSocket(ws: any) {
      sockets.push(ws);
    },
    getWebSockets() {
      return sockets.slice();
    },
  };
}

function createDb(address: string) {
  return {
    prepare(sql: string) {
      return {
        bind(userId: string) {
          return {
            async first<T>() {
              if (sql.startsWith("SELECT address FROM mailboxes")) {
                if (userId === "u1") return { address } as any as T;
                return null as any as T;
              }
              throw new Error(`unexpected sql: ${sql}`);
            },
          };
        },
      };
    },
  };
}

test("/api/user/ws unauthorized without token", async () => {
  const req = new Request("https://local/api/user/ws", { headers: { upgrade: "websocket" } });
  const env = { JWT_SECRET_CURRENT: "secret" } as any;
  const res = await handleUserRoutes(req, env, new URL(req.url), "/api/user/ws");
  expect(res?.status).toBe(401);
});

test("/api/user/ws upgrade, ping/pong, connection limit, notify fanout", async () => {
  (globalThis as any).WebSocketPair = MockWebSocketPair;

  const jwtSecret = "secret";
  const token = await signJwt({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 60 }, jwtSecret);

  const state = createState();
  const mailEvents = new MailEventsDO(state as any, { WS_MAX_CONNECTIONS: "2" });
  const namespace = {
    idFromName() {
      return "id-1";
    },
    get() {
      return { fetch: (req: Request) => mailEvents.fetch(req) };
    },
  };

  const env = {
    JWT_SECRET_CURRENT: jwtSecret,
    DB: createDb("u1@example.com"),
    MAIL_EVENTS: namespace,
  } as any;

  const connect = async () => {
    const req = new Request(`https://local/api/user/ws?token=${encodeURIComponent(token)}`, { headers: { upgrade: "websocket" } });
    const res = await handleUserRoutes(req, env, new URL(req.url), "/api/user/ws");
    expect(res?.status).toBe(101);
    const ws = (res as any).webSocket as MockWebSocket;
    expect(ws).toBeTruthy();
    return ws;
  };

  const ws1 = await connect();
  const ws2 = await connect();

  const req3 = new Request(`https://local/api/user/ws?token=${encodeURIComponent(token)}`, { headers: { upgrade: "websocket" } });
  const res3 = await handleUserRoutes(req3, env, new URL(req3.url), "/api/user/ws");
  expect(res3?.status).toBe(429);

  const ws1Msgs: unknown[] = [];
  ws1.addEventListener("message", (evt) => ws1Msgs.push(evt.data));
  ws1.send("ping");
  expect(ws1Msgs).toContain("pong");

  const hints1: string[] = [];
  const hints2: string[] = [];
  ws1.addEventListener("message", (evt) => {
    if (typeof evt.data === "string" && evt.data.includes('"type":"hint"')) hints1.push(evt.data);
  });
  ws2.addEventListener("message", (evt) => {
    if (typeof evt.data === "string" && evt.data.includes('"type":"hint"')) hints2.push(evt.data);
  });

  const notifyReq = new Request("https://mail-events/notify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messageId: "m1", receivedAt: 123 }),
  });
  const notifyRes = await mailEvents.fetch(notifyReq);
  expect(notifyRes.status).toBe(200);
  expect(hints1.length).toBe(1);
  expect(hints2.length).toBe(1);
});

