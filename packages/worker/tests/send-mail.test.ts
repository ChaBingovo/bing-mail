import { expect, test } from "bun:test";
import { signJwt } from "../src/auth";
import { handleUserRoutes } from "../src/handlers/fetch.routes.user";

const SECRET = "test-secret";
const MAILBOX = { id: "mb1", address: "me@example.test" };

type DbOp = { sql: string; bindings: unknown[] };

function createDb(opts: { mailbox?: { id: string; address: string } | null; alias?: boolean; sent?: unknown[] } = {}) {
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
          if (sql.includes("FROM mailbox_aliases")) {
            return (opts.alias ? { ok: 1 } : null) as unknown as T;
          }
          return null as unknown as T;
        },
        async run() {
          ops.push({ sql, bindings: stmt._bindings });
          return { success: true, meta: { changes: 1 } };
        },
        async all<T>() {
          return { results: (opts.sent ?? []) as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  };
  return { db, ops };
}

type SentCall = Record<string, unknown>;

function createEnv(opts: { mailbox?: { id: string; address: string } | null; alias?: boolean; sent?: unknown[]; fail?: boolean; noBinding?: boolean } = {}) {
  const { db, ops } = createDb(opts);
  const sent: SentCall[] = [];
  const env = {
    JWT_SECRET: SECRET,
    DB: db,
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
