import type { Env } from "../env";
import { json, text } from "../http";
import { hashPassword, verifyPassword } from "../auth";
import { logError } from "../log";
import {
  canDomainSend,
  extractDomainFromAddress,
  normalizeSendProvider,
  OutboundNotConfiguredError,
  sendOutboundEmail,
} from "../outbound";
import * as S from "./fetch.shared";

const MAX_RECIPIENTS = 20;
const MAX_SUBJECT_LENGTH = 998;
/** Per-part cap for the text/html bodies (Cloudflare's own limit is ~25 MiB total). */
const MAX_SEND_BODY_LENGTH = 512 * 1024;

export async function handleUserRoutes(request: Request, env: Env, url: URL, pathname: string): Promise<Response | null> {
  if (pathname === "/api/user/password" && request.method === "PUT") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;
    const body = await S.readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const oldPassword = S.getStringField(body, "oldPassword") || "";
    const newPassword = S.getStringField(body, "newPassword") || "";
    if (!oldPassword) return json({ error: "invalid_old_password" }, { status: 400 });
    if (newPassword.length < 8 || newPassword.length > 72) return json({ error: "invalid_new_password" }, { status: 400 });

    const user = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?1 LIMIT 1")
      .bind(auth.sub)
      .first<{ password_hash: string }>();
    if (!user?.password_hash) return json({ error: "unauthorized" }, { status: 401 });
    const ok = await verifyPassword(oldPassword, user.password_hash);
    if (!ok) return json({ error: "unauthorized" }, { status: 401 });

    const passwordHash = await hashPassword(newPassword);
    await env.DB.prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2").bind(passwordHash, auth.sub).run();
    return text("", { status: 204 });
  }

  if (pathname === "/api/user/mailbox" && request.method === "GET") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;

    const row = await env.DB.prepare("SELECT id, address FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ id: string; address: string }>();
    if (!row?.address) {
      return json({ address: null, canSend: false, sendableAddresses: [] });
    }

    const [aliasRows, domainRows] = await Promise.all([
      env.DB.prepare("SELECT address FROM mailbox_aliases WHERE mailbox_id = ?1 AND is_active = 1 ORDER BY created_at ASC")
        .bind(row.id)
        .all<{ address: string }>(),
      env.DB.prepare("SELECT domain, send_provider FROM domains WHERE is_active = 1")
        .all<{ domain: string; send_provider: string }>(),
    ]);

    const providerByDomain = new Map<string, string>();
    for (const d of domainRows.results) {
      providerByDomain.set(d.domain.toLowerCase(), d.send_provider);
    }

    const candidates = [row.address, ...aliasRows.results.map((a) => a.address)];
    const sendableAddresses = candidates.filter((addr) => {
      const dom = extractDomainFromAddress(addr);
      return canDomainSend(env, providerByDomain.get(dom));
    });

    return json({
      address: row.address,
      canSend: sendableAddresses.length > 0,
      sendableAddresses,
    });
  }

  if (pathname === "/api/user/send" && request.method === "POST") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;
    const requestId = (request.headers.get("x-request-id") || "").trim() || crypto.randomUUID();

    const body = await S.readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });

    const mailbox = await env.DB.prepare("SELECT id, address FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ id: string; address: string }>();
    if (!mailbox?.id) return json({ error: "mailbox_missing" }, { status: 409 });

    // Sender defaults to the primary mailbox; a different value must be one of the
    // user's own active aliases, so nobody can spoof another mailbox.
    const requestedFrom = S.getLowerStringField(body, "from");
    let from = mailbox.address;
    if (requestedFrom && requestedFrom !== mailbox.address) {
      const alias = await env.DB.prepare(
        "SELECT 1 AS ok FROM mailbox_aliases WHERE mailbox_id = ?1 AND address = ?2 AND is_active = 1 LIMIT 1",
      )
        .bind(mailbox.id, requestedFrom)
        .first<{ ok: 1 }>();
      if (!alias?.ok) return json({ error: "invalid_from" }, { status: 400 });
      from = requestedFrom;
    }

    const recipients = S.parseAddressList(S.getStringField(body, "to") || "");
    if (recipients.length === 0) return json({ error: "recipient_required" }, { status: 400 });
    if (recipients.length > MAX_RECIPIENTS) return json({ error: "too_many_recipients" }, { status: 400 });
    if (recipients.some((address) => !S.isValidEmailAddress(address))) {
      return json({ error: "invalid_recipient" }, { status: 400 });
    }

    const subject = (S.getStringField(body, "subject") || "").trim();
    const textBody = S.getStringField(body, "text") || "";
    const htmlBody = S.getStringField(body, "html") || "";
    if (subject.length > MAX_SUBJECT_LENGTH) return json({ error: "subject_too_long" }, { status: 400 });
    if (!textBody.trim() && !htmlBody.trim()) return json({ error: "body_required" }, { status: 400 });
    if (textBody.length > MAX_SEND_BODY_LENGTH || htmlBody.length > MAX_SEND_BODY_LENGTH) {
      return json({ error: "body_too_large" }, { status: 413 });
    }

    const fromDomain = extractDomainFromAddress(from);
    const domainRow = await env.DB.prepare("SELECT send_provider FROM domains WHERE domain = ?1 AND is_active = 1 LIMIT 1")
      .bind(fromDomain)
      .first<{ send_provider: string }>();
    const sendProvider = normalizeSendProvider(domainRow?.send_provider) ?? "none";
    if (!canDomainSend(env, sendProvider)) {
      return json({ error: "mail_not_configured" }, { status: 503 });
    }

    // A stolen session must not become an outbound spam relay, so sends share the
    // existing rate-limit Durable Object under a per-user key.
    const sendCheck = await S.sendRateCheck(env, auth.sub);
    if (sendCheck.limited) return json({ error: "rate_limited" }, { status: 429 });

    const id = crypto.randomUUID();
    const to = recipients.join(", ");
    const snippet = (textBody || htmlBody).replace(/\s+/g, " ").trim().slice(0, 140) || null;
    const sentAt = Date.now();
    // Send first; the provider's result is the source of truth. If it throws the
    // mail did not go out and we record a FAILED row. If it succeeds we must report
    // success even when recording in D1 later fails — otherwise the user sees
    // "发送失败" and re-sends an already-delivered message.
    let messageId: string | null = null;
    try {
      const result = await sendOutboundEmail(env, sendProvider, {
        from,
        to: recipients,
        subject,
        text: textBody || undefined,
        html: htmlBody || undefined,
      });
      messageId = result.messageId;
      // Counted only once the provider accepted it, so a failed attempt does not
      // eat the user's daily quota.
      await S.sendRateRecord(env, auth.sub);
    } catch (err) {
      if (err instanceof OutboundNotConfiguredError) {
        return json({ error: "mail_not_configured" }, { status: 503 });
      }
      const reason = err instanceof Error ? err.message : String(err);
      logError({ event: "send_message_failed", requestId, error: reason });
      // Keep a FAILED row so the attempt is visible instead of silently lost.
      await env.DB.prepare(
        "INSERT INTO sent_messages (id, mailbox_id, from_address, to_address, subject, snippet, status, error_reason, sent_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'FAILED', ?7, ?8)",
      )
        .bind(id, mailbox.id, from, to, subject || null, snippet, reason.slice(0, 500), sentAt)
        .run()
        .catch(() => undefined);
      return json({ error: "send_failed" }, { status: 502 });
    }

    // Best-effort record of a successful send; a failure here must not flip the
    // reported outcome.
    try {
      await env.DB.prepare(
        "INSERT INTO sent_messages (id, mailbox_id, from_address, to_address, subject, snippet, status, sent_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'SENT', ?7)",
      )
        .bind(id, mailbox.id, from, to, subject || null, snippet, sentAt)
        .run();
    } catch (err) {
      logError({
        event: "send_record_failed",
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return json({ message: { id, from, to: recipients, subject, status: "SENT" }, messageId }, { status: 201 });
  }

  if (pathname === "/api/user/sent" && request.method === "GET") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;

    const mailbox = await env.DB.prepare("SELECT id FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ id: string }>();
    if (!mailbox?.id) return json({ messages: [] });

    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "50"), 1), 200);
    const res = await env.DB.prepare(
      "SELECT id, from_address, to_address, subject, snippet, status, error_reason, sent_at FROM sent_messages WHERE mailbox_id = ?1 ORDER BY sent_at DESC LIMIT ?2",
    )
      .bind(mailbox.id, limit)
      .all<{
        id: string;
        from_address: string;
        to_address: string;
        subject: string | null;
        snippet: string | null;
        status: string;
        error_reason: string | null;
        sent_at: number;
      }>();

    return json({
      messages: res.results.map((r) => ({
        id: r.id,
        fromAddress: r.from_address,
        toAddress: r.to_address,
        subject: r.subject,
        snippet: r.snippet,
        status: r.status,
        errorReason: r.error_reason,
        sentAt: r.sent_at,
      })),
    });
  }

  if (pathname === "/api/user/messages" && request.method === "GET") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;

    const mailbox = await env.DB.prepare("SELECT id, address FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ id: string; address: string }>();
    if (!mailbox?.id) return json({ messages: [], address: null });

    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "50"), 1), 200);
    const rawAddress = (url.searchParams.get("address") || "").trim().toLowerCase();
    let filter: { address: string; includeNull?: boolean } | null = null;
    if (rawAddress && rawAddress !== "*" && rawAddress !== "all") {
      if (rawAddress === mailbox.address.toLowerCase()) {
        filter = { address: mailbox.address.toLowerCase(), includeNull: true };
      } else {
        const alias = await env.DB.prepare(
          "SELECT 1 AS ok FROM mailbox_aliases WHERE mailbox_id = ?1 AND address = ?2 AND is_active = 1 LIMIT 1",
        )
          .bind(mailbox.id, rawAddress)
          .first<{ ok: 1 }>();
        if (!alias?.ok) return json({ error: "mailbox_not_found" }, { status: 404 });
        filter = { address: rawAddress, includeNull: false };
      }
    }
    const page = await S.listMessagesPage(
      env,
      mailbox.id,
      limit,
      S.decodeCursor(url.searchParams.get("cursor")),
      filter,
    );
    return json({ address: mailbox.address, ...page });
  }

  if (pathname === "/api/user/red-dot" && request.method === "GET") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;

    const mailbox = await env.DB.prepare("SELECT id, address FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ id: string; address: string }>();
    if (!mailbox?.id) {
      return json(
        { address: null, since: 0, newCount: 0, latestReceivedAt: null, latestNewReceivedAt: null },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const since = await S.getMailboxReadState(env, mailbox.id);
    const unread = await S.getMailboxUnread(env, mailbox.id);

    return json(
      { address: mailbox.address, since, ...unread },
      { headers: { "cache-control": "no-store" } },
    );
  }

  if (pathname === "/api/user/read" && request.method === "POST") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;

    const mailbox = await env.DB.prepare("SELECT id, address FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ id: string; address: string }>();
    if (!mailbox?.id) return json({ error: "mailbox_missing" }, { status: 409 });

    const body = await S.readJsonBody(request);
    const receivedAt = S.getNumberField(body, "receivedAt");
    if (typeof receivedAt !== "number" || !Number.isFinite(receivedAt)) {
      return json({ error: "invalid_payload" }, { status: 400 });
    }

    const since = await S.markMailboxRead(env, mailbox.id, receivedAt);
    const unread = await S.getMailboxUnread(env, mailbox.id);
    return json({ address: mailbox.address, since, ...unread }, { headers: { "cache-control": "no-store" } });
  }

  if (pathname === "/api/user/read-all" && request.method === "POST") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;

    const mailbox = await env.DB.prepare("SELECT id, address FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ id: string; address: string }>();
    if (!mailbox?.id) return json({ error: "mailbox_missing" }, { status: 409 });

    const body = await S.readJsonBody(request);
    const rawAddress = (S.getLowerStringField(body, "address") || "").trim();
    let filter: { address: string; includeNull?: boolean } | null = null;
    if (rawAddress && rawAddress !== "*" && rawAddress !== "all") {
      if (rawAddress === mailbox.address.toLowerCase()) {
        filter = { address: mailbox.address.toLowerCase(), includeNull: true };
      } else {
        const alias = await env.DB.prepare(
          "SELECT 1 AS ok FROM mailbox_aliases WHERE mailbox_id = ?1 AND address = ?2 AND is_active = 1 LIMIT 1",
        )
          .bind(mailbox.id, rawAddress)
          .first<{ ok: 1 }>();
        if (!alias?.ok) return json({ error: "mailbox_not_found" }, { status: 404 });
        filter = { address: rawAddress, includeNull: false };
      }
    }

    const updatedCount = await S.markMailboxMessagesRead(env, mailbox.id, filter);
    const since = await S.getMailboxReadState(env, mailbox.id);
    const unread = await S.getMailboxUnread(env, mailbox.id);
    return json(
      { ok: true, updatedCount, address: mailbox.address, since, ...unread },
      { headers: { "cache-control": "no-store" } },
    );
  }

  if (pathname === "/api/user/ws" && request.method === "GET") {
    const authRes = await S.requireAuthWsOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;

    const mailbox = await env.DB.prepare("SELECT address FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ address: string }>();
    if (!mailbox?.address) return json({ error: "mailbox_missing" }, { status: 409 });

    const id = env.MAIL_EVENTS.idFromName(mailbox.address);
    const stub = env.MAIL_EVENTS.get(id);
    const doReq = new Request("https://mail-events/connect", request);
    return stub.fetch(doReq);
  }

  if (pathname === "/api/user/aliases" && request.method === "GET") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;

    const mailbox = await env.DB.prepare("SELECT id, address FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ id: string; address: string }>();
    if (!mailbox?.id) return json({ error: "mailbox_missing" }, { status: 409 });

    const res = await env.DB.prepare(
      "SELECT address FROM mailbox_aliases WHERE mailbox_id = ?1 AND is_active = 1 ORDER BY created_at DESC",
    )
      .bind(mailbox.id)
      .all<{ address: string }>();
    const maxAliases = await S.getMaxAliases(env);
    return json({ aliases: res.results.map((r) => r.address), maxAliases, mailbox: mailbox.address });
  }

  if (pathname === "/api/user/aliases" && request.method === "POST") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;

    const body = await S.readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const domain = S.normalizeDomain(S.getStringField(body, "domain") || "");
    const local = S.normalizeLocalPart(S.getStringField(body, "local") || "");
    if (!domain) return json({ error: "domain_required" }, { status: 400 });
    if (!local) return json({ error: "mailbox_required" }, { status: 400 });
    if (!S.isValidDomain(domain)) return json({ error: "invalid_domain" }, { status: 400 });
    if (!S.isValidLocalPart(local)) return json({ error: "invalid_mailbox_local" }, { status: 400 });
    const allowedDomain = await S.requireActiveDomain(env, domain);
    if (!allowedDomain) return json({ error: "domain_not_allowed" }, { status: 400 });
    const address = S.makeEmailAddress(local, allowedDomain);

    const mailbox = await env.DB.prepare("SELECT id, address FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ id: string; address: string }>();
    if (!mailbox?.id) return json({ error: "mailbox_missing" }, { status: 409 });
    if (address === mailbox.address) return json({ error: "invalid_alias" }, { status: 400 });

    const maxAliases = await S.getMaxAliases(env);
    const countRes = await env.DB.prepare(
      "SELECT COUNT(1) AS c FROM mailbox_aliases WHERE mailbox_id = ?1 AND is_active = 1",
    )
      .bind(mailbox.id)
      .first<{ c: number }>();
    if ((countRes?.c ?? 0) >= maxAliases) return json({ error: "max_aliases_reached" }, { status: 409 });

    const primaryTaken = await env.DB.prepare("SELECT 1 AS ok FROM mailboxes WHERE address = ?1 AND is_active = 1 LIMIT 1")
      .bind(address)
      .first<{ ok: 1 }>();
    if (primaryTaken?.ok) return json({ error: "address_taken" }, { status: 409 });

    const aliasTaken = await env.DB.prepare("SELECT 1 AS ok FROM mailbox_aliases WHERE address = ?1 AND is_active = 1 LIMIT 1")
      .bind(address)
      .first<{ ok: 1 }>();
    if (aliasTaken?.ok) return json({ error: "address_taken" }, { status: 409 });

    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO mailbox_aliases (id, mailbox_id, address, is_active) VALUES (?1, ?2, ?3, 1)")
      .bind(id, mailbox.id, address)
      .run();
    return json({ alias: { id, address } }, { status: 201 });
  }

  const aliasDeleteMatch = pathname.match(/^\/api\/user\/aliases\/([^/]+)$/);
  if (aliasDeleteMatch && request.method === "DELETE") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;
    const address = decodeURIComponent(aliasDeleteMatch[1]).trim().toLowerCase();
    if (!address || !address.includes("@")) return json({ error: "invalid_address" }, { status: 400 });
    const mailbox = await env.DB.prepare("SELECT id FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ id: string }>();
    if (!mailbox?.id) return json({ error: "mailbox_missing" }, { status: 409 });
    await env.DB.prepare("UPDATE mailbox_aliases SET is_active = 0 WHERE mailbox_id = ?1 AND address = ?2")
      .bind(mailbox.id, address)
      .run();
    return text("", { status: 204 });
  }

  if (pathname === "/api/user/blocked-senders" && request.method === "GET") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;

    const mailbox = await env.DB.prepare("SELECT id FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ id: string }>();
    if (!mailbox?.id) return json({ senders: [] });

    const res = await env.DB.prepare(
      "SELECT sender, created_at FROM blocked_senders WHERE mailbox_id = ?1 ORDER BY created_at DESC",
    )
      .bind(mailbox.id)
      .all<{ sender: string; created_at: number }>();

    return json({
      senders: (res.results || []).map((r) => ({ sender: r.sender, createdAt: r.created_at })),
    });
  }

  if (pathname === "/api/user/blocked-senders" && request.method === "POST") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;

    const body = await S.readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const sender = S.getLowerStringField(body, "sender") || "";
    if (!S.isValidEmailAddress(sender)) return json({ error: "invalid_sender" }, { status: 400 });

    const mailbox = await env.DB.prepare("SELECT id FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ id: string }>();
    if (!mailbox?.id) return json({ error: "mailbox_missing" }, { status: 409 });

    // The ingest path compares the lowercased envelope sender, so storing the
    // normalised form is what makes the rule actually match.
    try {
      await env.DB.prepare("INSERT INTO blocked_senders (id, mailbox_id, sender) VALUES (?1, ?2, ?3)")
        .bind(crypto.randomUUID(), mailbox.id, sender)
        .run();
    } catch (err) {
      if (S.isUniqueViolation(err)) return json({ error: "sender_already_blocked" }, { status: 409 });
      throw err;
    }
    return json({ sender }, { status: 201 });
  }

  if (pathname === "/api/user/blocked-senders" && request.method === "DELETE") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;

    const body = await S.readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const sender = S.getLowerStringField(body, "sender") || "";
    if (!sender) return json({ error: "invalid_sender" }, { status: 400 });

    const mailbox = await env.DB.prepare("SELECT id FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ id: string }>();
    if (!mailbox?.id) return json({ error: "mailbox_missing" }, { status: 409 });

    await env.DB.prepare("DELETE FROM blocked_senders WHERE mailbox_id = ?1 AND sender = ?2")
      .bind(mailbox.id, sender)
      .run();
    return text("", { status: 204 });
  }

  return null;
}
