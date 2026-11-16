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

test("/api/setup/status reports unmigrated schema instead of throwing 500", async () => {
  const { env } = createEnv(await hashPassword("pw"));
  env.DB = {
    prepare() {
      const stmt = {
        bind: () => stmt,
        first: async () => {
          throw new Error("D1_ERROR: no such table: users");
        },
      };
      return stmt;
    },
  } as any;
  const req = new Request("https://mail.example.com/api/setup/status", { method: "GET" });
  const res = await handlePublicRoutes(req, env, new URL(req.url), "/api/setup/status");
  expect(res?.status).toBe(200);
  expect((await res!.json()) as Record<string, unknown>).toEqual({
    initialized: false,
    allowRegister: false,
    schemaReady: false,
    hasJwtSecret: true,
  });
});

test("/api/setup/status reports schemaReady and hasJwtSecret accurately", async () => {
  const { env } = createEnv(await hashPassword("pw"));
  env.JWT_SECRET = "";
  env.DB = {
    prepare() {
      const stmt = {
        bind: () => stmt,
        first: async () => null,
      };
      return stmt;
    },
  } as any;
  const req = new Request("https://mail.example.com/api/setup/status", { method: "GET" });
  const res = await handlePublicRoutes(req, env, new URL(req.url), "/api/setup/status");
  expect(res?.status).toBe(200);
  expect((await res!.json()) as Record<string, unknown>).toEqual({
    initialized: false,
    allowRegister: false,
    schemaReady: true,
    hasJwtSecret: false,
  });
});

test("/api/setup/domains defaults omitted sendProvider to none and rejects invalid values", async () => {
  const { env } = createEnv(await hashPassword("pw"));
  env.DB = {
    prepare() {
      const stmt = {
        bind: () => stmt,
        first: async () => null,
        run: async () => ({ success: true, meta: {} }),
      };
      return stmt;
    },
  } as any;

  const okReq = new Request("https://mail.example.com/api/setup/domains", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain: "example.com" }),
  });
  const okRes = await handlePublicRoutes(okReq, env, new URL(okReq.url), "/api/setup/domains");
  expect(okRes?.status).toBe(200);
  expect((await okRes!.json()) as Record<string, unknown>).toEqual({
    domain: "example.com",
    sendProvider: "none",
  });

  const badReq = new Request("https://mail.example.com/api/setup/domains", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain: "example.com", sendProvider: 123 }),
  });
  const badRes = await handlePublicRoutes(badReq, env, new URL(badReq.url), "/api/setup/domains");
  expect(badRes?.status).toBe(400);
  expect((await badRes!.json()) as Record<string, unknown>).toEqual({ error: "invalid_send_provider" });
});

test("/api/auth/login accepts ECDH + AES-GCM encrypted password payloads and rejects tampered ones", async () => {
  const passwordHash = await hashPassword("correct-horse-battery-staple");
  const { env } = createEnv(passwordHash);

  const keyReq = new Request("https://mail.example.com/api/auth/key", { method: "GET" });
  const keyRes = await handlePublicRoutes(keyReq, env, new URL(keyReq.url), "/api/auth/key");
  expect(keyRes?.status).toBe(200);
  const { keyToken, publicKey } = (await keyRes!.json()) as {
    keyToken: string;
    publicKey: JsonWebKey;
  };
  expect(typeof keyToken).toBe("string");
  expect(publicKey.crv).toBe("P-256");

  const clientPair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const serverPub = await crypto.subtle.importKey(
    "jwk",
    publicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const clientPublicKey = (await crypto.subtle.exportKey("jwk", clientPair.publicKey)) as JsonWebKey;
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: serverPub }, clientPair.privateKey, 256);
  const aesMaterial = await crypto.subtle.digest("SHA-256", bits);
  const aesKey = await crypto.subtle.importKey("raw", aesMaterial, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    new TextEncoder().encode(JSON.stringify({ password: "correct-horse-battery-staple" })),
  );
  const toB64Url = (u: Uint8Array) =>
    btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

  const loginReq = new Request("https://mail.example.com/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "alice",
      encryptedAuth: {
        keyToken,
        clientPublicKey: {
          kty: clientPublicKey.kty,
          crv: clientPublicKey.crv,
          x: clientPublicKey.x,
          y: clientPublicKey.y,
        },
        iv: toB64Url(iv),
        ct: toB64Url(new Uint8Array(ct)),
      },
    }),
  });
  const loginRes = await handlePublicRoutes(loginReq, env, new URL(loginReq.url), "/api/auth/login");
  expect(loginRes?.status).toBe(200);
  expect(loginRes?.headers.get("set-cookie")).toContain("bingmail_session=");

  const badReq = new Request("https://mail.example.com/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "alice",
      encryptedAuth: {
        keyToken: "tampered.token",
        clientPublicKey,
        iv: toB64Url(iv),
        ct: toB64Url(new Uint8Array(ct)),
      },
    }),
  });
  const badRes = await handlePublicRoutes(badReq, env, new URL(badReq.url), "/api/auth/login");
  expect(badRes?.status).toBe(400);
  expect((await badRes!.json()) as Record<string, unknown>).toEqual({ error: "invalid_encrypted_payload" });
});