import { expect, test } from "bun:test";
import { signJwt } from "../src/auth";
import { getMailboxUnread, markMailboxRead } from "../src/handlers/fetch.shared";
import { handleUserRoutes } from "../src/handlers/fetch.routes.user";

const SECRET = "test-secret";
const MAILBOX = { id: "mb1", address: "me@example.test" };

/** Records the marker so tests can assert "forward only" behaviour. */
function createDb(opts: { lastReadAt?: number | null; newCount?: number; latest?: number | null } = {}) {
  const runs: { sql: string; bindings: unknown[] }[] = [];
  let stored = opts.lastReadAt ?? null;

  const db = {
    prepare(sql: string) {
      const stmt = {
        _bindings: [] as unknown[],
        bind(...args: unknown[]) {
          stmt._bindings = args;
          return stmt;
        },
        async first<T>() {
          // Order matters: the red-dot route selects `id, address` (no last_read_at),
          // while getMailboxReadState selects the marker column on its own.
          if (sql.includes("SELECT last_read_at FROM mailboxes")) {
            return { last_read_at: stored } as unknown as T;
          }
          if (sql.includes("COUNT(1) AS new_count")) {
            return { new_count: opts.newCount ?? 0, latest_new_received_at: opts.latest ?? null } as unknown as T;
          }
          if (sql.includes("MAX(received_at) AS latest_received_at")) {
            return { latest_received_at: opts.latest ?? null } as unknown as T;
          }
          if (sql.includes("FROM mailboxes WHERE user_id")) {
            return MAILBOX as unknown as T;
          }
          return null as unknown as T;
        },
        async run() {
          runs.push({ sql, bindings: stmt._bindings });
          // Emulate the "only move forward" guard in the UPDATE itself.
          if (sql.includes("SET last_read_at")) {
            const next = Number(stmt._bindings[1]) || 0;
            if (stored === null || stored < next) stored = next;
          }
          return { success: true, meta: { changes: 1 } };
        },
        async all<T>() {
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  };
  return { db, runs, getStored: () => stored };
}

function envWith(db: unknown) {
  return { JWT_SECRET: SECRET, DB: db } as any;
}

async function token(isAdmin = false) {
  return signJwt({ sub: "u1", username: "alice", isAdmin, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
}

async function call(env: unknown, pathWithQuery: string, init: RequestInit = {}) {
  const req = new Request(`https://mail.example.com${pathWithQuery}`, {
    ...init,
    headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json", ...(init.headers || {}) },
  });
  const url = new URL(req.url);
  return handleUserRoutes(req, env as any, url, url.pathname);
}

test("the read marker only moves forward", async () => {
  const { db, getStored } = createDb({ lastReadAt: null });

  await markMailboxRead(envWith(db), MAILBOX.id, 1000);
  expect(getStored()).toBe(1000);

  // An older value must not roll the marker back.
  await markMailboxRead(envWith(db), MAILBOX.id, 500);
  expect(getStored()).toBe(1000);

  await markMailboxRead(envWith(db), MAILBOX.id, 2000);
  expect(getStored()).toBe(2000);
});

test("a non-positive marker is ignored", async () => {
  const { db, getStored } = createDb({ lastReadAt: 1234 });
  await markMailboxRead(envWith(db), MAILBOX.id, 0);
  expect(getStored()).toBe(1234);
});

test("unread counts come from the stored marker, not the query string", async () => {
  const { db } = createDb({ lastReadAt: 5000, newCount: 7, latest: 9000 });
  const result = await getMailboxUnread(envWith(db), MAILBOX.id);
  expect(result).toEqual({ newCount: 7, latestReceivedAt: 9000, latestNewReceivedAt: 9000 });
});

test("POST /api/user/read stores the marker and returns unread state", async () => {
  const { db, getStored } = createDb({ lastReadAt: null, newCount: 0 });
  const res = await call(envWith(db), "/api/user/read", {
    method: "POST",
    body: JSON.stringify({ receivedAt: 4242 }),
  });
  expect(res?.status).toBe(200);
  const body = (await res!.json()) as any;
  expect(body.since).toBe(4242);
  expect(body.newCount).toBe(0);
  expect(getStored()).toBe(4242);
});

test("POST /api/user/read rejects a missing or non-numeric marker", async () => {
  const { db, getStored } = createDb({ lastReadAt: null });
  const missing = await call(envWith(db), "/api/user/read", { method: "POST", body: JSON.stringify({}) });
  expect(missing?.status).toBe(400);

  const junk = await call(envWith(db), "/api/user/read", {
    method: "POST",
    body: JSON.stringify({ receivedAt: "abc" }),
  });
  expect(junk?.status).toBe(400);
  expect(getStored()).toBeNull();
});

test("GET /api/user/red-dot ignores a client-supplied since", async () => {
  const { db } = createDb({ lastReadAt: 7777, newCount: 3, latest: 8888 });
  const res = await call(envWith(db), "/api/user/red-dot?since=1", { method: "GET" });
  expect(res?.status).toBe(200);
  const body = (await res!.json()) as any;
  // The reported marker is the server's, so an old client cannot resurrect unread mail.
  expect(body.since).toBe(7777);
  expect(body.newCount).toBe(3);
});

test("read endpoints require a session", async () => {
  const { db } = createDb();
  const req = new Request("https://mail.example.com/api/user/read", {
    method: "POST",
    body: JSON.stringify({ receivedAt: 1 }),
  });
  const res = await handleUserRoutes(req, envWith(db), new URL(req.url), "/api/user/read");
  expect(res?.status).toBe(401);
});

test("GET /api/user/messages filters by primary mailbox or active alias when address is supplied", async () => {
  const queries: { sql: string; bindings: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const stmt = {
        _bindings: [] as unknown[],
        bind(...args: unknown[]) {
          stmt._bindings = args;
          return stmt;
        },
        async first<T>() {
          if (sql.includes("FROM mailboxes WHERE user_id")) return MAILBOX as unknown as T;
          if (sql.includes("FROM mailbox_aliases") && stmt._bindings[1] === "alias@example.test") {
            return { ok: 1 } as unknown as T;
          }
          return null as unknown as T;
        },
        async all<T>() {
          queries.push({ sql, bindings: stmt._bindings });
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  };

  const allRes = await call(envWith(db), "/api/user/messages", { method: "GET" });
  expect(allRes?.status).toBe(200);
  expect(queries[0].sql).not.toContain("to_address =");

  const primaryRes = await call(envWith(db), "/api/user/messages?address=me@example.test", { method: "GET" });
  expect(primaryRes?.status).toBe(200);
  expect(queries[1].sql).toContain("(to_address = ?2 OR to_address IS NULL)");
  expect(queries[1].bindings).toContain("me@example.test");

  const aliasRes = await call(envWith(db), "/api/user/messages?address=alias@example.test", { method: "GET" });
  expect(aliasRes?.status).toBe(200);
  expect(queries[2].sql).toContain("to_address = ?2");
  expect(queries[2].sql).not.toContain("to_address IS NULL");
  expect(queries[2].bindings).toContain("alias@example.test");

  const unknownRes = await call(envWith(db), "/api/user/messages?address=other@example.test", { method: "GET" });
  expect(unknownRes?.status).toBe(404);
});
