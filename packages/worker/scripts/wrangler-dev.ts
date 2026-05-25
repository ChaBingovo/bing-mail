import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const xdgBase = resolve(import.meta.dir, "..", ".wrangler-xdg");
mkdirSync(xdgBase, { recursive: true });

process.env.XDG_CONFIG_HOME = xdgBase;
process.env.XDG_CACHE_HOME = resolve(xdgBase, "cache");
process.env.XDG_STATE_HOME = resolve(xdgBase, "state");
process.env.XDG_DATA_HOME = resolve(xdgBase, "data");

const projectRoot = resolve(import.meta.dir, "..", "..", "..");
const child = spawn("bunx", ["wrangler", "dev", "--local", "--cwd", projectRoot], { stdio: "inherit", env: process.env });
await new Promise<void>((resolvePromise) => {
  child.on("close", () => resolvePromise());
});
