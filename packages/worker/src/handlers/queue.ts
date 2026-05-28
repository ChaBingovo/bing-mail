import * as PostalMime from "postal-mime";
import type { MessageBatch } from "@cloudflare/workers-types";
import type { Env, ParseQueueMessage } from "../env";

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

export async function handleQueue(batch: MessageBatch<ParseQueueMessage>, env: Env, _ctx: ExecutionContext) {
  await Promise.allSettled(
    batch.messages.map(async (msg) => {
      try {
        await processOne(msg.body.messageId, env);
        msg.ack();
      } catch {
        msg.retry();
      }
    }),
  );
}

async function processOne(messageId: string, env: Env) {
  const rawMaxAttempts = Number(env.PARSE_QUEUE_MAX_ATTEMPTS || "5");
  const maxAttempts =
    Number.isFinite(rawMaxAttempts) && rawMaxAttempts > 0 ? Math.floor(rawMaxAttempts) : 5;

  const [claimRes, rowRes] = await env.DB.batch([
    env.DB.prepare(
      "UPDATE messages SET attempt = attempt + 1, status='PENDING', error_reason=NULL WHERE id = ?1 AND status != 'SUCCESS' AND attempt < ?2",
    ).bind(messageId, maxAttempts),
    env.DB.prepare("SELECT r2_raw_key, mailbox_id, received_at, attempt FROM messages WHERE id = ?1 LIMIT 1").bind(
      messageId,
    ),
  ]);

  const changes = claimRes.meta?.changes ?? 0;
  if (changes === 0) return;

  const row = (rowRes.results?.[0] ?? null) as
    | { r2_raw_key: string; mailbox_id: string; received_at: number; attempt: number }
    | null;

  if (!row?.r2_raw_key) return;

  const attempt = Number(row.attempt) || 0;
  try {
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

    let aiCode: string | null = null;
    let aiService: string | null = null;
    const canUseAi = typeof (env as any).AI?.run === "function";
    if (canUseAi && shouldRunAi(subject, textPlain)) {
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
      }
    }

    await env.DB.prepare(
      "UPDATE messages SET status='SUCCESS', error_reason=NULL, from_address=?2, from_name=?3, subject=?4, snippet=?5, text_plain=?6, html_inline=?7, html_r2_key=?8, parsed_at=?9, ai_code=?10, ai_service=?11 WHERE id=?1",
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
      )
      .run();

    await env.DB.prepare("DELETE FROM messages_fts WHERE message_id = ?1").bind(messageId).run();
    await env.DB.prepare("INSERT INTO messages_fts (message_id, subject, body_text) VALUES (?1, ?2, ?3)")
      .bind(messageId, subject ?? "", textPlain ?? "")
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reason = msg.length > 800 ? msg.slice(0, 800) : msg;
    await env.DB.prepare("UPDATE messages SET status='FAILED', error_reason=?2, parsed_at=NULL WHERE id=?1")
      .bind(messageId, reason)
      .run();
    if (attempt < maxAttempts) throw (err instanceof Error ? err : new Error(String(err)));
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
    } catch {}
  }
}
