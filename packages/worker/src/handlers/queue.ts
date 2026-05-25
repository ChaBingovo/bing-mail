import * as PostalMime from "postal-mime";
import type { MessageBatch } from "@cloudflare/workers-types";
import type { Env, ParseQueueMessage } from "../env";

function toSnippet(value: string | null | undefined, limit = 140) {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, limit);
}

export async function handleQueue(batch: MessageBatch<ParseQueueMessage>, env: Env, ctx: ExecutionContext) {
  for (const msg of batch.messages) {
    ctx.waitUntil(processOne(msg.body.messageId, env));
  }
}

async function processOne(messageId: string, env: Env) {
  const row = await env.DB.prepare("SELECT r2_raw_key, mailbox_id FROM messages WHERE id = ?1 LIMIT 1")
    .bind(messageId)
    .first<{ r2_raw_key: string; mailbox_id: string }>();

  if (!row?.r2_raw_key) return;

  const rawObj = await env.MAIL_BUCKET.get(row.r2_raw_key);
  if (!rawObj?.body) throw new Error("raw email not found");

  const parser = new PostalMime.default();
  const parsed = await parser.parse(await new Response(rawObj.body).arrayBuffer());

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
      htmlR2Key = `html/${messageId}.html`;
      await env.MAIL_BUCKET.put(htmlR2Key, new TextEncoder().encode(html), {
        httpMetadata: { contentType: "text/html; charset=utf-8" },
      });
    } else {
      htmlInline = html;
    }
  }

  const snippet = toSnippet(textPlain ?? subject);
  const parsedAt = Date.now();

  await env.DB.prepare(
    "UPDATE messages SET status='SUCCESS', from_address=?2, from_name=?3, subject=?4, snippet=?5, text_plain=?6, html_inline=?7, html_r2_key=?8, parsed_at=?9 WHERE id=?1",
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
    )
    .run();

  await env.DB.prepare("DELETE FROM messages_fts WHERE message_id = ?1").bind(messageId).run();
  await env.DB.prepare("INSERT INTO messages_fts (message_id, subject, body_text) VALUES (?1, ?2, ?3)")
    .bind(messageId, subject ?? "", textPlain ?? "")
    .run();
}
