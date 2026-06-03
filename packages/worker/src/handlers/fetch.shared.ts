import type { Env } from "../env";
import { json } from "../http";
import { getBearerToken, verifyJwt, type JwtPayload } from "../auth";

export function isDbSchemaError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("no such table:") || msg.includes("no such column:");
}

export async function readJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function toUsername(body: unknown) {
  const username =
    typeof body === "object" && body && "username" in body && typeof (body as any).username === "string"
      ? (body as any).username.trim()
      : "";
  return username;
}

export function toPassword(body: unknown) {
  const password =
    typeof body === "object" && body && "password" in body && typeof (body as any).password === "string"
      ? (body as any).password
      : "";
  return password;
}

export function isValidUsername(username: string) {
  return /^[a-zA-Z0-9_]{3,32}$/.test(username);
}

export function getJwtSecretCurrent(env: Env) {
  const v = typeof env.JWT_SECRET_CURRENT === "string" ? env.JWT_SECRET_CURRENT.trim() : "";
  if (v) return v;
  const legacy = typeof env.JWT_SECRET === "string" ? env.JWT_SECRET.trim() : "";
  return legacy || null;
}

export function getJwtSecretPrevious(env: Env) {
  const v = typeof env.JWT_SECRET_PREVIOUS === "string" ? env.JWT_SECRET_PREVIOUS.trim() : "";
  return v || null;
}

export function hasJwtSecret(env: Env) {
  return Boolean(getJwtSecretCurrent(env));
}

export async function verifyJwtRotating(token: string, env: Env) {
  const current = getJwtSecretCurrent(env);
  if (!current) return null;
  const payload = await verifyJwt(token, current);
  if (payload) return payload;
  const prev = getJwtSecretPrevious(env);
  if (!prev) return null;
  const prevPayload = await verifyJwt(token, prev);
  if (!prevPayload) return null;
  const now = Math.floor(Date.now() / 1000);
  const maxExp = now + 14 * 24 * 60 * 60;
  if (prevPayload.exp > maxExp) return null;
  return prevPayload;
}

export const SESSION_COOKIE = "bingmail_session";

export function getCookieValue(request: Request, name: string) {
  const raw = request.headers.get("cookie") || "";
  if (!raw) return null;
  const parts = raw.split(";");
  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim();
    if (k !== name) continue;
    const v = p.slice(eq + 1).trim();
    return v ? decodeURIComponent(v) : null;
  }
  return null;
}

export function getSessionTokenFromCookie(request: Request) {
  return getCookieValue(request, SESSION_COOKIE);
}

export function makeSessionCookie(token: string, maxAgeSec: number, secure: boolean) {
  const base = `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(
    Math.floor(maxAgeSec || 0),
    0,
  )}`;
  return secure ? `${base}; Secure` : base;
}

export function clearSessionCookie(secure: boolean) {
  const base = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  return secure ? `${base}; Secure` : base;
}

export function parseTurnstileMode(raw: string) {
  const v = (raw || "").trim().toLowerCase();
  if (v === "always" || v === "on_failure" || v === "off") return v;
  return null;
}

export async function getSetting(env: Env, key: string) {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?1 LIMIT 1")
    .bind(key)
    .first<{ value: string }>();
  return typeof row?.value === "string" ? row.value : null;
}

export async function setSetting(env: Env, key: string, value: string) {
  await env.DB.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(key, value, Date.now())
    .run();
}

export async function getTurnstileConfig(env: Env) {
  const modeFromDb = parseTurnstileMode((await getSetting(env, "turnstile_mode")) || "");
  const modeFromEnv = parseTurnstileMode(typeof env.TURNSTILE_MODE === "string" ? env.TURNSTILE_MODE : "");
  const mode = modeFromDb ?? modeFromEnv ?? "off";

  const siteKeyFromDb = ((await getSetting(env, "turnstile_site_key")) || "").trim();
  const siteKeyFromEnv = (typeof env.TURNSTILE_SITE_KEY === "string" ? env.TURNSTILE_SITE_KEY : "").trim();
  const siteKey = siteKeyFromDb || siteKeyFromEnv || "";

  const secretFromDb = ((await getSetting(env, "turnstile_secret")) || "").trim();
  const secretFromEnv = (typeof env.TURNSTILE_SECRET === "string" ? env.TURNSTILE_SECRET : "").trim();
  const secret = secretFromDb || secretFromEnv || "";

  return { mode, siteKey, secret, hasSecret: Boolean(secret) };
}

export function getTurnstileToken(body: unknown) {
  const v =
    typeof body === "object" && body && "turnstileToken" in body && typeof (body as any).turnstileToken === "string"
      ? (body as any).turnstileToken.trim()
      : "";
  return v || null;
}

export function getClientIp(request: Request) {
  const cf = (request.headers.get("cf-connecting-ip") || "").trim();
  if (cf) return cf;
  const xff = (request.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || "";
  return xff || null;
}

export function encodeCursor(receivedAt: number, id: string) {
  return btoa(`${receivedAt}:${id}`);
}

export function decodeCursor(cursor: string | null) {
  const raw = (cursor || "").trim();
  if (!raw) return null;
  let decoded = "";
  try {
    decoded = atob(raw);
  } catch {
    return null;
  }
  const idx = decoded.indexOf(":");
  if (idx <= 0) return null;
  const tsRaw = decoded.slice(0, idx);
  const id = decoded.slice(idx + 1).trim();
  const receivedAt = Number(tsRaw);
  if (!Number.isFinite(receivedAt) || receivedAt <= 0) return null;
  if (!id) return null;
  return { receivedAt, id };
}

export async function verifyTurnstile(secret: string, token: string, ip: string | null) {
  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { success?: unknown };
  return data?.success === true;
}

export async function requireTurnstileToken(
  request: Request,
  secret: string,
  body: unknown,
  required: boolean,
): Promise<Response | null> {
  const s = (secret || "").trim();
  if (!s) return json({ error: "server_misconfigured" }, { status: 500 });
  const token = getTurnstileToken(body);
  if (!token) {
    if (!required) return null;
    return json({ error: "turnstile_required" }, { status: 400 });
  }
  const ok = await verifyTurnstile(s, token, getClientIp(request));
  if (!ok) return json({ error: "turnstile_failed" }, { status: 403 });
  return null;
}

export function rateKeyUser(username: string) {
  return `u:${username.trim().toLowerCase()}`;
}

export function rateKeyIp(ip: string) {
  return `ip:${ip.trim()}`;
}

export async function authRateFail(env: Env, key: string) {
  try {
    const id = env.AUTH_RATE.idFromName(key);
    const stub = env.AUTH_RATE.get(id);
    await stub.fetch("https://auth-rate/fail", { method: "POST" });
  } catch {}
}

export async function authRateReset(env: Env, key: string) {
  try {
    const id = env.AUTH_RATE.idFromName(key);
    const stub = env.AUTH_RATE.get(id);
    await stub.fetch("https://auth-rate/reset", { method: "POST" });
  } catch {}
}

export function normalizeDomain(input: string) {
  return (input || "").trim().toLowerCase();
}

export function isValidDomain(domain: string) {
  if (!domain) return false;
  if (domain.length > 253) return false;
  if (domain.includes("..")) return false;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain);
}

export function normalizeLocalPart(input: string) {
  return (input || "").trim();
}

export function isValidLocalPart(local: string) {
  if (!local) return false;
  if (local.length > 64) return false;
  return /^[a-zA-Z0-9._+-]+$/.test(local);
}

export function makeEmailAddress(local: string, domain: string) {
  const l = normalizeLocalPart(local);
  const d = normalizeDomain(domain);
  return `${l}@${d}`.toLowerCase();
}

export function parseSettingInt(raw: string | null, fallback: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i <= 0) return fallback;
  return i;
}

export async function getMaxAliases(env: Env) {
  return parseSettingInt(await getSetting(env, "max_aliases"), 3);
}

export async function isInitialized(env: Env) {
  const row = await env.DB.prepare("SELECT 1 AS ok FROM users WHERE is_admin = 1 LIMIT 1").first<{ ok: 1 }>();
  return Boolean(row?.ok);
}

export async function listActiveDomains(env: Env) {
  const res = await env.DB.prepare("SELECT domain FROM domains WHERE is_active = 1 ORDER BY domain ASC").all<{
    domain: string;
  }>();
  return res.results.map((r) => r.domain).filter((d) => typeof d === "string" && d.length > 0);
}

export async function requireActiveDomain(env: Env, domain: string) {
  const d = normalizeDomain(domain);
  if (!isValidDomain(d)) return null;
  const row = await env.DB.prepare("SELECT 1 AS ok FROM domains WHERE domain = ?1 AND is_active = 1 LIMIT 1")
    .bind(d)
    .first<{ ok: 1 }>();
  return row?.ok ? d : null;
}

export async function getMailboxAuth(env: Env, address: string) {
  const mailbox = await env.DB.prepare("SELECT id, user_id, address FROM mailboxes WHERE address = ?1 AND is_active = 1 LIMIT 1")
    .bind(address)
    .first<{ id: string; user_id: string | null; address: string }>();
  if (mailbox?.id) return mailbox;

  const alias = await env.DB.prepare(
    "SELECT m.id, m.user_id, m.address FROM mailbox_aliases a JOIN mailboxes m ON m.id = a.mailbox_id WHERE a.address = ?1 AND a.is_active = 1 AND m.is_active = 1 LIMIT 1",
  )
    .bind(address)
    .first<{ id: string; user_id: string | null; address: string }>();
  return alias?.id ? alias : null;
}

export async function requireMailboxAccess(env: Env, auth: { sub: string; isAdmin?: boolean }, address: string) {
  const mailbox = await getMailboxAuth(env, address);
  if (!mailbox?.id) return null;
  if (auth.isAdmin) return mailbox;
  if (!mailbox.user_id) return null;
  if (mailbox.user_id !== auth.sub) return null;
  return mailbox;
}

export async function requireMessageAccess(env: Env, auth: { sub: string; isAdmin?: boolean }, messageId: string) {
  const row = await env.DB.prepare(
    "SELECT m.id, m.mailbox_id, m.status, m.from_name, m.from_address, m.subject, m.snippet, m.received_at, m.parsed_at, m.html_r2_key, m.html_inline, m.ai_code, m.ai_service, mb.user_id AS mailbox_user_id FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id WHERE m.id = ?1 LIMIT 1",
  )
    .bind(messageId)
    .first<{
      mailbox_user_id: string | null;
    } & Record<string, any>>();
  if (!row?.id) return null;
  if (!auth.isAdmin) {
    if (!row.mailbox_user_id) return null;
    if (row.mailbox_user_id !== auth.sub) return null;
  }
  return row;
}

export async function requireAuth(request: Request, env: Env) {
  if (!hasJwtSecret(env)) return null;
  const token = getBearerToken(request) || getSessionTokenFromCookie(request);
  if (!token) return null;
  const payload = await verifyJwtRotating(token, env);
  if (!payload) return null;
  return payload;
}

export async function requireAuthWs(request: Request, env: Env) {
  if (!hasJwtSecret(env)) return null;
  const url = new URL(request.url);
  const token =
    getBearerToken(request) || getSessionTokenFromCookie(request) || (url.searchParams.get("token") || "").trim();
  if (!token) return null;
  const payload = await verifyJwtRotating(token, env);
  if (!payload) return null;
  return payload;
}

export async function requireAuthOr401(request: Request, env: Env): Promise<JwtPayload | Response> {
  const auth = await requireAuth(request, env);
  if (!auth) return json({ error: "unauthorized" }, { status: 401 });
  return auth;
}

export async function requireAdminOr403(request: Request, env: Env): Promise<JwtPayload | Response> {
  const auth = await requireAuth(request, env);
  if (!auth) return json({ error: "unauthorized" }, { status: 401 });
  if (!auth.isAdmin) return json({ error: "forbidden" }, { status: 403 });
  return auth;
}

export async function requireAuthWsOr401(request: Request, env: Env): Promise<JwtPayload | Response> {
  const auth = await requireAuthWs(request, env);
  if (!auth) return json({ error: "unauthorized" }, { status: 401 });
  return auth;
}
