import { expect, test } from "bun:test";
import { signJwt } from "../src/auth";
import { handleMailRoutes } from "../src/handlers/fetch.routes.mail";

const SECRET = "test-secret";

function createEnv(
  opts: {
    owner?: string | null;
    rawKey?: string | null;
    htmlKey?: string | null;
    attachments?: { r2_key: string }[];
    failDelete?: boolean;
    found?: boolean;
  } = {},
) {
  const deleted: string[][] = [];
  const batches: string[][] = [];

  const db = {
    prepare(sql: string) {
      const stmt = {
        sql,
        bind() {
          return stmt;
        },
        async first<T>() {
          if (sql.includes("JOIN mailboxes mb")) {
            if (opts.found === false) return null as unknown as T;
            return {
              id: "m1",
              mailbox_id: "mb1",
              status: "SUCCESS",
              r2_raw_key: opts.rawKey === undefined ? "raw/m1.eml" : opts.rawKey,
              html_r2_key: opts.htmlKey ?? null,
              mailbox_user_id: opts.owner === undefined ? "u1" : opts.owner,
            } as unknown as T;
          }
          return null as unknown as T;
        },
        async all<T>() {
          if (sql.includes("FROM message_attachments")) {
            return { results: (opts.attachments ?? []) as T[], success: true, meta: {} };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: { changes: 1 } };
        },
      };
      return stmt;
    },
    async batch(statements: { sql: string }[]) {
      batches.push(statements.map((s) => s.sql));
      return [];
    },
  };

  const env = {
    JWT_SECRET: SECRET,
    DB: db,
    MAIL_BUCKET: {
      async delete(keys: string | string[]) {
        if (opts.failDelete) throw new Error("r2 unavailable");
        deleted.push(Array.isArray(keys) ? keys : [keys]);
      },
      async head() {
        return { key: "raw/m1.eml", size: 10 };
      },
    },
  } as any;

  return { env, deleted, batches };
}

async function del(env: unknown, id = "m1", opts: { auth?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (opts.auth !== false) {
    headers.authorization = `Bearer ${await signJwt(
      { sub: "u1", username: "alice", exp: Math.floor(Date.now() / 1000) + 3600 },
      SECRET,
    )}`;
  }
  const path = `/api/messages/${encodeURIComponent(id)}`;
  const req = new Request(`https://mail.example.com${path}`, { method: "DELETE", headers });
  return handleMailRoutes(req, env as any, new URL(req.url), path);
}

test("deleting requires an authenticated session", async () => {
  const { env, deleted } = createEnv();
  const res = await del(env, "m1", { auth: false });
  expect(res?.status).toBe(401);
  expect(deleted.length).toBe(0);
});

test("a delete removes R2 objects first, then the rows", async () => {
  const { env, deleted, batches } = createEnv({
    rawKey: "raw/m1.eml",
    htmlKey: "archive/html/m1.html",
    attachments: [{ r2_key: "archive/attachments/m1/0-a.png" }],
  });
  const res = await del(env);
  expect(res?.status).toBe(204);
  // Everything the message owns goes in one R2 delete call.
  expect(deleted).toEqual([["raw/m1.eml", "archive/html/m1.html", "archive/attachments/m1/0-a.png"]]);
  expect(batches.length).toBe(1);
  expect(batches[0].some((s) => s.includes("messages_fts"))).toBe(true);
  expect(batches[0].some((s) => s.includes("message_attachments"))).toBe(true);
  expect(batches[0].some((s) => s.includes("DELETE FROM messages"))).toBe(true);
});

test("a message owned by someone else is not found and nothing is deleted", async () => {
  const { env, deleted, batches } = createEnv({ owner: "other" });
  const res = await del(env);
  expect(res?.status).toBe(404);
  expect(deleted.length).toBe(0);
  expect(batches.length).toBe(0);
});

test("an unknown message is not found", async () => {
  const { env } = createEnv({ found: false });
  const res = await del(env);
  expect(res?.status).toBe(404);
});

test("an R2 failure aborts before the rows are dropped", async () => {
  // Ordering guarantee: a failed R2 delete must leave the row so the retention
  // sweep retries it, rather than orphaning bytes nobody references.
  const { env, batches } = createEnv({ failDelete: true });
  const res = await del(env);
  expect(res?.status).toBe(502);
  expect(((await res!.json()) as any).error).toBe("delete_failed");
  expect(batches.length).toBe(0);
});

test("a message with no R2 keys still deletes its rows", async () => {
  const { env, deleted, batches } = createEnv({ rawKey: null, htmlKey: null });
  const res = await del(env);
  expect(res?.status).toBe(204);
  expect(deleted.length).toBe(0);
  expect(batches.length).toBe(1);
});
