import type { Env } from "../env";
import { json, text } from "../http";
import { logError, logInfo, logWarn } from "../log";
import { assertPublicHttpUrl } from "../url-guard";
import * as S from "./fetch.shared";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PROXY_REDIRECTS = 3;

/** Maps the hosting extension to a content type; used only to corroborate the response. */
function guessImageContentType(pathname: string) {
  const ext = (pathname.split(".").pop() || "").toLowerCase();
  if (ext === "webp") return "image/webp";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "avif") return "image/avif";
  if (ext === "bmp") return "image/bmp";
  if (ext === "svg" || ext === "svgz") return "image/svg+xml";
  if (ext === "ico") return "image/x-icon";
  return "";
}

function sniffImageMagic(buf: Uint8Array) {
  const startsWith = (...bytes: number[]) =>
    bytes.every((b, i) => buf.length > i && buf[i] === b);
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (startsWith(0x42, 0x4d)) return "image/bmp";
  if (buf.length >= 12 && startsWith(0x52, 0x49, 0x46, 0x46)) {
    const tag = String.fromCharCode(...buf.slice(8, 12));
    if (tag === "WEBP") return "image/webp";
    if (tag === "AVIF") return "image/avif";
  }
  // SVG has no magic number: only accept it after whitespace or a markup prefix.
  const head = new TextDecoder().decode(buf.slice(0, 128)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  return "";
}

/**
 * Fetches one remote image for the reader, validating every hop.
 * Returns the response body as bytes so the whole payload fits the size cap.
 */
async function fetchProxiedImage(
  startUrl: string,
  referer: string | null,
  requestId: string,
): Promise<{ ok: true; bytes: Uint8Array; contentType: string } | { ok: false; status: number }> {
  let next = startUrl;

  for (let hop = 0; hop <= MAX_PROXY_REDIRECTS; hop += 1) {
    const check = assertPublicHttpUrl(next);
    if (!check.ok) {
      logWarn({ event: "media_proxy_blocked_url", requestId, error: check.reason });
      return { ok: false, status: 403 };
    }

    let res: Response;
    try {
      res = await fetch(check.url, {
        redirect: "manual",
        headers: {
          "user-agent": "bingmail/1.0",
          accept: "image/*,image/webp,image/svg+xml;q=0.9,*/*;q=0.1",
          ...(referer ? { referer } : {}),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn({ event: "media_proxy_fetch_failed", requestId, error: message });
      return { ok: false, status: 503 };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { ok: false, status: 502 };
      if (hop === MAX_PROXY_REDIRECTS) return { ok: false, status: 502 };
      next = new URL(location, check.url).toString();
      continue;
    }

    if (!res.ok) return { ok: false, status: 404 };

    const declared = Number(res.headers.get("content-length") || "0") || 0;
    if (declared > MAX_IMAGE_BYTES) return { ok: false, status: 413 };

    // Read with a hard cap: a chunked response has no content-length to trust.
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, status: 502 };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        try {
          await reader.cancel();
        } catch {}
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const declaredType = (res.headers.get("content-type") || "").toLowerCase();
    const declaredIsImage = declaredType.startsWith("image/");
    const cleanDeclared = declaredIsImage ? declaredType.split(";")[0].trim() : "";
    const guessed = guessImageContentType(new URL(check.url).pathname);
    const sniffed = sniffImageMagic(bytes);
    // An explicitly non-image content type without image magic bytes is a miss,
    // even when the URL extension looks like an image (e.g. HTML served at *.png).
    if (!sniffed && declaredType && !declaredIsImage) return { ok: false, status: 415 };
    const contentType = sniffed || cleanDeclared || guessed;
    if (!contentType.startsWith("image/")) return { ok: false, status: 415 };

    return { ok: true, bytes, contentType };
  }

  return { ok: false, status: 502 };
}


export async function handleMailRoutes(request: Request, env: Env, url: URL, pathname: string): Promise<Response | null> {
  const wsMailboxMatch = pathname.match(/^\/api\/ws\/mailboxes\/([^/]+)$/);
  if (wsMailboxMatch && request.method === "GET") {
    const authRes = await S.requireAuthWsOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;
    const address = decodeURIComponent(wsMailboxMatch[1]).trim().toLowerCase();
    const mailbox = await S.requireMailboxAccess(env, auth, address);
    if (!mailbox?.id) return json({ error: "mailbox_not_found" }, { status: 404 });

    const id = env.MAIL_EVENTS.idFromName(mailbox.address);
    const stub = env.MAIL_EVENTS.get(id);
    const doReq = new Request("https://mail-events/connect", request);
    return stub.fetch(doReq);
  }

  const mailboxMatch = pathname.match(/^\/api\/mailboxes\/([^/]+)\/messages$/);
  if (mailboxMatch && request.method === "GET") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;
    const address = decodeURIComponent(mailboxMatch[1]).trim().toLowerCase();
    const mailbox = await S.requireMailboxAccess(env, auth, address);
    if (!mailbox?.id) return json({ error: "mailbox_not_found" }, { status: 404 });

    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "50"), 1), 200);
    const page = await S.listMessagesPage(env, mailbox.id, limit, S.decodeCursor(url.searchParams.get("cursor")));
    return json(page);
  }

  const redDotMatch = pathname.match(/^\/api\/mailboxes\/([^/]+)\/red-dot$/);
  if (redDotMatch && request.method === "GET") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;
    const address = decodeURIComponent(redDotMatch[1]).trim().toLowerCase();
    const mailbox = await S.requireMailboxAccess(env, auth, address);
    if (!mailbox?.id) return json({ error: "mailbox_not_found" }, { status: 404 });

    const since = await S.getMailboxReadState(env, mailbox.id);
    const unread = await S.getMailboxUnread(env, mailbox.id);

    return json(
      { address, since, ...unread },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const readMatch = pathname.match(/^\/api\/mailboxes\/([^/]+)\/read$/);
  if (readMatch && request.method === "POST") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;
    const address = decodeURIComponent(readMatch[1]).trim().toLowerCase();
    const mailbox = await S.requireMailboxAccess(env, auth, address);
    if (!mailbox?.id) return json({ error: "mailbox_not_found" }, { status: 404 });

    const body = await S.readJsonBody(request);
    const receivedAt = S.getNumberField(body, "receivedAt");
    if (typeof receivedAt !== "number" || !Number.isFinite(receivedAt)) {
      return json({ error: "invalid_payload" }, { status: 400 });
    }

    const since = await S.markMailboxRead(env, mailbox.id, receivedAt);
    const unread = await S.getMailboxUnread(env, mailbox.id);
    return json({ address, since, ...unread }, { headers: { "cache-control": "no-store" } });
  }

  if (pathname === "/api/media/proxy" && request.method === "GET") {
    const auth = await S.requireAuth(request, env);
    if (!auth) return text("", { status: 401 });
    const raw = (url.searchParams.get("url") || "").trim();
    if (!raw) return text("", { status: 400 });

    const requestId = (request.headers.get("x-request-id") || "").trim() || crypto.randomUUID();
    // Reject private/loopback/Cloudflare-internal targets before any egress.
    const initial = assertPublicHttpUrl(raw);
    if (!initial.ok) {
      logWarn({ event: "media_proxy_blocked_url", requestId, error: initial.reason });
      return text("", { status: 403, headers: { "x-request-id": requestId } });
    }

    const upstreamReferer = (request.headers.get("referer") || "").trim() || null;
    const result = await fetchProxiedImage(initial.url, upstreamReferer, requestId);
    if (!result.ok) {
      return text("", { status: result.status, headers: { "x-request-id": requestId } });
    }

    const headers = new Headers();
    headers.set("content-type", result.contentType);
    headers.set("cache-control", "private, max-age=3600");
    headers.set("x-content-type-options", "nosniff");
    headers.set("content-security-policy", "sandbox; default-src 'none'");
    headers.set("cross-origin-resource-policy", "same-site");
    // BufferSource: hand the runtime a plain ArrayBuffer slice.
    return new Response(result.bytes.slice().buffer as ArrayBuffer, { status: 200, headers });
  }

  const msgRetryMatch = pathname.match(/^\/api\/messages\/([^/]+)\/retry$/);
  if (msgRetryMatch && request.method === "POST") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;
    const id = decodeURIComponent(msgRetryMatch[1]);
    const requestId = (request.headers.get("x-request-id") || "").trim() || crypto.randomUUID();

    const row = await S.requireMessageAccess(env, auth, id);
    if (!row) return json({ error: "message_not_found" }, { status: 404 });
    // Only a definitively failed row may be re-parsed: a SUCCESS row must not be
    // re-run, and a PENDING row is already queued (the reaper covers a dead consumer).
    if (row.status === "SUCCESS") return json({ error: "already_parsed" }, { status: 409 });
    if (row.status !== "FAILED") return json({ error: "not_retryable" }, { status: 409 });

    const raw = await env.DB.prepare("SELECT r2_raw_key FROM messages WHERE id = ?1 LIMIT 1")
      .bind(id)
      .first<{ r2_raw_key: string }>();
    if (!raw?.r2_raw_key) return json({ error: "raw_missing" }, { status: 409 });

    // A retry re-reads the raw mail, so a missing R2 object would fail again. Check
    // before resetting the row instead of sending the user into a second failure.
    const rawObject = await env.MAIL_BUCKET.head(raw.r2_raw_key);
    if (!rawObject) return json({ error: "raw_missing" }, { status: 409 });

    // Reset the row first (status-guarded, so a concurrent retry loses cleanly) and
    // only then enqueue; the consumer re-reads the raw mail from R2, so nothing is
    // duplicated. A failed enqueue is rolled back to FAILED rather than leaving a
    // PENDING row with no job behind it.
    const reset = await env.DB.prepare(
      "UPDATE messages SET status='PENDING', attempt=0, error_reason=NULL, lock_id=NULL, locked_at=NULL, parsed_at=NULL WHERE id=?1 AND status='FAILED'",
    )
      .bind(id)
      .run();
    if ((reset.meta?.changes ?? 0) === 0) return json({ error: "not_retryable" }, { status: 409 });

    try {
      await env.PARSE_QUEUE.send({ messageId: id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError({ event: "message_retry_enqueue_failed", requestId, messageId: id, error: message });
      await env.DB.prepare("UPDATE messages SET status='FAILED', error_reason=?2 WHERE id=?1 AND status='PENDING'")
        .bind(id, "retry enqueue failed")
        .run()
        .catch(() => undefined);
      return json({ error: "enqueue_failed" }, { status: 502 });
    }

    logInfo({ event: "message_retry_requested", requestId, messageId: id });
    return json({ id, status: "PENDING" }, { status: 202 });
  }

  const msgMetaMatch = pathname.match(/^\/api\/messages\/([^/]+)$/);
  const msgMetaMatchDelete = msgMetaMatch;

  if (msgMetaMatchDelete && request.method === "DELETE") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;
    const id = decodeURIComponent(msgMetaMatchDelete[1]);
    const requestId = (request.headers.get("x-request-id") || "").trim() || crypto.randomUUID();

    const row = await S.requireMessageAccess(env, auth, id);
    if (!row) return json({ error: "message_not_found" }, { status: 404 });

    // R2 first, D1 second — the same ordering the retention sweep uses. If the R2
    // delete fails the row survives and the daily cron retries it, so a failure
    // cannot orphan the message. Deleting the other way round would leave bytes
    // nobody references.
    const keys = [row.r2_raw_key, row.html_r2_key].filter((k): k is string => typeof k === "string" && k.length > 0);
    const attachments = await env.DB.prepare("SELECT r2_key FROM message_attachments WHERE message_id = ?1")
      .bind(id)
      .all<{ r2_key: string }>();
    for (const attachment of attachments.results || []) {
      if (attachment.r2_key) keys.push(attachment.r2_key);
    }

    if (keys.length > 0) {
      try {
        await env.MAIL_BUCKET.delete(keys);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError({ event: "message_delete_r2_failed", requestId, messageId: id, error: message });
        return json({ error: "delete_failed" }, { status: 502 });
      }
    }

    await env.DB.batch([
      env.DB.prepare("DELETE FROM messages_fts WHERE message_id = ?1").bind(id),
      env.DB.prepare("DELETE FROM message_attachments WHERE message_id = ?1").bind(id),
      env.DB.prepare("DELETE FROM messages WHERE id = ?1").bind(id),
    ]);

    logInfo({ event: "message_deleted", requestId, messageId: id, userId: auth.sub });
    return text("", { status: 204 });
  }

  if (msgMetaMatch && request.method === "GET") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;
    const id = decodeURIComponent(msgMetaMatch[1]);
    const row = await S.requireMessageAccess(env, auth, id);
    if (!row) return json({ error: "message_not_found" }, { status: 404 });

    const attachments = await env.DB.prepare(
      "SELECT id, filename, content_type, size, content_id, is_inline FROM message_attachments WHERE message_id = ?1 ORDER BY created_at ASC",
    )
      .bind(id)
      .all<{
        id: string;
        filename: string;
        content_type: string;
        size: number;
        content_id: string | null;
        is_inline: number;
      }>();

    return json({
      message: {
        id: row.id,
        mailboxId: row.mailbox_id,
        status: row.status,
        fromName: row.from_name,
        fromAddress: row.from_address,
        toAddress: row.to_address ?? null,
        subject: row.subject,
        snippet: row.snippet,
        receivedAt: row.received_at,
        parsedAt: row.parsed_at,
        hasText: Boolean(row.text_plain),
        hasHtml: Boolean(row.html_inline || row.html_r2_key),
        aiCode: row.ai_code ?? null,
        aiService: row.ai_service ?? null,
        attachments: (attachments.results || []).map((a) => ({
          id: a.id,
          filename: a.filename,
          contentType: a.content_type,
          size: a.size,
          contentId: a.content_id,
          isInline: Boolean(a.is_inline),
          url: `/api/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(a.id)}`,
        })),
      },
    });
  }

  const msgAttachmentsMatch = pathname.match(/^\/api\/messages\/([^/]+)\/attachments$/);
  if (msgAttachmentsMatch && request.method === "GET") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;
    const id = decodeURIComponent(msgAttachmentsMatch[1]);
    const row = await S.requireMessageAccess(env, auth, id);
    if (!row) return json({ error: "message_not_found" }, { status: 404 });

    const res = await env.DB.prepare(
      "SELECT id, filename, content_type, size, content_id, is_inline FROM message_attachments WHERE message_id = ?1 ORDER BY created_at ASC",
    )
      .bind(id)
      .all<{
        id: string;
        filename: string;
        content_type: string;
        size: number;
        content_id: string | null;
        is_inline: number;
      }>();

    return json({
      attachments: (res.results || []).map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.content_type,
        size: a.size,
        contentId: a.content_id,
        isInline: Boolean(a.is_inline),
        url: `/api/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(a.id)}`,
      })),
    });
  }

  const msgAttachmentMatch = pathname.match(/^\/api\/messages\/([^/]+)\/attachments\/([^/]+)$/);
  if (msgAttachmentMatch && request.method === "GET") {
    const auth = await S.requireAuth(request, env);
    if (!auth) return text("", { status: 401 });
    const id = decodeURIComponent(msgAttachmentMatch[1]);
    const attachmentId = decodeURIComponent(msgAttachmentMatch[2]);
    const row = await S.requireMessageAccess(env, auth, id);
    if (!row) return text("", { status: 404 });

    const attachment = await env.DB.prepare(
      "SELECT id, filename, content_type, r2_key, is_inline FROM message_attachments WHERE id = ?1 AND message_id = ?2 LIMIT 1",
    )
      .bind(attachmentId, id)
      .first<{ id: string; filename: string; content_type: string; r2_key: string; is_inline: number }>();
    if (!attachment?.r2_key) return text("", { status: 404 });

    const object = await env.MAIL_BUCKET.get(attachment.r2_key);
    if (!object?.body) return text("", { status: 404 });

    // `inline=1` is only honoured for images: anything else must stay a download so
    // a text/html attachment can never render in the origin.
    const wantsInline = (url.searchParams.get("inline") || "") === "1";
    const canInline = wantsInline && attachment.content_type.startsWith("image/");

    const headers = new Headers();
    headers.set("content-type", attachment.content_type);
    headers.set("x-content-type-options", "nosniff");
    headers.set("cache-control", "private, max-age=3600");
    headers.set("content-security-policy", "sandbox; default-src 'none'");
    if (canInline) {
      headers.set("cross-origin-resource-policy", "same-site");
    } else {
      // RFC 5987 filename* keeps non-ASCII names working; the ASCII fallback is
      // stripped of quotes so the header cannot be broken out of.
      const asciiName = attachment.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
      headers.set(
        "content-disposition",
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      );
    }

    return new Response(object.body, { status: 200, headers });
  }

  const msgTextMatch = pathname.match(/^\/api\/messages\/([^/]+)\/text$/);
  if (msgTextMatch && request.method === "GET") {
    const auth = await S.requireAuth(request, env);
    if (!auth) return text("", { status: 401 });
    const id = decodeURIComponent(msgTextMatch[1]);
    const row = await S.requireMessageAccess(env, auth, id);
    if (!row) return text("", { status: 404 });
    if (!row.text_plain) return text("", { status: 204 });
    return new Response(row.text_plain, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  }

  const msgHtmlMatch = pathname.match(/^\/api\/messages\/([^/]+)\/html$/);
  if (msgHtmlMatch && request.method === "GET") {
    const auth = await S.requireAuth(request, env);
    if (!auth) return text("", { status: 401 });
    const id = decodeURIComponent(msgHtmlMatch[1]);
    const row = await S.requireMessageAccess(env, auth, id);
    if (!row) return text("", { status: 404 });

    if (row.html_inline) {
      return new Response(row.html_inline, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; img-src https: http: data:; style-src 'unsafe-inline'",
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
        },
      });
    }
    if (row.html_r2_key) {
      const obj = await env.MAIL_BUCKET.get(row.html_r2_key);
      if (!obj?.body) return text("", { status: 404 });
      return new Response(obj.body, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; img-src https: http: data:; style-src 'unsafe-inline'",
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
        },
      });
    }
    return text("", { status: 204 });
  }

  return null;
}
