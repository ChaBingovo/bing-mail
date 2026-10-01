import type { Env } from "../env";
import { logInfo, logWarn } from "../log";
import { getMailRetentionDays } from "./fetch.shared";
import { reapAbandonedMessages } from "./queue";

/** Message rows handled per scheduled run, so one invocation stays inside CPU limits. */
export const CLEANUP_BATCH_SIZE = 200;
/** D1 batches are chunked to keep each round trip well under statement limits. */
const STATEMENT_CHUNK = 40;

export type CleanupResult = {
  retentionDays: number;
  messages: number;
  sentMessages: number;
  r2Objects: number;
};

const EMPTY: CleanupResult = { retentionDays: 0, messages: 0, sentMessages: 0, r2Objects: 0 };

/**
 * Deletes mail that fell out of the retention window: the inbound row plus its
 * raw/oversized-HTML objects in R2, the FTS index row, and old sent history.
 *
 * Ordering matters: R2 objects go first. If the delete fails the DB row is kept,
 * so the next run retries instead of leaking an unreferenced object. A leftover
 * R2 object is harmless; a DB row whose raw mail is gone is not.
 */
export async function cleanupExpiredMail(env: Env, now = Date.now()): Promise<CleanupResult> {
  const retentionDays = await getMailRetentionDays(env);
  if (retentionDays <= 0) return { ...EMPTY, retentionDays };

  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;

  const expired = await env.DB.prepare(
    "SELECT id, r2_raw_key, html_r2_key FROM messages WHERE received_at < ?1 ORDER BY received_at ASC LIMIT ?2",
  )
    .bind(cutoff, CLEANUP_BATCH_SIZE)
    .all<{ id: string; r2_raw_key: string | null; html_r2_key: string | null }>();

  const rows = expired.results || [];
  const keys: string[] = [];
  for (const row of rows) {
    if (row.r2_raw_key) keys.push(row.r2_raw_key);
    if (row.html_r2_key) keys.push(row.html_r2_key);
  }

  if (keys.length > 0) {
    try {
      await env.MAIL_BUCKET.delete(keys);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logWarn({ event: "maintenance_r2_delete_failed", error, status: "FAILED" });
      return { ...EMPTY, retentionDays };
    }
  }

  for (let i = 0; i < rows.length; i += STATEMENT_CHUNK) {
    const slice = rows.slice(i, i + STATEMENT_CHUNK);
    await env.DB.batch(
      slice.flatMap((row) => [
        env.DB.prepare("DELETE FROM messages_fts WHERE message_id = ?1").bind(row.id),
        env.DB.prepare("DELETE FROM messages WHERE id = ?1").bind(row.id),
      ]),
    );
  }

  const sent = await env.DB.prepare(
    "DELETE FROM sent_messages WHERE id IN (SELECT id FROM sent_messages WHERE sent_at < ?1 ORDER BY sent_at ASC LIMIT ?2)",
  )
    .bind(cutoff, CLEANUP_BATCH_SIZE)
    .run();

  return {
    retentionDays,
    messages: rows.length,
    sentMessages: sent.meta?.changes ?? 0,
    r2Objects: keys.length,
  };
}

/** Cron entry point: never throws, so a failed sweep cannot fail the scheduled event. */
export async function handleScheduled(env: Env) {
  let result: CleanupResult | null = null;
  try {
    result = await cleanupExpiredMail(env);
    logInfo({
      event: "maintenance_cleanup_done",
      status: result.messages > 0 || result.sentMessages > 0 ? "SUCCESS" : "NOOP",
      attempt: result.retentionDays,
    });
  } catch (err) {
    logWarn({
      event: "maintenance_cleanup_failed",
      status: "FAILED",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Also sweep abandoned PENDING rows. The queue consumer does this opportunistically,
  // but only when a delivery actually arrives; running it from the cron guarantees a
  // stuck row is surfaced as FAILED even if the queue goes quiet.
  try {
    const reaped = await reapAbandonedMessages(env);
    if (reaped > 0) logInfo({ event: "maintenance_reaped", status: "SUCCESS", attempt: reaped });
  } catch (err) {
    logWarn({
      event: "maintenance_reap_failed",
      status: "FAILED",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}
