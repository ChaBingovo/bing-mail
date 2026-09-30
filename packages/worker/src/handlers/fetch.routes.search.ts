import type { Env } from "../env";
import { json } from "../http";
import { logWarn } from "../log";
import * as S from "./fetch.shared";

type SearchRow = {
  id: string;
  subject: string | null;
  from_name: string | null;
  from_address: string | null;
  snippet: string | null;
  received_at: number;
  ai_code?: string | null;
  ai_service?: string | null;
};

export async function handleSearchRoutes(request: Request, env: Env, url: URL, pathname: string): Promise<Response | null> {
  if (pathname === "/api/search" && request.method === "GET") {
    const authRes = await S.requireAuthOr401(request, env);
    if (authRes instanceof Response) return authRes;
    const auth = authRes;
    const address = (url.searchParams.get("address") || "").trim().toLowerCase();
    const q = (url.searchParams.get("q") || "").trim();
    if (!address || !q) return json({ error: "missing_params" }, { status: 400 });

    const mailbox = await S.requireMailboxAccess(env, auth, address);
    if (!mailbox?.id) return json({ error: "mailbox_not_found" }, { status: 404 });

    // FTS5 syntax characters are neutralised here, so raw input cannot 500 the route.
    const match = S.toFtsMatch(q);
    if (!match) return json({ error: "invalid_query" }, { status: 400 });

    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "50"), 1), 200);
    const cur = S.decodeCursor(url.searchParams.get("cursor"));

    let fts: D1Result<SearchRow>;
    try {
      if (cur) {
        fts = await env.DB.prepare(
          "SELECT m.id, m.subject, m.from_name, m.from_address, m.snippet, m.received_at, m.ai_code, m.ai_service FROM messages_fts f JOIN messages m ON m.id = f.message_id WHERE f.messages_fts MATCH ?1 AND m.mailbox_id = ?2 AND (m.received_at < ?4 OR (m.received_at = ?4 AND m.id < ?5)) ORDER BY m.received_at DESC, m.id DESC LIMIT ?3",
        )
          .bind(match, mailbox.id, limit, cur.receivedAt, cur.id)
          .all();
      } else {
        fts = await env.DB.prepare(
          "SELECT m.id, m.subject, m.from_name, m.from_address, m.snippet, m.received_at, m.ai_code, m.ai_service FROM messages_fts f JOIN messages m ON m.id = f.message_id WHERE f.messages_fts MATCH ?1 AND m.mailbox_id = ?2 ORDER BY m.received_at DESC, m.id DESC LIMIT ?3",
        )
          .bind(match, mailbox.id, limit)
          .all();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn({ event: "search_query_failed", error: message });
      return json({ error: "invalid_query" }, { status: 400 });
    }

    const last = fts.results[fts.results.length - 1];
    const nextCursor = fts.results.length >= limit && last ? S.encodeCursor(last.received_at, last.id) : null;
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
      nextCursor,
    });
  }

  return null;
}
