import { expect, test } from "bun:test";
import { signJwt } from "../src/auth";
import { toFtsMatch } from "../src/handlers/fetch.shared";
import { handleSearchRoutes } from "../src/handlers/fetch.routes.search";

const JWT_SECRET = "test-secret";

test("every token is quoted so FTS operators become literal text", () => {
  expect(toFtsMatch("hello")).toBe('"hello"');
  expect(toFtsMatch("hello world")).toBe('"hello" "world"');
  expect(toFtsMatch("verification code")).toBe('"verification" "code"');
});

test("punctuation that would break FTS syntax is neutralised", () => {
  expect(toFtsMatch('say "hi"')).toBe('"say" """hi"""');
  expect(toFtsMatch("a:b")).toBe('"a:b"');
  expect(toFtsMatch("foo(bar) OR baz*")).toBe('"foo(bar)" "OR" "baz*"');
  expect(toFtsMatch("--")).toBe('"--"');
  expect(toFtsMatch("验证码")).toBe('"验证码"');
});

test("empty or whitespace-only input is rejected", () => {
  expect(toFtsMatch("")).toBeNull();
  expect(toFtsMatch("   ")).toBeNull();
  expect(toFtsMatch("\t\n ")).toBeNull();
});

test("absurdly long input is truncated, not forwarded as-is", () => {
  const long = "x".repeat(5000);
  const out = toFtsMatch(long);
  expect(out).not.toBeNull();
  expect(out!.length).toBeLessThanOrEqual(202);
});

function createDb(opts: { failMatch?: boolean } = {}) {
  const bound: unknown[][] = [];
  return {
    bound,
    prepare(sql: string) {
      if (sql.includes("FROM mailboxes WHERE address")) {
        const stmt = {
          bind: () => stmt,
          first: async () => ({ id: "mb1", user_id: "u1", address: "me@example.test" }),
        };
        return stmt;
      }
      if (sql.includes("messages_fts MATCH")) {
        const stmt = {
          bind(...args: unknown[]) {
            bound.push(args);
            return stmt;
          },
          async all() {
            if (opts.failMatch) throw new Error('fts5: syntax error near """');
            return { results: [] };
          },
        };
        return stmt;
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
}

async function search(q: string, db = createDb()) {
  const token = await signJwt({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 60 }, JWT_SECRET);
  const url = `https://mail.example.test/api/search?address=me@example.test&q=${encodeURIComponent(q)}`;
  const req = new Request(url, { headers: { cookie: `bingmail_session=${encodeURIComponent(token)}` } });
  const env = { JWT_SECRET, DB: db } as any;
  const res = await handleSearchRoutes(req, env, new URL(req.url), "/api/search");
  return { res, db };
}

test("the database receives the sanitised expression, never the raw input", async () => {
  const { res, db } = await search('"unclosed');
  expect(res?.status).toBe(200);
  expect(db.bound[0]?.[0]).toBe('"""unclosed"');
});

test("a failing MATCH becomes a 400 instead of a 500", async () => {
  const { res } = await search("anything", createDb({ failMatch: true }));
  expect(res?.status).toBe(400);
  expect(((await res!.json()) as { error: string }).error).toBe("invalid_query");
});

test("a query that sanitises to nothing is refused before hitting the database", async () => {
  const { res } = await search("   ");
  expect(res?.status).toBe(400);
});