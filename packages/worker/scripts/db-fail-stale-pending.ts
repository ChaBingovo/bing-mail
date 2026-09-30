/**
 * Marks abandoned PENDING rows as FAILED so the UI shows an error instead of
 * spinning on "解析中" forever.
 *
 * A row can be abandoned when the queue consumer never gets to finish it, for
 * example when `wrangler dev` is stopped mid-parse, or when the ingest step and
 * the consumer race (the job is enqueued before the row is written).
 *
 * Usage:
 *   bun ./scripts/db-fail-stale-pending.ts [--older-than-minutes 10]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWrangler, writeTempSql, wranglerEnv } from "./wrangler-env";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKER_ROOT = path.resolve(PROJECT_ROOT, "packages", "worker");
const ENV = wranglerEnv(WORKER_ROOT);

const flagIndex = process.argv.indexOf("--older-than-minutes");
const minutes = flagIndex >= 0 ? Number(process.argv[flagIndex + 1]) : 10;
if (!Number.isFinite(minutes) || minutes < 0) {
  console.error("--older-than-minutes must be a non-negative number");
  process.exit(1);
}

const cutoff = Date.now() - Math.floor(minutes * 60_000);
const sql = [
  "UPDATE messages",
  "SET status = 'FAILED',",
  "    error_reason = 'abandoned: 本地开发进程在处理完成前停止',",
  "    lock_id = NULL,",
  "    locked_at = NULL,",
  "    parsed_at = NULL",
  `WHERE status = 'PENDING' AND received_at < ${cutoff};`,
  "SELECT changes() AS updated;",
].join("\n");

const file = writeTempSql(WORKER_ROOT, sql);
const result = await runWrangler(
  ["d1", "execute", "bingmail", "--local", "--yes", "--json", "--file", path.relative(PROJECT_ROOT, file).split(path.sep).join("/")],
  { cwd: WORKER_ROOT, env: ENV },
);
if (result.code !== 0) {
  console.error((result.stderr || result.stdout).slice(-2000));
  process.exit(result.code || 1);
}

const start = result.stdout.search(/[\[{]/);
const parsed = start >= 0 ? JSON.parse(result.stdout.slice(start, result.stdout.lastIndexOf("]") + 1)) : [];
const updated = parsed?.[0]?.results?.[0]?.updated ?? 0;
console.log(`marked ${updated} stale PENDING message(s) as FAILED (older than ${minutes} minute(s))`);