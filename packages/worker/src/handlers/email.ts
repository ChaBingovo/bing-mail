import type { Env } from "../env";
import { logError, logInfo, logWarn } from "../log";

function normalizeAddress(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "object" && value && "address" in value) {
    const addr = (value as { address?: unknown }).address;
    if (typeof addr === "string") return addr.trim().toLowerCase();
  }
  return String(value).trim().toLowerCase();
}

export async function handleEmail(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
  const requestId = crypto.randomUUID();
  const to = normalizeAddress(message.to);
  const from = normalizeAddress(message.from);

  const mailboxRes = await env.DB.prepare(
    "SELECT id, user_id FROM mailboxes WHERE address = ?1 AND is_active = 1 LIMIT 1",
  )
    .bind(to)
    .first<{ id: string; user_id: string | null }>();

  const aliasRes = mailboxRes?.id
    ? null
    : await env.DB.prepare(
        "SELECT m.id, m.user_id FROM mailbox_aliases a JOIN mailboxes m ON m.id = a.mailbox_id WHERE a.address = ?1 AND a.is_active = 1 AND m.is_active = 1 LIMIT 1",
      )
        .bind(to)
        .first<{ id: string; user_id: string | null }>();

  const target = mailboxRes?.id ? mailboxRes : aliasRes;

  if (!target?.id || !target.user_id) {
    logWarn({ event: "email_ingest_reject_unknown_recipient", requestId });
    message.setReject("Unknown recipient");
    return;
  }

  const blockRes = await env.DB.prepare(
    "SELECT 1 AS ok FROM blocked_senders WHERE mailbox_id = ?1 AND sender = ?2 LIMIT 1",
  )
    .bind(target.id, from)
    .first<{ ok: 1 }>();

  if (blockRes?.ok) {
    logWarn({
      event: "email_ingest_reject_blocked_sender",
      requestId,
      mailboxId: target.id,
      userId: target.user_id || undefined,
    });
    message.setReject("Blocked sender");
    return;
  }

  const messageId = crypto.randomUUID();
  const receivedAt = Date.now();
  const rawKey = `archive/raw/${messageId}.eml`;
  logInfo({ event: "email_ingest_accept", requestId, messageId, mailboxId: target.id, userId: target.user_id || undefined });

  ctx.waitUntil(
    (async () => {
      try {
        await env.MAIL_BUCKET.put(rawKey, message.raw, {
          httpMetadata: { contentType: "message/rfc822" },
          customMetadata: { mailboxId: target.id, receivedAt: String(receivedAt) },
        });
        await env.DB.prepare(
          "INSERT INTO messages (id, mailbox_id, status, received_at, r2_raw_key) VALUES (?1, ?2, 'PENDING', ?3, ?4)",
        )
          .bind(messageId, target.id, receivedAt, rawKey)
          .run();
        await env.PARSE_QUEUE.send({ messageId });
        logInfo({
          event: "email_ingest_enqueued",
          requestId,
          messageId,
          mailboxId: target.id,
          userId: target.user_id || undefined,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError({ event: "email_ingest_failed", requestId, messageId, mailboxId: target.id, error: msg });
        throw err;
      }
    })(),
  );
}
