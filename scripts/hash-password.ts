/**
 * Generate a password hash line for `packages/db/seeds/*.sql`.
 *
 * Usage:
 *   bun ./scripts/hash-password.ts <password> [--iterations N]
 *
 * Always uses the canonical parameters from `packages/worker/src/auth.ts`, so a
 * generated hash can never fall outside the range `verifyPassword` accepts.
 */
import { HASH_ITERATIONS, hashPassword, verifyPassword } from "../packages/worker/src/auth";

const args = process.argv.slice(2);
const password = args.find((a) => !a.startsWith("--"));

if (!password) {
  console.error("usage: bun ./scripts/hash-password.ts <password> [--iterations N]");
  process.exit(1);
}

const iterFlag = args.findIndex((a) => a === "--iterations");
const iterations = iterFlag >= 0 ? Number(args[iterFlag + 1]) : HASH_ITERATIONS;
if (!Number.isInteger(iterations)) {
  console.error("--iterations must be an integer");
  process.exit(1);
}

const hash = await hashPassword(password, iterations);
const ok = await verifyPassword(password, hash);
if (!ok) {
  console.error("roundtrip check failed; refusing to print a hash that cannot be verified");
  process.exit(1);
}

console.log(`-- password: ${password}  iterations: ${iterations}`);
console.log(`'${hash}'`);
