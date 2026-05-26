import { spawnSync } from "node:child_process";

if ((process.env.BINGMAIL_SKIP_WEB_BUILD || "").trim() === "1") {
  process.exit(0);
}

const res = spawnSync("bun", ["--cwd", "apps/web", "build"], { stdio: "inherit" });
process.exit(res.status ?? 1);

