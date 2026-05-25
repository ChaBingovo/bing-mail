import { readdir } from "node:fs/promises";
import path from "node:path";

const DB_NAME = "bingmail";
const MIGRATIONS_TABLE = "__bingmail_migrations";

type WranglerExecuteResult = Array<{
  results?: Array<Record<string, unknown>>;
  success: boolean;
}>;

async function runWrangler(args: string[]) {
  const proc = Bun.spawn(["bunx", "wrangler", ...args], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`wrangler_failed:${code}\n${stderr || stdout}`);
  }
  return { stdout, stderr };
}

async function execJson(sql: string) {
  const { stdout } = await runWrangler(["d1", "execute", DB_NAME, "--local", "--yes", "--json", "--command", sql]);
  const start = stdout.search(/[\[{]/);
  if (start < 0) return null;
  const head = stdout.slice(start).trim();
  const first = head[0];
  if (first !== "[" && first !== "{") return null;
  const end = first === "[" ? head.lastIndexOf("]") : head.lastIndexOf("}");
  if (end < 0) return null;
  const jsonText = head.slice(0, end + 1);
  return JSON.parse(jsonText) as WranglerExecuteResult;
}

async function execFile(filePath: string) {
  await runWrangler(["d1", "execute", DB_NAME, "--local", "--yes", "--file", filePath]);
}

async function main() {
  await execJson(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL UNIQUE, applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000));`,
  );

  const appliedRes = await execJson(`SELECT filename FROM ${MIGRATIONS_TABLE} ORDER BY filename ASC;`);
  const applied = new Set(
    (appliedRes?.[0]?.results || [])
      .map((r) => r.filename)
      .filter((v): v is string => typeof v === "string"),
  );

  const migrationsDir = path.resolve(process.cwd(), "../db/migrations");
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    if (applied.has(file)) continue;
    const filePath = path.join(migrationsDir, file);
    await execFile(filePath);
    await execJson(`INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ('${file.replace(/'/g, "''")}');`);
  }
}

await main();
