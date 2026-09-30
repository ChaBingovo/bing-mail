import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { REL_PROJECT_ROOT, WRANGLER_VERSION, wranglerEnv } from "./wrangler-env";

const WORKER_ROOT = resolve(import.meta.dir, "..");
const env = wranglerEnv(WORKER_ROOT);

// Migrations first, so `bun run dev:worker` works on a fresh clone and after a reset.
const migrate = spawn(process.execPath, ["./scripts/db-migrate.ts"], { stdio: "inherit", env }); 
await new Promise<void>((resolvePromise) => {
  migrate.on("close", (code) => {
    if (code && code !== 0) process.exit(code);
    resolvePromise();
  });
});

// `cmd /c` + pinned version + relative ASCII path: the only invocation that keeps
// workerd alive in this environment (see scripts/wrangler-env.ts).
const command = `bunx wrangler@${WRANGLER_VERSION} dev --local --port 8788 --cwd ${REL_PROJECT_ROOT}`;
console.log(`\nstarting worker: ${command}  (from packages/worker)\n`);
const child = spawn(process.env.ComSpec || "cmd.exe", ["/c", command], {
  cwd: WORKER_ROOT,
  stdio: "inherit",
  env: { ...env, BINGMAIL_SKIP_WEB_BUILD: "1" },
});
await new Promise<void>((resolvePromise) => {
  child.on("close", () => resolvePromise());
});