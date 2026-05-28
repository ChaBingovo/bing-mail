import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const xdgBase = resolve(import.meta.dir, "..", ".wrangler-xdg");
mkdirSync(xdgBase, { recursive: true });

process.env.XDG_CONFIG_HOME = xdgBase;
process.env.XDG_CACHE_HOME = resolve(xdgBase, "cache");
process.env.XDG_STATE_HOME = resolve(xdgBase, "state");
process.env.XDG_DATA_HOME = resolve(xdgBase, "data");

const migrate = spawn("bun", ["./scripts/db-migrate.ts"], { stdio: "inherit", env: process.env });
await new Promise<void>((resolvePromise) => {
  migrate.on("close", (code) => {
    if (code && code !== 0) process.exit(code);
    resolvePromise();
  });
});

const projectRoot = resolve(import.meta.dir, "..", "..", "..");
process.env.BINGMAIL_SKIP_WEB_BUILD = "1";
const child = spawn("bunx", ["wrangler", "dev", "--local", "--port", "8788", "--cwd", projectRoot], {
  stdio: "inherit",
  env: process.env,
});
await new Promise<void>((resolvePromise) => {
  child.on("close", () => resolvePromise());
});
