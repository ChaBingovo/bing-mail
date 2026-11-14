import { expect, test } from "bun:test";
import { signJwt } from "../src/auth";
import { handleUserRoutes } from "../src/handlers/fetch.routes.user";

const SECRET = "test-secret";
const MAILBOX = { id: "mb1", address: "me@example.test" };

type DbOp = { sql: string; bindings: unknown[] };

function createDb(
  opts: {
    mailbox?: { id: string; address: string } | null;
    internalTarget?: { id: string; user_id: string; address: string } | null;
    alias?: boolean;
    aliases?: string[];
    sent?: unknown[];
    failRecord?: boolean;
    sendProvider?: "none" | "cloudflare" | "resend";
    domainProviders?: Record<string, string>;
  } = {},
) {
  const ops: DbOp[] = [];
  const db = {
    prepare(sql: string) {
      const stmt = {
        _bindings: [] as unknown[],
        bind(...args: unknown[]) {
          stmt._bindings = args;
          return stmt;
        },
        async first<T>() {
          if (sql.includes("FROM mailboxes WHERE user_id")) {
            const mailbox = opts.mailbox === undefined ? MAILBOX : opts.mailbox;
            return mailbox as unknown as T;
          }
          if (sql.includes("FROM mailboxes WHERE address")) {
            const addr = String(stmt._bindings[0] || "");
            if (opts.internalTarget && opts.internalTarget.address === addr) {
              return opts.internalTarget as unknown as T;
            }
            return null as unknown as T;
          }
          if (sql.includes("FROM mailbox_aliases")) {
            return (opts.alias ? { ok: 1 } : null) as unknown as T;
          }
          if (sql.includes("FROM domains WHERE domain")) {
            const domain = String(stmt._bindings[0] || "");
            const provider = opts.domainProviders?.[domain] ?? opts.sendProvider ?? "cloudflare";
            return { send_provider: provider } as unknown as T;
          }
          return null as unknown as T;
        },
        async run() {
          if (opts.failRecord && sql.includes("'SENT'")) throw new Error("d1 unavailable");
          ops.push({ sql, bindings: stmt._bindings });
          return { success: true, meta: { changes: 1 } };
        },
        async all<T>() {
          if (sql.includes("FROM mailbox_aliases")) {
            return { results: (opts.aliases ?? []).map((address) => ({ address })) as T[], success: true, meta: {} };
          }
          if (sql.includes("FROM domains WHERE is_active")) {
            const map = opts.domainProviders ?? { "example.test": opts.sendProvider ?? "cloudflare" };
            const results = Object.entries(map).map(([domain, send_provider]) => ({ domain, send_provider }));
            return { results: results as T[], success: true, meta: {} };
          }
          return { results: (opts.sent ?? []) as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  };
  return { db, ops };
}

type SentCall = Record<string, unknown>;

function createEnv(
  opts: {
    mailbox?: { id: string; address: string } | null;
    internalTarget?: { id: string; user_id: string; address: string } | null;
    alias?: boolean;
    aliases?: string[];
    sent?: unknown[];
    fail?: boolean;
    noBinding?: boolean;
    failRecord?: boolean;
    sendProvider?: "none" | "cloudflare" | "resend";
    domainProviders?: Record<string, string>;
    resendApiKey?: string;
  } = {},
) {
  const { db, ops } = createDb(opts);
  const sent: SentCall[] = [];
  const env = {
    JWT_SECRET: SECRET,
    DB: db,
    ...(opts.resendApiKey !== undefined ? { RESEND_API_KEY: opts.resendApiKey } : {}),
    ...(opts.noBinding
      ? {}
      : {
          EMAIL: {
            send: async (message: SentCall) => {
              sent.push(message);
              if (opts.fail) throw new Error("smtp rejected the message");
              return { messageId: "cf-abc123" };
            },
          },
        }),
  } as any;
  return { env, ops, sent };
}

async function token() {
  return signJwt({ sub: "u1", username: "alice", exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
}

async function send(env: unknown, body: unknown, opts: { auth?: boolean } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.auth !== false) headers.authorization = `Bearer ${await token()}`;
  const req = new Request("https://mail.example.com/api/user/send", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const res = await handleUserRoutes(req, env as any, new URL(req.url), "/api/user/send");
  if (!res) throw new Error("no response");
  return res;
}

test("sending requires an authenticated session", async () => {
  const { env, sent } = createEnv();
  const res = await send(env, { to: "you@example.com", text: "hi" }, { auth: false });
  expect(res.status).toBe(401);
  expect(sent.length).toBe(0);
});

test("a valid message is sent and recorded as SENT", async () => {
  const { env, ops, sent } = createEnv();
  const res = await send(env, { to: "you@example.com", subject: "Hello", text: "body" });
  expect(res.status).toBe(201);
  const body = (await res.json()) as any;
  expect(body.message.status).toBe("SENT");
  expect(body.message.from).toBe(MAILBOX.address);
  expect(sent.length).toBe(1);
  expect(sent[0].from).toBe(MAILBOX.address);
  expect(sent[0].to).toEqual(["you@example.com"]);
  expect(sent[0].subject).toBe("Hello");
  const insert = ops.find((op) => op.sql.includes("INSERT INTO sent_messages"));
  expect(insert?.sql).toContain("'SENT'");
  expect(insert?.bindings[2]).toBe(MAILBOX.address);
});

test("a comma separated recipient list is split and normalised", async () => {
  const { env, sent } = createEnv();
  const res = await send(env, { to: "A@Example.com, b@example.com;c@example.com", text: "hi" });
  expect(res.status).toBe(201);
  expect(sent[0].to).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
});

test("a missing or malformed recipient is refused before sending", async () => {
  const { env, sent } = createEnv();
  expect((await send(env, { text: "hi" })).status).toBe(400);
  expect((await send(env, { to: "not-an-address", text: "hi" })).status).toBe(400);
  expect((await send(env, { to: "a@b", text: "hi" })).status).toBe(400);
  expect(sent.length).toBe(0);
});

test("too many recipients are rejected", async () => {
  const { env, sent } = createEnv();
  const many = Array.from({ length: 21 }, (_, i) => `u${i}@example.com`).join(",");
  const res = await send(env, { to: many, text: "hi" });
  expect(res.status).toBe(400);
  expect(sent.length).toBe(0);
});

test("an empty body is rejected", async () => {
  const { env, sent } = createEnv();
  expect((await send(env, { to: "you@example.com", subject: "s" })).status).toBe(400);
  expect(sent.length).toBe(0);
});

test("an oversized body is rejected with 413", async () => {
  const { env, sent } = createEnv();
  const res = await send(env, { to: "you@example.com", text: "x".repeat(512 * 1024 + 1) });
  expect(res.status).toBe(413);
  expect(sent.length).toBe(0);
});

test("a from address must be the primary mailbox or one of its aliases", async () => {
  const owned = createEnv({ alias: true });
  expect((await send(owned.env, { to: "you@example.com", from: "alias@example.test", text: "hi" })).status).toBe(201);
  expect(owned.sent[0].from).toBe("alias@example.test");

  const notOwned = createEnv({ alias: false });
  const res = await send(notOwned.env, { to: "you@example.com", from: "someone@else.test", text: "hi" });
  expect(res.status).toBe(400);
  expect(notOwned.sent.length).toBe(0);
});

test("a missing mailbox is reported instead of sending", async () => {
  const { env, sent } = createEnv({ mailbox: null });
  const res = await send(env, { to: "you@example.com", text: "hi" });
  expect(res.status).toBe(409);
  expect(sent.length).toBe(0);
});

test("an unconfigured send_email binding becomes a 503", async () => {
  const { env } = createEnv({ noBinding: true });
  const res = await send(env, { to: "you@example.com", text: "hi" });
  expect(res.status).toBe(503);
  expect(((await res.json()) as any).error).toBe("mail_not_configured");
});

test("a provider failure is recorded as FAILED and surfaces as 502", async () => {
  const { env, ops } = createEnv({ fail: true });
  const res = await send(env, { to: "you@example.com", subject: "Hello", text: "body" });
  expect(res.status).toBe(502);
  const insert = ops.find((op) => op.sql.includes("INSERT INTO sent_messages"));
  expect(insert?.sql).toContain("'FAILED'");
  expect(String(insert?.bindings[6])).toContain("smtp rejected");
});

test("a send that succeeded is reported as sent even if recording it fails", async () => {
  const { env, ops, sent } = createEnv({ failRecord: true });
  const res = await send(env, { to: "you@example.com", subject: "Hello", text: "body" });
  expect(res.status).toBe(201);
  const body = (await res.json()) as any;
  expect(body.message.status).toBe("SENT");
  // The provider accepted the mail, so it must never be reported as failed.
  expect(sent.length).toBe(1);
  expect(ops.some((op) => op.sql.includes("'FAILED'"))).toBe(false);
});

test("the sent list maps database rows to the wire shape", async () => {
  const { env } = createEnv({
    sent: [
      {
        id: "s1",
        from_address: MAILBOX.address,
        to_address: "you@example.com",
        subject: "Hello",
        snippet: "body",
        status: "SENT",
        error_reason: null,
        sent_at: 1700000000000,
      },
    ],
  });
  const req = new Request("https://mail.example.com/api/user/sent", {
    headers: { authorization: `Bearer ${await token()}` },
  });
  const res = await handleUserRoutes(req, env, new URL(req.url), "/api/user/sent");
  expect(res?.status).toBe(200);
  const body = (await res!.json()) as any;
  expect(body.messages.length).toBe(1);
  expect(body.messages[0]).toEqual({
    id: "s1",
    fromAddress: MAILBOX.address,
    toAddress: "you@example.com",
    subject: "Hello",
    snippet: "body",
    status: "SENT",
    errorReason: null,
    sentAt: 1700000000000,
  });
});

test("domain with send_provider=none returns 503 even when EMAIL binding exists", async () => {
  const { env } = createEnv({ sendProvider: "none" });
  const res = await send(env, { to: "you@example.com", text: "hi" });
  expect(res.status).toBe(503);
  expect((await res.json()) as unknown).toEqual({ error: "mail_not_configured" });
});

test("domain with send_provider=resend returns 503 when RESEND_API_KEY is missing", async () => {
  const { env } = createEnv({ sendProvider: "resend" });
  const res = await send(env, { to: "you@example.com", text: "hi" });
  expect(res.status).toBe(503);
  expect((await res.json()) as unknown).toEqual({ error: "mail_not_configured" });
});

test("domain with send_provider=resend sends via Resend API when configured", async () => {
  const { env, ops } = createEnv({ sendProvider: "resend", resendApiKey: "re_test_123" });
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; auth: string | null; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      auth: headers.get("Authorization"),
      body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ id: "re_msg_999" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const res = await send(env, { to: "you@example.com", subject: "Resend Hi", text: "hello" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.messageId).toBe("re_msg_999");
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].auth).toBe("Bearer re_test_123");
    expect(calls[0].body.from).toBe(MAILBOX.address);
    expect(ops.some((o) => o.sql.includes("'SENT'"))).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("/api/user/mailbox reports canSend and per-domain sendableAddresses", async () => {
  const { env } = createEnv({
    aliases: ["alias@second.test"],
    domainProviders: { "example.test": "none", "second.test": "resend" },
    resendApiKey: "re_test_123",
  });
  const req = new Request("https://mail.example.com/api/user/mailbox", {
    headers: { authorization: `Bearer ${await token()}` },
  });
  const res = await handleUserRoutes(req, env, new URL(req.url), "/api/user/mailbox");
  expect(res?.status).toBe(200);
  expect((await res!.json()) as unknown).toEqual({
    address: MAILBOX.address,
    canSend: true,
    sendableAddresses: ["alias@second.test"],
  });

  const disabledEnv = createEnv({
    domainProviders: { "example.test": "none" },
  }).env;
  const req2 = new Request("https://mail.example.com/api/user/mailbox", {
    headers: { authorization: `Bearer ${await token()}` },
  });
  const res2 = await handleUserRoutes(req2, disabledEnv, new URL(req2.url), "/api/user/mailbox");
  expect(res2?.status).toBe(200);
  expect((await res2!.json()) as unknown).toEqual({
    address: MAILBOX.address,
    canSend: false,
    sendableAddresses: [],
  });
});

test("internal mailbox delivery succeeds even when send_provider=none and EMAIL binding is missing", async () => {
  const { env, ops } = createEnv({
    noBinding: true,
    sendProvider: "none",
    internalTarget: { id: "mb2", user_id: "u2", address: "bob@example.test" },
  });
  const res = await send(env, { to: "bob@example.test", subject: "Internal Hi", text: "hello bob" });
  expect(res.status).toBe(201);
  const body = (await res.json()) as any;
  expect(body.message.status).toBe("SENT");
  expect(ops.some((o) => o.sql.includes("INSERT INTO messages "))).toBe(true);
  expect(ops.some((o) => o.sql.includes("INSERT INTO sent_messages "))).toBe(true);
});
