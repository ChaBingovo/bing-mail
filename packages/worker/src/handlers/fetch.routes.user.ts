import type { Env } from "../env";
import { json, text } from "../http";
import { hashPassword, verifyPassword } from "../auth";
import * as S from "./fetch.shared";

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

    const row = await env.DB.prepare("SELECT address FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ address: string }>();
    return json({ address: row?.address || null });
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
    const cur = S.decodeCursor(url.searchParams.get("cursor"));
    let res: D1Result<{
      id: string;
      status: "PENDING" | "SUCCESS" | "FAILED";
      from_name: string | null;
      from_address: string | null;
      subject: string | null;
      snippet: string | null;
      received_at: number;
      ai_code?: string | null;
      ai_service?: string | null;
    }>;
    if (cur) {
      res = await env.DB.prepare(
        "SELECT id, status, from_name, from_address, subject, snippet, received_at, ai_code, ai_service FROM messages WHERE mailbox_id = ?1 AND (received_at < ?3 OR (received_at = ?3 AND id < ?4)) ORDER BY received_at DESC, id DESC LIMIT ?2",
      )
        .bind(mailbox.id, limit, cur.receivedAt, cur.id)
        .all();
    } else {
      res = await env.DB.prepare(
        "SELECT id, status, from_name, from_address, subject, snippet, received_at, ai_code, ai_service FROM messages WHERE mailbox_id = ?1 ORDER BY received_at DESC, id DESC LIMIT ?2",
      )
        .bind(mailbox.id, limit)
        .all();
    }

    const last = res.results[res.results.length - 1];
    const nextCursor = res.results.length >= limit && last ? S.encodeCursor(last.received_at, last.id) : null;
    return json({
      address: mailbox.address,
      messages: res.results.map((r) => ({
        id: r.id,
        status: r.status,
        fromName: r.from_name,
        fromAddress: r.from_address,
        subject: r.subject,
        snippet: r.snippet,
        receivedAt: r.received_at,
        aiCode: r.ai_code ?? null,
        aiService: r.ai_service ?? null,
      })),
      nextCursor,
    });
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

    const sinceRaw = url.searchParams.get("since") || "0";
    const since = Math.max(Number(sinceRaw) || 0, 0);

    const stat = await env.DB.prepare(
      "SELECT COUNT(1) AS new_count, MAX(received_at) AS latest_new_received_at FROM messages WHERE mailbox_id = ?1 AND received_at > ?2",
    )
      .bind(mailbox.id, since)
      .first<{ new_count: number; latest_new_received_at: number | null }>();

    const latest = await env.DB.prepare("SELECT MAX(received_at) AS latest_received_at FROM messages WHERE mailbox_id = ?1")
      .bind(mailbox.id)
      .first<{ latest_received_at: number | null }>();

    return json(
      {
        address: mailbox.address,
        since,
        newCount: stat?.new_count ?? 0,
        latestReceivedAt: latest?.latest_received_at ?? null,
        latestNewReceivedAt: stat?.latest_new_received_at ?? null,
      },
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

  return null;
}
