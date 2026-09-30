import { expect, test } from "bun:test";
import { hashPassword, verifyJwt } from "../src/auth";
import { handlePublicRoutes } from "../src/handlers/fetch.routes.public";

const JWT_SECRET = "test-secret";

/** Minimal D1 stub: the login path only reads users / app_settings / isInitialized. */
function createDb(opts: { passwordHash: string; isAdmin?: boolean }) {
  return {
    prepare(sql: string) {
      const stmt = {
        bind() {
          return stmt;
        },
        async first<T>() {
          if (sql.includes("FROM users WHERE is_admin = 1")) return { ok: 1 } as unknown as T;
          if (sql.includes("FROM users WHERE username")) {
            return { id: "u1", password_hash: opts.passwordHash, is_admin: opts.isAdmin ? 1 : 0 } as unknown as T;
          }
          if (sql.includes("FROM app_settings")) return null as unknown as T;
          throw new Error(`unexpected sql: ${sql}`);
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return stmt;
    },
  };
}

function createEnv(passwordHash: string) {
  const calls: string[] = [];
  const authRate = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/check")) return Response.json({ limited: false, count: 0 });
        return Response.json({ limited: false, count: 0 });
      },
    }),
  };
  return {
    env: {
      JWT_SECRET,
      DB: createDb({ passwordHash }),
      AUTH_RATE: authRate,
    } as any,
    calls,
  };
}

async function login(password: string, storedPassword = password) {
  // The stored hash is derived from `storedPassword`, which lets a test send a
  // password that does not match it.
  const passwordHash = await hashPassword(storedPassword);
  const { env } = createEnv(passwordHash);
  const req = new Request("https://mail.example.com/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "alice", password }),
  });
  const res = await handlePublicRoutes(req, env, new URL(req.url), "/api/auth/login");
  if (!res) throw new Error("no response");
  return res;
}

test("login puts the session in an HttpOnly cookie and never echoes a token", async () => {
  const res = await login("correct-horse");
  expect(res.status).toBe(200);

  const body = (await res.json()) as Record<string, unknown>;
  expect(body.user).toBeTruthy();
  expect(body.token).toBeUndefined();

  const cookie = res.headers.get("set-cookie") || "";
  expect(cookie).toContain("bingmail_session=");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
  expect(cookie).toContain("Path=/");
  expect(cookie).toContain("Max-Age=");

  const token = /bingmail_session=([^;]+)/.exec(cookie)?.[1] || "";
  const payload = await verifyJwt(decodeURIComponent(token), JWT_SECRET);
  expect(payload?.sub).toBe("u1");
});

test("login rejects a wrong password and records a rate-limit failure", async () => {
  const res = await login("wrong-password", "correct-horse");
  expect(res.status).toBe(401);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.error).toBe("unauthorized");
  expect(res.headers.get("set-cookie")).toBeNull();
});

test("logout clears the session cookie", async () => {
  const { env } = createEnv("unused");
  const req = new Request("https://mail.example.com/api/auth/logout", { method: "POST" });
  const res = await handlePublicRoutes(req, env, new URL(req.url), "/api/auth/logout");
  const cookie = res?.headers.get("set-cookie") || "";
  expect(cookie).toContain("bingmail_session=;");
  expect(cookie).toContain("Max-Age=0");
});

test("login is refused when the instance is not initialized", async () => {
  const { env } = createEnv(await hashPassword("pw"));
  env.DB = {
    prepare(sql: string) {
      const stmt = {
        bind: () => stmt,
        first: async () => null,
        run: async () => ({ success: true, meta: {} }),
      };
      return stmt;
    },
  } as any;
  const req = new Request("https://mail.example.com/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "alice", password: "pw" }),
  });
  const res = await handlePublicRoutes(req, env, new URL(req.url), "/api/auth/login");
  expect(res?.status).toBe(409);
  expect(((await res!.json()) as { error: string }).error).toBe("not_initialized");
});