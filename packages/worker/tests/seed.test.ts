import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  HASH_ITERATIONS,
  MAX_ITERATIONS,
  MIN_ITERATIONS,
  hashPassword,
  parsePasswordHash,
  verifyPassword,
} from "../src/auth";

const SEED_SQL = readFileSync(path.resolve(import.meta.dir, "../../db/seeds/dev.sql"), "utf8");

function seedHash() {
  const m = SEED_SQL.match(/'(pbkdf2\$[^']+)'/);
  if (!m) throw new Error("no password hash found in dev seed");
  return m[1];
}

test("dev seed hash is inside the range verifyPassword accepts", () => {
  const parsed = parsePasswordHash(seedHash());
  expect(parsed).not.toBeNull();
  expect(parsed!.iterations).toBeGreaterThanOrEqual(MIN_ITERATIONS);
  expect(parsed!.iterations).toBeLessThanOrEqual(MAX_ITERATIONS);
});

test("dev seed account password actually verifies", async () => {
  expect(await verifyPassword("default1234", seedHash())).toBe(true);
  expect(await verifyPassword("wrong-password", seedHash())).toBe(false);
});

test("the documented regeneration command produces a hash with the same parameters", async () => {
  const regenerated = await hashPassword("default1234");
  const parsed = parsePasswordHash(regenerated);
  expect(parsed).not.toBeNull();
  expect(parsed!.iterations).toBe(HASH_ITERATIONS);
  expect(await verifyPassword("default1234", regenerated)).toBe(true);
});

test("dev seed stays idempotent and creates a mailbox for the account", () => {
  expect(SEED_SQL).toContain("ON CONFLICT(id) DO NOTHING");
  expect(SEED_SQL).toMatch(/INSERT INTO mailboxes/);
  // Must not seed an admin: an existing admin makes isInitialized() true and
  // would skip the setup wizard on a fresh local database.
  expect(SEED_SQL).toMatch(/INSERT INTO users \(id, username, password_hash, is_admin\)/);
  expect(SEED_SQL).toMatch(/'user_default',\s*'default',\s*'pbkdf2\$[^']+',\s*0\s*\)/);
});

test("password hashing refuses unparsable or out-of-range stored hashes", async () => {
  expect(parsePasswordHash("plaintext")).toBeNull();
  expect(parsePasswordHash("pbkdf2$0$salt$hash")).toBeNull();
  expect(parsePasswordHash("pbkdf2$99999999$salt$hash")).toBeNull();
  expect(parsePasswordHash("bcrypt$100000$salt$hash")).toBeNull();
});
