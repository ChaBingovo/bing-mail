import type { Env } from "../env";

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
    message.setReject("Unknown recipient");
    return;
  }

  const blockRes = await env.DB.prepare(
    "SELECT 1 AS ok FROM blocked_senders WHERE mailbox_id = ?1 AND sender = ?2 LIMIT 1",
  )
    .bind(target.id, from)
    .first<{ ok: 1 }>();

  if (blockRes?.ok) {
    message.setReject("Blocked sender");
    return;
  }

  const messageId = crypto.randomUUID();
  const receivedAt = Date.now();
  const rawKey = `raw/${messageId}.eml`;

  ctx.waitUntil(
    (async () => {
      await env.MAIL_BUCKET.put(rawKey, message.raw);
      await env.DB.prepare(
        "INSERT INTO messages (id, mailbox_id, status, received_at, r2_raw_key) VALUES (?1, ?2, 'PENDING', ?3, ?4)",
      )
        .bind(messageId, target.id, receivedAt, rawKey)
        .run();
      await env.PARSE_QUEUE.send({ messageId });
    })(),
  );
}
