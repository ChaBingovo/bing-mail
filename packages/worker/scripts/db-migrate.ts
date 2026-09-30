import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REL_PROJECT_ROOT, runWrangler, writeTempSql, wranglerEnv } from "./wrangler-env";

const DB_NAME = "bingmail";
const MIGRATIONS_TABLE = "__bingmail_migrations";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKER_ROOT = path.resolve(PROJECT_ROOT, "packages", "worker");
const IS_REMOTE = process.argv.includes("--remote") && !process.argv.includes("--local");
const MODE_ARGS = IS_REMOTE ? ["--remote"] : ["--local"];
const ENV = wranglerEnv(WORKER_ROOT);

type WranglerExecuteResult = Array<{
  results?: Array<Record<string, unknown>>;
  success: boolean;
}>;

/**
 * Wrangler resolves `--file` against its own `--cwd` (the repo root), not against
 * the shell's working directory — and it must stay ASCII-only.
 */
function relFromProject(absolute: string) {
  return path.relative(PROJECT_ROOT, absolute).split(path.sep).join("/");
}

async function run(args: string[]) {
  const result = await runWrangler(args, { cwd: WORKER_ROOT, env: ENV });
  if (result.code !== 0) {
    throw new Error(`wrangler_failed:${result.code}\n${(result.stderr || result.stdout).slice(-2000)}`);
  }
  return result;
}

async function execSql(sql: string) {
  const file = writeTempSql(WORKER_ROOT, sql);
  const { stdout } = await run([
    "d1",
    "execute",
    DB_NAME,
    ...MODE_ARGS,
    "--yes",
    "--json",
    "--file",
    relFromProject(file),
  ]);

  const start = stdout.search(/[\[{]/);
  if (start < 0) return null;
  const head = stdout.slice(start).trim();
  const first = head[0];
  if (first !== "[" && first !== "{") return null;
  const end = first === "[" ? head.lastIndexOf("]") : head.lastIndexOf("}");
  if (end < 0) return null;
  return JSON.parse(head.slice(0, end + 1)) as WranglerExecuteResult;
}

async function execFile(absolutePath: string) {
  await run([
    "d1",
    "execute",
    DB_NAME,
    ...MODE_ARGS,
    "--yes",
    "--file",
    relFromProject(absolutePath),
  ]);
}

async function main() {
  await execSql(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL UNIQUE, applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000));`,
  );

  const appliedRes = await execSql(`SELECT filename FROM ${MIGRATIONS_TABLE} ORDER BY filename ASC;`);
  const applied = new Set(
    (appliedRes?.[0]?.results || [])
      .map((row) => (typeof row["filename"] === "string" ? row["filename"] : null))
      .filter((value): value is string => typeof value === "string"),
  );

  const migrationsDir = path.resolve(PROJECT_ROOT, "packages", "db", "migrations");
  const files = (await readdir(migrationsDir))
    .filter((file: string) => file.endsWith(".sql"))
    .sort((a: string, b: string) => a.localeCompare(b));

  let appliedNow = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    await execFile(path.join(migrationsDir, file));
    await execSql(`INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (filename) VALUES ('${file.replace(/'/g, "''")}');`);
    console.log(`applied ${file}`);
    appliedNow += 1;
  }

  console.log(
    appliedNow === 0
      ? `migrations already up to date (${files.length} files, ${IS_REMOTE ? "remote" : "local"})`
      : `${appliedNow} migration(s) applied (${IS_REMOTE ? "remote" : "local"}, project=${REL_PROJECT_ROOT})`,
  );
}

await main();