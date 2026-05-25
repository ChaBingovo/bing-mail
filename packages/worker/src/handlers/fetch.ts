import type { Env } from "../env";
import { json, text } from "../http";
import { getBearerToken, hashPassword, signJwt, verifyJwt, verifyPassword } from "../auth";

function isMissingAiColumnsError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("no such column: ai_code") || msg.includes("no such column: ai_service");
}

async function readJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function toUsername(body: unknown) {
  const username =
    typeof body === "object" && body && "username" in body && typeof (body as any).username === "string"
      ? (body as any).username.trim()
      : "";
  return username;
}

function toPassword(body: unknown) {
  const password =
    typeof body === "object" && body && "password" in body && typeof (body as any).password === "string"
      ? (body as any).password
      : "";
  return password;
}

function isValidUsername(username: string) {
  return /^[a-zA-Z0-9_]{3,32}$/.test(username);
}

function hasJwtSecret(env: Env) {
  return typeof env.JWT_SECRET === "string" && env.JWT_SECRET.length > 0;
}

async function requireAuth(request: Request, env: Env) {
  if (!hasJwtSecret(env)) return null;
  const token = getBearerToken(request);
  if (!token) return null;
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) return null;
  return payload;
}

export async function handleFetch(request: Request, env: Env) {
  if (request.method === "OPTIONS") return text("", { status: 204 });

  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === "/api/auth/register" && request.method === "POST") {
    if (!hasJwtSecret(env)) return json({ error: "server_misconfigured" }, { status: 500 });
    const body = await readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });

    const username = toUsername(body);
    const password = toPassword(body);
    if (!isValidUsername(username)) return json({ error: "invalid_username" }, { status: 400 });
    if (typeof password !== "string" || password.length < 8 || password.length > 72) {
      return json({ error: "invalid_password" }, { status: 400 });
    }

    const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?1 LIMIT 1")
      .bind(username)
      .first<{ id: string }>();
    if (existing?.id) return json({ error: "username_taken" }, { status: 409 });

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    await env.DB.prepare("INSERT INTO users (id, username, password_hash) VALUES (?1, ?2, ?3)")
      .bind(id, username, passwordHash)
      .run();

    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const token = await signJwt({ sub: id, username, exp }, env.JWT_SECRET);
    return json({ user: { id, username }, token }, { status: 201 });
  }

  if (pathname === "/api/auth/login" && request.method === "POST") {
    if (!hasJwtSecret(env)) return json({ error: "server_misconfigured" }, { status: 500 });
    const body = await readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });

    const username = toUsername(body);
    const password = toPassword(body);
    if (!isValidUsername(username)) return json({ error: "invalid_username" }, { status: 400 });
    if (typeof password !== "string" || password.length < 1) return json({ error: "invalid_password" }, { status: 400 });

    const user = await env.DB.prepare("SELECT id, password_hash FROM users WHERE username = ?1 LIMIT 1")
      .bind(username)
      .first<{ id: string; password_hash: string }>();
    if (!user?.id) return json({ error: "unauthorized" }, { status: 401 });
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return json({ error: "unauthorized" }, { status: 401 });

    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const token = await signJwt({ sub: user.id, username, exp }, env.JWT_SECRET);
    return json({ user: { id: user.id, username }, token });
  }

  if (pathname === "/api/user/mailboxes" && request.method === "GET") {
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "unauthorized" }, { status: 401 });

    const res = await env.DB.prepare(
      "SELECT address FROM mailboxes WHERE user_id = ?1 AND is_active = 1 ORDER BY created_at DESC",
    )
      .bind(auth.sub)
      .all<{ address: string }>();
    return json({ mailboxes: res.results.map((r) => r.address) });
  }

  if (pathname === "/api/user/mailboxes" && request.method === "POST") {
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "unauthorized" }, { status: 401 });

    const body = await readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const address =
      typeof body === "object" && body && "address" in body && typeof (body as any).address === "string"
        ? (body as any).address.trim().toLowerCase()
        : "";
    if (!address || !address.includes("@")) return json({ error: "invalid_address" }, { status: 400 });

    const existing = await env.DB.prepare("SELECT id, user_id FROM mailboxes WHERE address = ?1 AND is_active = 1 LIMIT 1")
      .bind(address)
      .first<{ id: string; user_id: string | null }>();
    if (existing?.id) {
      if (existing.user_id && existing.user_id !== auth.sub) return json({ error: "address_taken" }, { status: 409 });
      if (!existing.user_id) {
        await env.DB.prepare("UPDATE mailboxes SET user_id = ?1 WHERE id = ?2").bind(auth.sub, existing.id).run();
      }
      return json({ mailbox: { id: existing.id, address } }, { status: 200 });
    }

    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO mailboxes (id, user_id, address, is_active) VALUES (?1, ?2, ?3, 1)")
      .bind(id, auth.sub, address)
      .run();
    return json({ mailbox: { id, address } }, { status: 201 });
  }

  const userMailboxUnbindMatch = pathname.match(/^\/api\/user\/mailboxes\/([^/]+)$/);
  if (userMailboxUnbindMatch && request.method === "DELETE") {
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "unauthorized" }, { status: 401 });

    const address = decodeURIComponent(userMailboxUnbindMatch[1]).trim().toLowerCase();
    if (!address || !address.includes("@")) return json({ error: "invalid_address" }, { status: 400 });

    const row = await env.DB.prepare("SELECT id FROM mailboxes WHERE address = ?1 AND user_id = ?2 AND is_active = 1 LIMIT 1")
      .bind(address, auth.sub)
      .first<{ id: string }>();
    if (!row?.id) return json({ error: "mailbox_not_found" }, { status: 404 });

    await env.DB.prepare("UPDATE mailboxes SET user_id = NULL WHERE id = ?1").bind(row.id).run();
    return text("", { status: 204 });
  }

  const wsMailboxMatch = pathname.match(/^\/api\/ws\/mailboxes\/([^/]+)$/);
  if (wsMailboxMatch && request.method === "GET") {
    const address = decodeURIComponent(wsMailboxMatch[1]).trim().toLowerCase();
    const mailbox = await env.DB.prepare(
      "SELECT id FROM mailboxes WHERE address = ?1 AND is_active = 1 LIMIT 1",
    )
      .bind(address)
      .first<{ id: string }>();
    if (!mailbox?.id) return json({ error: "mailbox_not_found" }, { status: 404 });

    const id = env.MAIL_EVENTS.idFromName(address);
    const stub = env.MAIL_EVENTS.get(id);
    const doReq = new Request("https://mail-events/connect", request);
    return stub.fetch(doReq);
  }

  if (pathname === "/api/mailboxes" && request.method === "GET") {
    const res = await env.DB.prepare("SELECT address FROM mailboxes WHERE is_active = 1 ORDER BY address ASC")
      .all<{ address: string }>();
    return json({ mailboxes: res.results.map((r) => r.address) });
  }

  if (pathname === "/api/mailboxes" && request.method === "POST") {
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "unauthorized" }, { status: 401 });

    const body = await readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });

    const address =
      typeof body === "object" && body && "address" in body && typeof (body as any).address === "string"
        ? (body as any).address.trim().toLowerCase()
        : "";
    if (!address || !address.includes("@")) return json({ error: "invalid_address" }, { status: 400 });

    const existing = await env.DB.prepare(
      "SELECT id, user_id FROM mailboxes WHERE address = ?1 AND is_active = 1 LIMIT 1",
    )
      .bind(address)
      .first<{ id: string; user_id: string | null }>();
    if (existing?.id) {
      if (existing.user_id && existing.user_id !== auth.sub) return json({ error: "address_taken" }, { status: 409 });
      if (!existing.user_id) {
        await env.DB.prepare("UPDATE mailboxes SET user_id = ?1 WHERE id = ?2").bind(auth.sub, existing.id).run();
      }
      return json({ mailbox: { id: existing.id, address } }, { status: 200 });
    }

    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO mailboxes (id, user_id, address, is_active) VALUES (?1, ?2, ?3, 1)")
      .bind(id, auth.sub, address)
      .run();

    return json({ mailbox: { id, address } }, { status: 201 });
  }

  const mailboxMatch = pathname.match(/^\/api\/mailboxes\/([^/]+)\/messages$/);
  if (mailboxMatch && request.method === "GET") {
    const address = decodeURIComponent(mailboxMatch[1]).trim().toLowerCase();
    const mailbox = await env.DB.prepare(
      "SELECT id FROM mailboxes WHERE address = ?1 AND is_active = 1 LIMIT 1",
    )
      .bind(address)
      .first<{ id: string }>();
    if (!mailbox?.id) return json({ error: "mailbox_not_found" }, { status: 404 });

    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "50"), 1), 200);
    let res: D1Result<{
      id: string;
      status: "PENDING" | "SUCCESS";
      from_name: string | null;
      from_address: string | null;
      subject: string | null;
      snippet: string | null;
      received_at: number;
      ai_code?: string | null;
      ai_service?: string | null;
    }>;
    try {
      res = await env.DB.prepare(
        "SELECT id, status, from_name, from_address, subject, snippet, received_at, ai_code, ai_service FROM messages WHERE mailbox_id = ?1 ORDER BY received_at DESC LIMIT ?2",
      )
        .bind(mailbox.id, limit)
        .all();
    } catch (err) {
      if (!isMissingAiColumnsError(err)) throw err;
      res = await env.DB.prepare(
        "SELECT id, status, from_name, from_address, subject, snippet, received_at FROM messages WHERE mailbox_id = ?1 ORDER BY received_at DESC LIMIT ?2",
      )
        .bind(mailbox.id, limit)
        .all();
    }

    return json({
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
    });
  }

  const redDotMatch = pathname.match(/^\/api\/mailboxes\/([^/]+)\/red-dot$/);
  if (redDotMatch && request.method === "GET") {
    const address = decodeURIComponent(redDotMatch[1]).trim().toLowerCase();
    const mailbox = await env.DB.prepare(
      "SELECT id FROM mailboxes WHERE address = ?1 AND is_active = 1 LIMIT 1",
    )
      .bind(address)
      .first<{ id: string }>();
    if (!mailbox?.id) return json({ error: "mailbox_not_found" }, { status: 404 });

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
        address,
        since,
        newCount: stat?.new_count ?? 0,
        latestReceivedAt: latest?.latest_received_at ?? null,
        latestNewReceivedAt: stat?.latest_new_received_at ?? null,
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  }

  const msgMetaMatch = pathname.match(/^\/api\/messages\/([^/]+)$/);
  if (msgMetaMatch && request.method === "GET") {
    const id = decodeURIComponent(msgMetaMatch[1]);
    let row: {
      id: string;
      mailbox_id: string;
      status: "PENDING" | "SUCCESS";
      from_name: string | null;
      from_address: string | null;
      subject: string | null;
      snippet: string | null;
      received_at: number;
      parsed_at: number | null;
      html_r2_key: string | null;
      html_inline: string | null;
      ai_code?: string | null;
      ai_service?: string | null;
    } | null;
    try {
      row = await env.DB.prepare(
        "SELECT id, mailbox_id, status, from_name, from_address, subject, snippet, received_at, parsed_at, html_r2_key, html_inline, ai_code, ai_service FROM messages WHERE id = ?1 LIMIT 1",
      )
        .bind(id)
        .first();
    } catch (err) {
      if (!isMissingAiColumnsError(err)) throw err;
      row = await env.DB.prepare(
        "SELECT id, mailbox_id, status, from_name, from_address, subject, snippet, received_at, parsed_at, html_r2_key, html_inline FROM messages WHERE id = ?1 LIMIT 1",
      )
        .bind(id)
        .first();
    }
    if (!row) return json({ error: "message_not_found" }, { status: 404 });

    return json({
      message: {
        id: row.id,
        mailboxId: row.mailbox_id,
        status: row.status,
        fromName: row.from_name,
        fromAddress: row.from_address,
        subject: row.subject,
        snippet: row.snippet,
        receivedAt: row.received_at,
        parsedAt: row.parsed_at,
        hasHtml: Boolean(row.html_inline || row.html_r2_key),
        aiCode: row.ai_code ?? null,
        aiService: row.ai_service ?? null,
      },
    });
  }

  const msgHtmlMatch = pathname.match(/^\/api\/messages\/([^/]+)\/html$/);
  if (msgHtmlMatch && request.method === "GET") {
    const id = decodeURIComponent(msgHtmlMatch[1]);
    const row = await env.DB.prepare("SELECT html_inline, html_r2_key FROM messages WHERE id = ?1 LIMIT 1")
      .bind(id)
      .first<{ html_inline: string | null; html_r2_key: string | null }>();
    if (!row) return text("", { status: 404 });

    if (row.html_inline) {
      return new Response(row.html_inline, {
        headers: {
          "content-type": "text/html; charset=utf-8",
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
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
        },
      });
    }
    return text("", { status: 204 });
  }

  if (pathname === "/api/search" && request.method === "GET") {
    const address = (url.searchParams.get("address") || "").trim().toLowerCase();
    const q = (url.searchParams.get("q") || "").trim();
    if (!address || !q) return json({ error: "missing_params" }, { status: 400 });

    const mailbox = await env.DB.prepare(
      "SELECT id FROM mailboxes WHERE address = ?1 AND is_active = 1 LIMIT 1",
    )
      .bind(address)
      .first<{ id: string }>();
    if (!mailbox?.id) return json({ error: "mailbox_not_found" }, { status: 404 });

    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "50"), 1), 200);
    let fts: D1Result<{
      id: string;
      subject: string | null;
      from_name: string | null;
      from_address: string | null;
      snippet: string | null;
      received_at: number;
      ai_code?: string | null;
      ai_service?: string | null;
    }>;
    try {
      fts = await env.DB.prepare(
        "SELECT m.id, m.subject, m.from_name, m.from_address, m.snippet, m.received_at, m.ai_code, m.ai_service FROM messages_fts f JOIN messages m ON m.id = f.message_id WHERE f.messages_fts MATCH ?1 AND m.mailbox_id = ?2 ORDER BY m.received_at DESC LIMIT ?3",
      )
        .bind(q, mailbox.id, limit)
        .all();
    } catch (err) {
      if (!isMissingAiColumnsError(err)) throw err;
      fts = await env.DB.prepare(
        "SELECT m.id, m.subject, m.from_name, m.from_address, m.snippet, m.received_at FROM messages_fts f JOIN messages m ON m.id = f.message_id WHERE f.messages_fts MATCH ?1 AND m.mailbox_id = ?2 ORDER BY m.received_at DESC LIMIT ?3",
      )
        .bind(q, mailbox.id, limit)
        .all();
    }

    return json({
      messages: fts.results.map((r) => ({
        id: r.id,
        subject: r.subject,
        fromName: r.from_name,
        fromAddress: r.from_address,
        snippet: r.snippet,
        receivedAt: r.received_at,
        aiCode: r.ai_code ?? null,
        aiService: r.ai_service ?? null,
      })),
    });
  }

  return json({ error: "not_found" }, { status: 404 });
}
