import { expect, test } from "bun:test";
import { hashPassword, passwordVersion, passwordVersionMatches, signJwt } from "../src/auth";
import { requireAuth } from "../src/handlers/fetch.shared";

const SECRET = "test-secret";

/** Only `sessionStillValid` reads users; the stub answers that one query. */
function createEnv(passwordHash: string | null) {
  return {
    JWT_SECRET: SECRET,
    DB: {
      prepare() {
        const stmt = {
          bind: () => stmt,
          first: async () => (passwordHash === null ? null : { password_hash: passwordHash }),
          run: async () => ({ success: true, meta: {} }),
        };
        return stmt;
      },
    },
  } as any;
}

async function requestWith(payload: Record<string, unknown>) {
  const token = await signJwt(
    { sub: "u1", username: "alice", exp: Math.floor(Date.now() / 1000) + 3600, ...payload } as any,
    SECRET,
  );
  return new Request("https://mail.example.com/api/user/mailbox", {
    headers: { authorization: `Bearer ${token}` },
  });
}

test("passwordVersion is stable, truncated and does not leak the hash", async () => {
  const hash = await hashPassword("correct-horse");
  const version = passwordVersion(hash);
  expect(version).toBe(passwordVersion(hash));
  expect(version.startsWith("v1:")).toBe(true);
  // Only a prefix is carried, so the JWT cannot be replayed against the verifier.
  expect(version.length).toBeLessThan(hash.length);
  expect(version.length).toBeLessThanOrEqual(27);
});

test("a different password yields a different version", async () => {
  const a = await hashPassword("first-password");
  const b = await hashPassword("second-password");
  expect(passwordVersion(a)).not.toBe(passwordVersion(b));
});

test("a token whose version matches the account is accepted", async () => {
  const hash = await hashPassword("correct-horse");
  const req = await requestWith({ pv: passwordVersion(hash) });
  const auth = await requireAuth(req, createEnv(hash));
  expect(auth?.sub).toBe("u1");
});

test("a token minted before a password change is rejected", async () => {
  const oldHash = await hashPassword("old-password");
  const newHash = await hashPassword("new-password");
  const req = await requestWith({ pv: passwordVersion(oldHash) });
  // The stored hash has moved on, so the older session must stop working.
  expect(await requireAuth(req, createEnv(newHash))).toBeNull();
});

test("a legacy token without a version is still accepted", async () => {
  // Deploying this feature must not log everyone out: tokens issued before it carry
  // no `pv` and are honoured until the next sign-in mints a versioned one.
  const hash = await hashPassword("correct-horse");
  const req = await requestWith({});
  const auth = await requireAuth(req, createEnv(hash));
  expect(auth?.sub).toBe("u1");
});

test("a versioned token for a deleted account is rejected", async () => {
  const hash = await hashPassword("correct-horse");
  const req = await requestWith({ pv: passwordVersion(hash) });
  expect(await requireAuth(req, createEnv(null))).toBeNull();
});

test("passwordVersionMatches treats a missing account hash as a mismatch", () => {
  const token = { pv: "v1:abc" };
  expect(passwordVersionMatches(token, "")).toBe(false);
  expect(passwordVersionMatches(token, null)).toBe(false);
  expect(passwordVersionMatches(token, undefined)).toBe(false);
  expect(passwordVersionMatches({}, null)).toBe(true);
});
