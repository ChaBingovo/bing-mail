import path from "node:path";

const DB_NAME = "bingmail";
const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const WORKER_ROOT = path.resolve(import.meta.dir, "..");
const RESET_SQL = path.resolve(PROJECT_ROOT, "packages", "db", "seeds", "reset.sql");

async function run(cmd: string[], opts?: { cwd?: string }) {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} failed:${code}\n${stderr || stdout}`);
  return { stdout, stderr };
}

await run(["bunx", "wrangler", "--cwd", PROJECT_ROOT, "d1", "execute", DB_NAME, "--local", "--yes", "--file", RESET_SQL]);

const migrate = Bun.spawn(["bun", "./scripts/db-migrate.ts"], { cwd: WORKER_ROOT, stdout: "inherit", stderr: "inherit" });
const migrateCode = await migrate.exited;
if (migrateCode !== 0) process.exit(migrateCode);

