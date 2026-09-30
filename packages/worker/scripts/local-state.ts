import { rmSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Local state that is NOT the D1 database but is still "your local data":
 * R2 holds attachments and raw mails, the Durable Object directory holds
 * notification sockets and login-rate counters, and cache is Miniflare's own.
 *
 * `db:reset:local` has to clear these too — otherwise a reset leaves orphaned
 * attachments behind, and the next login can inherit a stale rate-limit counter.
 */
export const LOCAL_STATE_DIRS = ["state/v3/r2", "state/v3/do", "state/v3/cache"] as const;

/**
 * Deletes the non-D1 local state under `<projectRoot>/.wrangler`.
 * Missing paths are ignored; the D1 database itself is intentionally untouched
 * (the SQL reset drops its tables instead).
 */
export function clearLocalState(projectRoot: string) {
  for (const dir of LOCAL_STATE_DIRS) {
    rmSync(resolve(projectRoot, ".wrangler", dir), { recursive: true, force: true });
  }
}
