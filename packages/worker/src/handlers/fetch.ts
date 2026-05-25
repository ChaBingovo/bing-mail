import type { Env } from "../env";
import { json, text } from "../http";

export async function handleFetch(request: Request, env: Env) {
  if (request.method === "OPTIONS") return text("", { status: 204 });

  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === "/api/mailboxes" && request.method === "GET") {
    const res = await env.DB.prepare("SELECT address FROM mailboxes WHERE is_active = 1 ORDER BY address ASC")
      .all<{ address: string }>();
    return json({ mailboxes: res.results.map((r) => r.address) });
  }

  if (pathname === "/api/mailboxes" && request.method === "POST") {
    const token = getToken(request);
    if (!token) return json({ error: "unauthorized" }, { status: 401 });

    const user = await env.DB.prepare("SELECT id FROM users WHERE api_token = ?1 LIMIT 1")
      .bind(token)
      .first<{ id: string }>();
    if (!user?.id) return json({ error: "unauthorized" }, { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_json" }, { status: 400 });
    }

    const address =
      typeof body === "object" && body && "address" in body && typeof (body as any).address === "string"
        ? (body as any).address.trim().toLowerCase()
        : "";
    if (!address || !address.includes("@")) return json({ error: "invalid_address" }, { status: 400 });

    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO mailboxes (id, user_id, address, is_active) VALUES (?1, ?2, ?3, 1)")
      .bind(id, user.id, address)
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
    const res = await env.DB.prepare(
      "SELECT id, status, from_name, from_address, subject, snippet, received_at FROM messages WHERE mailbox_id = ?1 ORDER BY received_at DESC LIMIT ?2",
    )
      .bind(mailbox.id, limit)
      .all<{
        id: string;
        status: "PENDING" | "SUCCESS";
        from_name: string | null;
        from_address: string | null;
        subject: string | null;
        snippet: string | null;
        received_at: number;
      }>();

    return json({
      messages: res.results.map((r) => ({
        id: r.id,
        status: r.status,
        fromName: r.from_name,
        fromAddress: r.from_address,
        subject: r.subject,
        snippet: r.snippet,
        receivedAt: r.received_at,
      })),
    });
  }

  const msgMetaMatch = pathname.match(/^\/api\/messages\/([^/]+)$/);
  if (msgMetaMatch && request.method === "GET") {
    const id = decodeURIComponent(msgMetaMatch[1]);
    const row = await env.DB.prepare(
      "SELECT id, mailbox_id, status, from_name, from_address, subject, snippet, received_at, parsed_at, html_r2_key, html_inline FROM messages WHERE id = ?1 LIMIT 1",
    )
      .bind(id)
      .first<{
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
      }>();
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
    const fts = await env.DB.prepare(
      "SELECT m.id, m.subject, m.from_name, m.from_address, m.snippet, m.received_at FROM messages_fts f JOIN messages m ON m.id = f.message_id WHERE f.messages_fts MATCH ?1 AND m.mailbox_id = ?2 ORDER BY m.received_at DESC LIMIT ?3",
    )
      .bind(q, mailbox.id, limit)
      .all<{
        id: string;
        subject: string | null;
        from_name: string | null;
        from_address: string | null;
        snippet: string | null;
        received_at: number;
      }>();

    return json({
      messages: fts.results.map((r) => ({
        id: r.id,
        subject: r.subject,
        fromName: r.from_name,
        fromAddress: r.from_address,
        snippet: r.snippet,
        receivedAt: r.received_at,
      })),
    });
  }

  return json({ error: "not_found" }, { status: 404 });
}

function getToken(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) return m[1].trim();
  }
  const direct = request.headers.get("x-api-token");
  if (direct) return direct.trim();
  return null;
}
