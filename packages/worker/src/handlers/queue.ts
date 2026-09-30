import * as PostalMime from "postal-mime";
import type { MessageBatch } from "@cloudflare/workers-types";
import type { Env, ParseQueueMessage } from "../env";
import { logError, logInfo, logWarn } from "../log";

function toSnippet(value: string | null | undefined, limit = 140) {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, limit);
}

function shouldRunAi(subject: string | null, textPlain: string | null) {
  const haystack = `${subject ?? ""}\n${textPlain ?? ""}`.toLowerCase();
  if (!haystack.trim()) return false;
  if (/\b\d{4,10}\b/.test(haystack)) return true;
  if (
    /verification|verify|otp|passcode|2fa|two-factor|security code|login code|activation|activate|confirm|sign in/.test(
      haystack,
    )
  )
    return true;
  if (/验证码|校验码|动态码|安全码|激活|验证|登录|确认|二步/.test(haystack)) return true;
  return false;
}

function coerceNullableString(value: unknown) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v ? v : null;
}

function extractJsonObject(value: string) {
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return value.slice(first, last + 1);
}

/** Exported so tests can assert the exact guard conditions. */
/** Per-delivery attempt budget before a scheduled re-enqueue. */
function deliveryAttempts(env: Env) {
  const raw = Number(env.PARSE_QUEUE_MAX_ATTEMPTS || "5");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5;
}

function lockTtlMs(env: Env) {
  const raw = Number(env.PARSE_QUEUE_LOCK_TTL_MS || "300000");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 300000;
}

/**
 * Hard ceiling on the lifetime attempt counter. Bounds the re-enqueue loop so a
 * poison message (one that always throws) cannot spin forever: deliveryAttempts
 * attempts per cycle, this many cycles at most (default 5 × 6 = 30 deliveries).
 */
function attemptCeiling(env: Env) {
  return deliveryAttempts(env) * 6;
}

/**
 * Called when a delivery finds a row whose attempt budget for this cycle is used
 * up (the claim guard refuses rows at the ceiling). Instead of leaving the row
 * dead, this starts a new cycle:
 *
 * - only an `ack`ed (accepted) row older than the lock TTL may restart, so an
 *   in-flight or actively retrying row is never touched;
 * - the row keeps its id and `r2_raw_key`, so the raw mail is re-read from R2
 *   rather than duplicated;
 * - `PARSE_QUEUE.send()` acts as the wake-up. If the original job is lost (queue
 *   bug, stopped consumer), the new job re-delivers it.
 *
 * Returns false when the row is already SUCCESS, still locked, or has burned
 * through `attemptCeiling` cycles — in which case the caller marks it FAILED.
 */
async function scheduleRetryCycle(messageId: string, env: Env, requestId: string) {
  const ceiling = attemptCeiling(env);
  const now = Date.now();

  const res = await env.DB.prepare(
    "UPDATE messages SET attempt = 1, status='PENDING', error_reason=NULL, lock_id=NULL, locked_at=NULL, parsed_at=NULL WHERE id = ?1 AND status = 'PENDING' AND attempt >= ?2 AND attempt < ?3 AND (lock_id IS NULL OR locked_at < ?4)",
  )
    .bind(messageId, deliveryAttempts(env), ceiling, now - lockTtlMs(env))
    .run();

  if ((res.meta?.changes ?? 0) === 0) return false;

  logWarn({
    event: "queue_message_requeued",
    requestId,
    messageId,
    attempt: ceiling,
    status: "PENDING",
  });

  try {
    await env.PARSE_QUEUE.send({ messageId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError({ event: "queue_requeue_send_failed", requestId, messageId, error: message });
    // A reset row with no job would be a zombie, so hand it back to the TTL reaper.
    await env.DB.prepare("UPDATE messages SET attempt = ?2, locked_at = locked_at WHERE id = ?1")
      .bind(messageId, ceiling)
      .run()
      .catch(() => undefined);
    return false;
  }

  return true;
}

export const SWEEP_SQL =
  "UPDATE messages SET status='FAILED', error_reason='abandoned: 解析中断或重试次数耗尽', parsed_at=NULL, lock_id=NULL, locked_at=NULL " +
  "WHERE status='PENDING' AND ((lock_id IS NOT NULL AND locked_at < ?1) OR (attempt >= ?2 AND received_at < ?3))";

/**
 * Marks rows FAILED when they can no longer make progress:
 *
 * - PENDING with a lock that expired long ago: the consumer holding the lock never
 *   came back (process killed, workerd restart, crashed isolate). The claim query
 *   would recover these, but only if another delivery arrives before the retry
 *   budget runs out — which is exactly what does not happen once the queue stops
 *   delivering.
 * - PENDING with attempt >= max: the claim guard refuses them forever, so without
 *   an external sweep they are unreachable (this is how the first zombie row in
 *   local testing got stuck).
 *
 * Only rows older than the lock TTL are touched, so a parse that is genuinely in
 * flight is never interrupted. The UPDATE is atomic and status-guarded, so
 * concurrent consumers cannot double-reap or fight over in-flight rows.
 */
async function reapAbandonedMessages(env: Env) {
  const attempts = deliveryAttempts(env);
  const ttl = lockTtlMs(env);
  const now = Date.now();
  /** Past this instant a held lock is considered abandoned. */
  const lockCutoff = now - ttl;
  /** Unclaimed-but-stuck rows must be older still, to avoid touching an in-flight row. */
  const attemptCutoff = now - ttl * 6;

  const result = await env.DB.prepare(SWEEP_SQL).bind(lockCutoff, attempts, attemptCutoff).run();

  const reaped = result.meta?.changes ?? 0;
  if (reaped > 0) {
    logWarn({ event: "queue_abandoned_messages_reaped", attempt: attempts, status: "FAILED" });
  }
  return reaped;
}

export async function handleQueue(batch: MessageBatch<ParseQueueMessage>, env: Env, _ctx: ExecutionContext) {
  // Opportunistic cleanup: a stopped consumer (or an exhausted retry budget) should
  // surface as FAILED in the UI instead of an endless "解析中".
  try {
    await reapAbandonedMessages(env);
  } catch {
    // never let cleanup break real parsing
  }

  await Promise.allSettled(
    batch.messages.map(async (msg) => {
      const requestId = crypto.randomUUID();
      try {
        await processOne(msg.body.messageId, env, requestId);
        msg.ack();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError({ event: "queue_process_failed", requestId, messageId: msg.body.messageId, error: message });
        msg.retry();
      }
    }),
  );
}

async function processOne(messageId: string, env: Env, requestId: string) {
  const maxAttempts = deliveryAttempts(env);
  const ceiling = attemptCeiling(env);
  const ttl = lockTtlMs(env);

  const lockId = requestId;
  const now = Date.now();
  const cutoff = now - ttl;

  const claimRes = await env.DB.prepare(
    "UPDATE messages SET attempt = attempt + 1, status='PENDING', error_reason=NULL, lock_id=?3, locked_at=?4 WHERE id=?1 AND status != 'SUCCESS' AND attempt < ?2 AND (lock_id IS NULL OR locked_at < ?5)",
  )
    .bind(messageId, ceiling, lockId, now, cutoff)
    .run();

  const claimed = claimRes.meta?.changes ?? 0;
  if (claimed === 0) {
    // The claim misses when the row is already SUCCESS, when another worker holds
    // the lock, when the ingest insert has not landed yet (the job is enqueued
    // before the row), or when this cycle's attempt budget is used up.
    const state = await env.DB.prepare(
      "SELECT status, attempt, lock_id FROM messages WHERE id = ?1 LIMIT 1",
    )
      .bind(messageId)
      .first<{ status: string; attempt: number; lock_id: string | null }>();
    // The row does not exist yet: the ingest writes it right after enqueueing the
    // job, so retrying is what makes the first delivery succeed.
    if (!state) throw new Error(`message row not ready: ${messageId}`);

    const used = Number(state.attempt) || 0;
    if (state.status === "PENDING" && used >= ceiling) {
      // Burned through every cycle: stop retrying and make it visible as FAILED.
      const reason = `retry exhausted after ${used} attempt(s)`;
      await env.DB.prepare(
        "UPDATE messages SET status='FAILED', error_reason=?2, parsed_at=NULL, lock_id=NULL, locked_at=NULL WHERE id=?1 AND status='PENDING'",
      )
        .bind(messageId, reason)
        .run();
      logError({ event: "queue_message_retry_exhausted", requestId, messageId, attempt: used, error: reason });
      return;
    }

    // Nobody holds the lock and the budget is not spent, so this delivery is the
    // only chance to make progress: start the next cycle and let the new job take
    // over. A held lock or an already-SUCCESS row falls through to the quiet skip
    // below — the original delivery is still being retried by the other worker,
    // and the TTL reaper covers the case where it silently dies.
    if (state.status === "PENDING" && !state.lock_id) {
      if (await scheduleRetryCycle(messageId, env, requestId)) return;
    }

    logWarn({ event: "queue_claim_skipped", requestId, messageId });
    return;
  }

  const row = await env.DB.prepare(
    "SELECT r2_raw_key, mailbox_id, received_at, attempt FROM messages WHERE id = ?1 AND lock_id = ?2 LIMIT 1",
  )
    .bind(messageId, lockId)
    .first<{ r2_raw_key: string; mailbox_id: string; received_at: number; attempt: number }>();

  if (!row?.r2_raw_key) return;

  const attempt = Number(row.attempt) || 0;
  logInfo({ event: "queue_message_claimed", requestId, messageId, mailboxId: row.mailbox_id, attempt, status: "PENDING" });
  try {
    const rawObj = await env.MAIL_BUCKET.get(row.r2_raw_key);
    if (!rawObj?.body) throw new Error("raw email not found");
    logInfo({ event: "queue_r2_raw_read", requestId, messageId, mailboxId: row.mailbox_id, attempt });

    const parser = new PostalMime.default();
    const parsed = await parser.parse(await new Response(rawObj.body).arrayBuffer());
    logInfo({ event: "queue_mime_parsed", requestId, messageId, mailboxId: row.mailbox_id, attempt });

    const fromAddress =
      typeof parsed.from?.address === "string" ? parsed.from.address.trim().toLowerCase() : null;
    const fromName = typeof parsed.from?.name === "string" ? parsed.from.name : null;
    const subject = typeof parsed.subject === "string" ? parsed.subject : null;
    const textPlain = typeof parsed.text === "string" ? parsed.text : null;
    const html = typeof parsed.html === "string" ? parsed.html : null;

    const limit = Number(env.HTML_INLINE_LIMIT || "102400");

    let htmlInline: string | null = null;
    let htmlR2Key: string | null = null;
    if (html) {
      if (html.length >= limit) {
        htmlR2Key = `archive/html/${messageId}.html`;
        await env.MAIL_BUCKET.put(htmlR2Key, new TextEncoder().encode(html), {
          httpMetadata: { contentType: "text/html; charset=utf-8" },
          customMetadata: { messageId },
        });
      } else {
        htmlInline = html;
      }
    }

    const snippet = toSnippet(textPlain ?? subject);
    const parsedAt = Date.now();

    let aiCode: string | null = null;
    let aiService: string | null = null;
    const canUseAi = typeof (env as any).AI?.run === "function";
    if (canUseAi && shouldRunAi(subject, textPlain)) {
      logInfo({ event: "queue_ai_start", requestId, messageId, mailboxId: row.mailbox_id, attempt });
      try {
        const systemPrompt =
          'You are an email parser. Extract the verification code (OTP) and the service/platform name from the email. Respond with ONLY a valid JSON object, no markdown, no code fences, no extra text. If absent/uncertain, use null. Schema: {"verification_code": string|null, "service_name": string|null}.';
        const userContent = JSON.stringify(
          {
            subject: subject ?? "",
            fromAddress: fromAddress ?? "",
            fromName: fromName ?? "",
            textPlain: textPlain ?? "",
          },
          null,
          2,
        );

        const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
        });

        const raw =
          typeof result === "string"
            ? result
            : typeof (result as { response?: unknown } | null)?.response === "string"
              ? ((result as { response: string }).response ?? "")
              : JSON.stringify(result);

        const jsonText = extractJsonObject(raw) ?? raw;
        const parsedJson = JSON.parse(jsonText) as unknown;
        if (parsedJson && typeof parsedJson === "object") {
          const obj = parsedJson as Record<string, unknown>;
          aiCode = coerceNullableString(obj.verification_code);
          aiService = coerceNullableString(obj.service_name);
        }
      } catch {
        aiCode = null;
        aiService = null;
        logWarn({ event: "queue_ai_failed", requestId, messageId, mailboxId: row.mailbox_id, attempt });
      } finally {
        logInfo({ event: "queue_ai_done", requestId, messageId, mailboxId: row.mailbox_id, attempt });
      }
    }

    const updateRes = await env.DB.prepare(
      "UPDATE messages SET status='SUCCESS', error_reason=NULL, from_address=?2, from_name=?3, subject=?4, snippet=?5, text_plain=?6, html_inline=?7, html_r2_key=?8, parsed_at=?9, ai_code=?10, ai_service=?11, lock_id=NULL, locked_at=NULL WHERE id=?1 AND lock_id=?12",
    )
      .bind(
        messageId,
        fromAddress,
        fromName,
        subject,
        snippet,
        textPlain,
        htmlInline,
        htmlR2Key,
        parsedAt,
        aiCode,
        aiService,
        lockId,
      )
      .run();

    const updated = updateRes.meta?.changes ?? 0;
    if (updated === 0) return;
    logInfo({ event: "queue_message_saved", requestId, messageId, mailboxId: row.mailbox_id, attempt, status: "SUCCESS" });

    await env.DB.prepare("DELETE FROM messages_fts WHERE message_id = ?1").bind(messageId).run();
    await env.DB.prepare("INSERT INTO messages_fts (message_id, subject, body_text) VALUES (?1, ?2, ?3)")
      .bind(messageId, subject ?? "", textPlain ?? "")
      .run();
    logInfo({ event: "queue_fts_updated", requestId, messageId, mailboxId: row.mailbox_id, attempt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reason = msg.length > 800 ? msg.slice(0, 800) : msg;
    const failRes = await env.DB.prepare(
      "UPDATE messages SET status='FAILED', error_reason=?2, parsed_at=NULL, lock_id=NULL, locked_at=NULL WHERE id=?1 AND lock_id=?3",
    )
      .bind(messageId, reason, lockId)
      .run();
    const failed = failRes.meta?.changes ?? 0;
    if (failed === 0) return;
    if (attempt < maxAttempts) throw (err instanceof Error ? err : new Error(String(err)));
    logError({ event: "queue_message_failed_final", requestId, messageId, attempt, error: reason });
    return;
  }

  const mailbox = await env.DB.prepare("SELECT address FROM mailboxes WHERE id = ?1 LIMIT 1")
    .bind(row.mailbox_id)
    .first<{ address: string }>();
  if (mailbox?.address) {
    try {
      const id = env.MAIL_EVENTS.idFromName(mailbox.address);
      const stub = env.MAIL_EVENTS.get(id);
      await stub.fetch("https://mail-events/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId, receivedAt: row.received_at }),
      });
      logInfo({ event: "queue_notify_sent", requestId, messageId, mailboxId: row.mailbox_id, attempt });
    } catch {
      logWarn({ event: "queue_notify_failed", requestId, messageId, mailboxId: row.mailbox_id, attempt });
    }
  }
}
