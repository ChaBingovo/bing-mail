import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SHELL = process.env.ComSpec || "cmd.exe";

/**
 * Pinned deliberately: newer wrangler builds bundle a workerd that aborts with
 * std::terminate() on this machine, which breaks every `wrangler dev` and
 * `wrangler d1 execute`. Re-test locally before bumping.
 */
export const WRANGLER_VERSION = "4.19.0";

/** Always run wrangler from here, with `--cwd ../..`, so the repo path stays ASCII. */
export const REL_PROJECT_ROOT = "../..";

/**
 * Local Wrangler state lives inside the repo (instead of the OS user profile), so
 * "clear local data" means deleting one directory.
 *
 * The state database itself is `<repo>/.wrangler/state`; the XDG values only move
 * logs and config next to it. Every entry point must use this helper, otherwise the
 * scripts would talk to different local databases.
 */
export function wranglerEnv(workerRoot: string) {
  const base = resolve(workerRoot, ".wrangler-xdg");
  mkdirSync(base, { recursive: true });
  const rootNodeModules = resolve(workerRoot, "../../node_modules");
  const nodePath = process.env.NODE_PATH ? `${rootNodeModules};${process.env.NODE_PATH}` : rootNodeModules;
  return {
    ...process.env,
    NODE_PATH: nodePath,
    XDG_CONFIG_HOME: base,
    XDG_CACHE_HOME: resolve(base, "cache"),
    XDG_STATE_HOME: resolve(base, "state"),
    XDG_DATA_HOME: resolve(base, "data"),
    WRANGLER_SEND_METRICS: "false",
  };
}

/**
 * Builds a plain shell command. Wrangler must be the shell's direct child, with an
 * explicit version: wrappers (`npx`, node_modules `.bin` shims, nested `bun run`)
 * and unpinned resolution (which picks up another wrangler hoisted at the repo
 * root) both make workerd abort here.
 *
 * Paths are kept relative and ASCII-only: `cmd.exe` mangles non-ASCII paths such as
 * this repo's `项目` directory, and a literal quoted `--cwd` is taken verbatim.
 */
export function prepareLocalWranglerConfig(workerRoot: string) {
  const rootConfigPath = resolve(workerRoot, "../../wrangler.jsonc");
  const raw = readFileSync(rootConfigPath, "utf8");
  if (/"database_id"\s*:/.test(raw)) {
    return null;
  }
  const stripped = raw
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const parsed = JSON.parse(stripped) as Record<string, unknown>;
  const prefix = "../../../";
  if (typeof parsed.main === "string") {
    parsed.main = `${prefix}${parsed.main}`;
  }
  if (parsed.assets && typeof parsed.assets === "object" && typeof (parsed.assets as Record<string, unknown>).directory === "string") {
    (parsed.assets as Record<string, unknown>).directory = `${prefix}${(parsed.assets as Record<string, unknown>).directory}`;
  }
  if (Array.isArray(parsed.d1_databases)) {
    for (const db of parsed.d1_databases) {
      if (db && typeof db === "object") {
        const entry = db as Record<string, unknown>;
        if (!entry.database_id) {
          entry.database_id = "00000000-0000-0000-0000-000000000000";
        }
        if (typeof entry.migrations_dir === "string") {
          entry.migrations_dir = `${prefix}${entry.migrations_dir}`;
        }
      }
    }
  }
  delete parsed.$schema;
  const localConfigPath = resolve(workerRoot, ".wrangler-xdg/wrangler.local.jsonc");
  mkdirSync(resolve(workerRoot, ".wrangler-xdg"), { recursive: true });
  writeFileSync(localConfigPath, JSON.stringify(parsed, null, 2), "utf8");
  return "packages/worker/.wrangler-xdg/wrangler.local.jsonc";
}

export function wranglerCommand(args: string[], configRelPath?: string | null) {
  const configArg = configRelPath ? `--config ${configRelPath} ` : "";
  return `bunx wrangler@${WRANGLER_VERSION} --cwd ${REL_PROJECT_ROOT} ${configArg}${args.join(" ")}`;
}

export async function runWrangler(
  args: string[],
  options: { cwd: string; env: Record<string, string | undefined> },
) {
  const configRelPath = prepareLocalWranglerConfig(options.cwd);
  const proc = Bun.spawn([SHELL, "/c", wranglerCommand(args, configRelPath)], {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

/**
 * Wrangler re-splits `--command` from its own argv, so SQL cannot be passed inline
 * through a shell. Write it to a file inside the worker directory and pass the
 * relative path instead.
 */
export function writeTempSql(workerRoot: string, sql: string) {
  const dir = resolve(workerRoot, ".wrangler-tmp");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `stmt-${crypto.randomUUID()}.sql`);
  writeFileSync(file, sql, "utf8");
  return file;
}