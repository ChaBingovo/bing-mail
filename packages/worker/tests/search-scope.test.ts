import { expect, test } from "bun:test";
import { signJwt } from "../src/auth";
import { toFtsMatch } from "../src/handlers/fetch.shared";
import { handleSearchRoutes } from "../src/handlers/fetch.routes.search";

const JWT_SECRET = "test-secret";

function createDb(opts: { mailboxFound?: boolean; failMatch?: boolean } = {}) {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  const db = {
    calls,
    prepare(sql: string) {
      const stmt = {
        _bindings: [] as unknown[],
        bind(...args: unknown[]) {
          stmt._bindings = args;
          return stmt;
        },
        async first() {
          if (sql.includes("FROM mailboxes WHERE address")) {
            return opts.mailboxFound === false ? null : { id: "mb1", user_id: "u1", address: "me@example.test" };
          }
          return null;
        },
        async all() {
          calls.push({ sql, bindings: stmt._bindings });
          if (opts.failMatch) throw new Error('fts5: syntax error near "OR"');
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return db;
}

async function search(opts: {
  q?: string;
  address?: string;
  mode?: string;
  isAdmin?: boolean;
  cursor?: string;
  db?: ReturnType<typeof createDb>;
}) {
  const db = opts.db ?? createDb();
  const token = await signJwt(
    { sub: "u1", username: "alice", isAdmin: opts.isAdmin, exp: Math.floor(Date.now() / 1000) + 60 },
    JWT_SECRET,
  );
  const params = new URLSearchParams();
  params.set("address", opts.address ?? "me@example.test");
  params.set("q", opts.q ?? "hello");
  if (opts.mode) params.set("mode", opts.mode);
  if (opts.cursor) params.set("cursor", opts.cursor);
  const url = `https://mail.example.test/api/search?${params.toString()}`;
  const req = new Request(url, { headers: { authorization: `Bearer ${token}` } });
  const env = { JWT_SECRET, DB: db } as any;
  const res = await handleSearchRoutes(req, env, new URL(req.url), "/api/search");
  return { res, db };
}

test("advanced mode passes FTS operators through, the default quotes them", () => {
  expect(toFtsMatch("foo OR bar", { advanced: true })).toBe("foo OR bar");
  expect(toFtsMatch("foo* NOT spam", { advanced: true })).toBe("foo* NOT spam");
  expect(toFtsMatch("foo OR bar")).toBe('"foo" "OR" "bar"');
  // Whitespace is still trimmed and empty input still refused in advanced mode.
  expect(toFtsMatch("  spaced  ", { advanced: true })).toBe("spaced");
  expect(toFtsMatch("   ", { advanced: true })).toBeNull();
});

test("advanced mode forwards the raw expression to the database", async () => {
  const { res, db } = await search({ q: "hello OR world", mode: "advanced" });
  expect(res?.status).toBe(200);
  expect(db.calls[0]?.bindings[0]).toBe("hello OR world");
});

test("the default mode still neutralises operators", async () => {
  const { res, db } = await search({ q: "hello OR world" });
  expect(res?.status).toBe(200);
  expect(db.calls[0]?.bindings[0]).toBe('"hello" "OR" "world"');
});

test("a malformed advanced expression becomes a 400, not a 500", async () => {
  const { res } = await search({ q: "broken AND", mode: "advanced", db: createDb({ failMatch: true }) });
  expect(res?.status).toBe(400);
  expect(((await res!.json()) as { error: string }).error).toBe("invalid_query");
});

test("a cross-mailbox search is refused for a normal user", async () => {
  const { res, db } = await search({ address: "*" });
  expect(res?.status).toBe(403);
  expect(((await res!.json()) as { error: string }).error).toBe("forbidden");
  expect(db.calls.length).toBe(0);
});

test("an admin cross-mailbox search omits the mailbox filter", async () => {
  const { res, db } = await search({ address: "*", isAdmin: true });
  expect(res?.status).toBe(200);
  const call = db.calls[0];
  expect(call).toBeTruthy();
  expect(call.sql).not.toContain("m.mailbox_id");
  // match + limit only
  expect(call.bindings).toEqual(["\"hello\"", 50]);
});

test("a normal search stays scoped to the caller's mailbox", async () => {
  const { res, db } = await search({ address: "me@example.test" });
  expect(res?.status).toBe(200);
  const call = db.calls[0];
  expect(call.sql).toContain("m.mailbox_id = ?2");
  expect(call.bindings).toEqual(["\"hello\"", "mb1", 50]);
});

test("cursor pagination keeps the placeholder numbering contiguous per scope", async () => {
  const cursor = btoa("1700000000000:m9");

  const scoped = await search({ address: "me@example.test", cursor });
  expect(scoped.db.calls[0].sql).toContain("LIMIT ?5");
  expect(scoped.db.calls[0].bindings).toEqual(["\"hello\"", "mb1", 1700000000000, "m9", 50]);

  const all = await search({ address: "*", isAdmin: true, cursor });
  expect(all.db.calls[0].sql).toContain("LIMIT ?4");
  expect(all.db.calls[0].bindings).toEqual(["\"hello\"", 1700000000000, "m9", 50]);
});

test("a mailbox the caller does not own is not found", async () => {
  const { res } = await search({ address: "other@example.test", db: createDb({ mailboxFound: false }) });
  expect(res?.status).toBe(404);
});
