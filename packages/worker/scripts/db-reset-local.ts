import { rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runWrangler, wranglerEnv } from "./wrangler-env";

const DB_NAME = "bingmail";
const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const WORKER_ROOT = path.resolve(import.meta.dir, "..");
const ENV = wranglerEnv(WORKER_ROOT);

/**
 * `--file` is resolved against wrangler's own `--cwd` (the repo root), not against
 * the shell's working directory, so the path is relative to the repo root and
 * ASCII-only.
 */
const RESET_SQL = path
  .relative(PROJECT_ROOT, path.resolve(PROJECT_ROOT, "packages", "db", "seeds", "reset.sql"))
  .split(path.sep)
  .join("/");

console.log("1/3 dropping every local table...");
const reset = await runWrangler(
  ["d1", "execute", DB_NAME, "--local", "--yes", "--file", RESET_SQL],
  { cwd: WORKER_ROOT, env: ENV },
);
if (reset.code !== 0) {
  console.error((reset.stderr || reset.stdout).slice(-2000));
  process.exit(reset.code || 1);
}

console.log("2/3 clearing local R2 / Durable Object / cache state...");
// The D1 tables are empty by now; these hold attachments, notification sockets and
// login-rate counters, which are just as much "local data".
for (const dir of ["state/v3/r2", "state/v3/do", "state/v3/cache"]) {
  rmSync(path.resolve(PROJECT_ROOT, ".wrangler", dir), { recursive: true, force: true });
}

console.log("3/3 re-applying migrations...");
const migrate = spawnSync(process.execPath, ["./scripts/db-migrate.ts"], {
  cwd: WORKER_ROOT,
  stdio: "inherit",
  env: ENV,
});
process.exit(migrate.status === 0 ? 0 : migrate.status ?? 1);