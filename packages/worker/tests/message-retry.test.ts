import { expect, test } from "bun:test";
import { signJwt } from "../src/auth";
import { handleMailRoutes } from "../src/handlers/fetch.routes.mail";

const SECRET = "test-secret";

type DbOp = { sql: string; bindings: unknown[] };

function createDb(opts: { status?: string | null; owner?: string | null; rawKey?: string | null; changes?: number } = {}) {
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
          if (sql.includes("JOIN mailboxes mb")) {
            if (opts.status === null) return null as unknown as T;
            return {
              id: "m1",
              mailbox_id: "mb1",
              status: opts.status ?? "FAILED",
              from_name: null,
              from_address: null,
              subject: null,
              snippet: null,
              received_at: 1,
              parsed_at: null,
              text_plain: null,
              html_r2_key: null,
              html_inline: null,
              ai_code: null,
              ai_service: null,
              mailbox_user_id: opts.owner === undefined ? "u1" : opts.owner,
            } as unknown as T;
          }
          if (sql.includes("SELECT r2_raw_key FROM messages")) {
            return { r2_raw_key: opts.rawKey === undefined ? "raw/m1.eml" : opts.rawKey } as unknown as T;
          }
          return null as unknown as T;
        },
        async run() {
          ops.push({ sql, bindings: stmt._bindings });
          return { success: true, meta: { changes: opts.changes ?? 1 } };
        },
        async all<T>() {
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  };
  return { db, ops };
}

function createEnv(opts: { status?: string | null; owner?: string | null; rawKey?: string | null; changes?: number; failEnqueue?: boolean } = {}) {
  const { db, ops } = createDb(opts);
  const queued: unknown[] = [];
  const env = {
    JWT_SECRET: SECRET,
    DB: db,
    PARSE_QUEUE: {
      send: async (message: unknown) => {
        if (opts.failEnqueue) throw new Error("queue unavailable");
        queued.push(message);
      },
    },
  } as any;
  return { env, ops, queued };
}

async function token(sub = "u1") {
  return signJwt({ sub, username: "alice", exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
}

async function retry(env: unknown, id = "m1", opts: { auth?: boolean; sub?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.auth !== false) headers.authorization = `Bearer ${await token(opts.sub)}`;
  const req = new Request(`https://mail.example.com/api/messages/${encodeURIComponent(id)}/retry`, {
    method: "POST",
    headers,
  });
  const res = await handleMailRoutes(req, env as any, new URL(req.url), new URL(req.url).pathname);
  if (!res) throw new Error("no response");
  return res;
}

test("retrying requires an authenticated session", async () => {
  const { env, queued } = createEnv();
  const res = await retry(env, "m1", { auth: false });
  expect(res.status).toBe(401);
  expect(queued.length).toBe(0);
});

test("a FAILED message is reset to PENDING and re-enqueued", async () => {
  const { env, ops, queued } = createEnv({ status: "FAILED" });
  const res = await retry(env);
  expect(res.status).toBe(202);
  const body = (await res.json()) as any;
  expect(body.status).toBe("PENDING");

  const reset = ops.find((op) => op.sql.includes("SET status='PENDING'"));
  expect(reset).toBeTruthy();
  expect(reset?.sql).toContain("attempt=0");
  expect(reset?.sql).toContain("status='FAILED'");
  expect(queued).toEqual([{ messageId: "m1" }]);
});

test("a SUCCESS message is not re-parsed", async () => {
  const { env, ops, queued } = createEnv({ status: "SUCCESS" });
  const res = await retry(env);
  expect(res.status).toBe(409);
  expect(((await res.json()) as any).error).toBe("already_parsed");
  expect(ops.length).toBe(0);
  expect(queued.length).toBe(0);
});

test("a PENDING message is refused because it is already queued", async () => {
  const { env, ops, queued } = createEnv({ status: "PENDING" });
  const res = await retry(env);
  expect(res.status).toBe(409);
  expect(((await res.json()) as any).error).toBe("not_retryable");
  expect(ops.length).toBe(0);
  expect(queued.length).toBe(0);
});

test("a message owned by someone else is not found", async () => {
  const { env, ops, queued } = createEnv({ status: "FAILED", owner: "other" });
  const res = await retry(env);
  expect(res.status).toBe(404);
  expect(ops.length).toBe(0);
  expect(queued.length).toBe(0);
});

test("an unknown message is not found", async () => {
  const { env } = createEnv({ status: null });
  const res = await retry(env);
  expect(res.status).toBe(404);
});

test("a message whose raw mail is gone cannot be retried", async () => {
  const { env, ops, queued } = createEnv({ status: "FAILED", rawKey: null });
  const res = await retry(env);
  expect(res.status).toBe(409);
  expect(((await res.json()) as any).error).toBe("raw_missing");
  expect(ops.length).toBe(0);
  expect(queued.length).toBe(0);
});

test("losing a concurrent retry race reports not_retryable", async () => {
  const { env, ops, queued } = createEnv({ status: "FAILED", changes: 0 });
  const res = await retry(env);
  expect(res.status).toBe(409);
  expect(((await res.json()) as any).error).toBe("not_retryable");
  expect(ops.length).toBe(1);
  expect(queued.length).toBe(0);
});

test("a failed re-enqueue rolls the row back to FAILED", async () => {
  const { env, ops, queued } = createEnv({ status: "FAILED", failEnqueue: true });
  const res = await retry(env);
  expect(res.status).toBe(502);
  const rollback = ops.find((op) => op.sql.includes("SET status='FAILED'"));
  expect(rollback).toBeTruthy();
  expect(queued.length).toBe(0);
});
