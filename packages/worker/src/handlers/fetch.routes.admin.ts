import type { Env } from "../env";
import { json, text } from "../http";
import { hashPassword } from "../auth";
import * as S from "./fetch.shared";

export async function handleAdminRoutes(request: Request, env: Env, pathname: string): Promise<Response | null> {
  if (pathname === "/api/admin/settings" && request.method === "GET") {
    const authRes = await S.requireAdminOr403(request, env);
    if (authRes instanceof Response) return authRes;
    const allowRegister = (await S.getSetting(env, "allow_register")) === "1";
    const maxAliases = await S.getMaxAliases(env);
    return json({ allowRegister, maxAliases });
  }

  if (pathname === "/api/admin/settings" && request.method === "PUT") {
    const authRes = await S.requireAdminOr403(request, env);
    if (authRes instanceof Response) return authRes;
    const body = await S.readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const allowRegister =
      typeof body === "object" && body && "allowRegister" in body && typeof (body as any).allowRegister === "boolean"
        ? (body as any).allowRegister
        : null;
    const maxAliases =
      typeof body === "object" && body && "maxAliases" in body && typeof (body as any).maxAliases === "number"
        ? Math.floor((body as any).maxAliases)
        : null;
    if (allowRegister === null && maxAliases === null) return json({ error: "invalid_payload" }, { status: 400 });
    if (maxAliases !== null && (!Number.isFinite(maxAliases) || maxAliases < 0 || maxAliases > 50)) {
      return json({ error: "invalid_max_aliases" }, { status: 400 });
    }

    const now = Date.now();
    if (typeof allowRegister === "boolean") {
      await env.DB.prepare(
        "INSERT INTO app_settings (key, value, updated_at) VALUES ('allow_register', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
        .bind(allowRegister ? "1" : "0", now)
        .run();
    }
    if (typeof maxAliases === "number") {
      await env.DB.prepare(
        "INSERT INTO app_settings (key, value, updated_at) VALUES ('max_aliases', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
        .bind(String(maxAliases), now)
        .run();
    }
    const nextAllowRegister = (await S.getSetting(env, "allow_register")) === "1";
    const nextMaxAliases = await S.getMaxAliases(env);
    return json({ allowRegister: nextAllowRegister, maxAliases: nextMaxAliases });
  }

  if (pathname === "/api/admin/turnstile" && request.method === "GET") {
    const authRes = await S.requireAdminOr403(request, env);
    if (authRes instanceof Response) return authRes;
    const cfg = await S.getTurnstileConfig(env);
    return json({ mode: cfg.mode, siteKey: cfg.siteKey, hasSecret: cfg.hasSecret });
  }

  if (pathname === "/api/admin/turnstile" && request.method === "PUT") {
    const authRes = await S.requireAdminOr403(request, env);
    if (authRes instanceof Response) return authRes;
    const body = await S.readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });

    const current = await S.getTurnstileConfig(env);

    const modeRaw =
      typeof body === "object" && body && "mode" in body && typeof (body as any).mode === "string"
        ? (body as any).mode
        : null;
    const mode = typeof modeRaw === "string" ? S.parseTurnstileMode(modeRaw) : null;
    const siteKey =
      typeof body === "object" && body && "siteKey" in body && typeof (body as any).siteKey === "string"
        ? (body as any).siteKey.trim()
        : null;
    const secret =
      typeof body === "object" && body && "secret" in body && typeof (body as any).secret === "string"
        ? (body as any).secret.trim()
        : null;
    if (modeRaw !== null && mode === null) return json({ error: "invalid_payload" }, { status: 400 });
    if (mode === null && siteKey === null && secret === null) return json({ error: "invalid_payload" }, { status: 400 });

    const nextMode = mode ?? current.mode;
    const nextSiteKey = siteKey ?? current.siteKey;
    const nextSecret = secret ?? current.secret;
    if (nextMode !== "off") {
      if (!nextSiteKey) return json({ error: "turnstile_site_key_required" }, { status: 400 });
      if (!nextSecret) return json({ error: "turnstile_secret_required" }, { status: 400 });
    }

    if (mode !== null) await S.setSetting(env, "turnstile_mode", mode);
    if (siteKey !== null) await S.setSetting(env, "turnstile_site_key", siteKey);
    if (secret !== null) await S.setSetting(env, "turnstile_secret", secret);

    const cfg = await S.getTurnstileConfig(env);
    return json({ mode: cfg.mode, siteKey: cfg.siteKey, hasSecret: cfg.hasSecret });
  }

  if (pathname === "/api/admin/domains" && request.method === "GET") {
    const authRes = await S.requireAdminOr403(request, env);
    if (authRes instanceof Response) return authRes;
    const res = await env.DB.prepare("SELECT id, domain, is_active, created_at FROM domains ORDER BY domain ASC").all<{
      id: string;
      domain: string;
      is_active: number;
      created_at: number;
    }>();
    return json({
      domains: res.results.map((r) => ({
        id: r.id,
        domain: r.domain,
        isActive: Boolean(r.is_active),
        createdAt: r.created_at,
      })),
    });
  }

  if (pathname === "/api/admin/domains" && request.method === "POST") {
    const authRes = await S.requireAdminOr403(request, env);
    if (authRes instanceof Response) return authRes;
    const body = await S.readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const domain =
      typeof body === "object" && body && "domain" in body && typeof (body as any).domain === "string"
        ? (body as any).domain.trim().toLowerCase()
        : "";
    if (!domain || !domain.includes(".")) return json({ error: "invalid_domain" }, { status: 400 });
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO domains (id, domain, is_active) VALUES (?1, ?2, 1)").bind(id, domain).run();
    return json({ domain: { id, domain, isActive: true } }, { status: 201 });
  }

  const adminDomainDeleteMatch = pathname.match(/^\/api\/admin\/domains\/([^/]+)$/);
  if (adminDomainDeleteMatch && request.method === "DELETE") {
    const authRes = await S.requireAdminOr403(request, env);
    if (authRes instanceof Response) return authRes;
    const domain = decodeURIComponent(adminDomainDeleteMatch[1]).trim().toLowerCase();
    if (!domain) return json({ error: "invalid_domain" }, { status: 400 });
    await env.DB.prepare("DELETE FROM domains WHERE domain = ?1").bind(domain).run();
    return text("", { status: 204 });
  }

  if (pathname === "/api/admin/users" && request.method === "GET") {
    const authRes = await S.requireAdminOr403(request, env);
    if (authRes instanceof Response) return authRes;
    const res = await env.DB.prepare("SELECT id, username, is_admin, created_at FROM users ORDER BY created_at DESC").all<{
      id: string;
      username: string;
      is_admin: number;
      created_at: number;
    }>();
    return json({
      users: res.results.map((u) => ({
        id: u.id,
        username: u.username,
        isAdmin: Boolean(u.is_admin),
        createdAt: u.created_at,
      })),
    });
  }

  if (pathname === "/api/admin/users" && request.method === "POST") {
    const authRes = await S.requireAdminOr403(request, env);
    if (authRes instanceof Response) return authRes;
    const body = await S.readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const username = S.toUsername(body);
    const password = S.toPassword(body);
    const domain =
      typeof body === "object" && body && "domain" in body && typeof (body as any).domain === "string"
        ? S.normalizeDomain((body as any).domain)
        : "";
    const mailboxLocal =
      typeof body === "object" && body && "mailboxLocal" in body && typeof (body as any).mailboxLocal === "string"
        ? S.normalizeLocalPart((body as any).mailboxLocal)
        : "";
    const isAdmin =
      typeof body === "object" && body && "isAdmin" in body && typeof (body as any).isAdmin === "boolean"
        ? (body as any).isAdmin
        : false;
    if (!S.isValidUsername(username)) return json({ error: "invalid_username" }, { status: 400 });
    if (typeof password !== "string" || password.length < 8 || password.length > 72) {
      return json({ error: "invalid_password" }, { status: 400 });
    }
    if (!domain) return json({ error: "domain_required" }, { status: 400 });
    if (!mailboxLocal) return json({ error: "mailbox_required" }, { status: 400 });
    if (!S.isValidDomain(domain)) return json({ error: "invalid_domain" }, { status: 400 });
    if (!S.isValidLocalPart(mailboxLocal)) return json({ error: "invalid_mailbox_local" }, { status: 400 });
    const allowedDomain = await S.requireActiveDomain(env, domain);
    if (!allowedDomain) return json({ error: "domain_not_allowed" }, { status: 400 });
    const mailboxAddress = S.makeEmailAddress(mailboxLocal, allowedDomain);

    const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?1 LIMIT 1")
      .bind(username)
      .first<{ id: string }>();
    if (existing?.id) return json({ error: "username_taken" }, { status: 409 });
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    await env.DB.prepare("INSERT INTO users (id, username, password_hash, is_admin) VALUES (?1, ?2, ?3, ?4)")
      .bind(id, username, passwordHash, isAdmin ? 1 : 0)
      .run();

    const mailboxExisting = await env.DB.prepare("SELECT id FROM mailboxes WHERE address = ?1 LIMIT 1")
      .bind(mailboxAddress)
      .first<{ id: string }>();
    if (mailboxExisting?.id) return json({ error: "mailbox_taken" }, { status: 409 });
    const mailboxId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO mailboxes (id, user_id, address, is_active) VALUES (?1, ?2, ?3, 1)")
      .bind(mailboxId, id, mailboxAddress)
      .run();

    return json({ user: { id, username, isAdmin }, mailbox: { address: mailboxAddress } }, { status: 201 });
  }

  const adminUserPasswordMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/password$/);
  if (adminUserPasswordMatch && request.method === "PUT") {
    const authRes = await S.requireAdminOr403(request, env);
    if (authRes instanceof Response) return authRes;
    const userId = decodeURIComponent(adminUserPasswordMatch[1]).trim();
    if (!userId) return json({ error: "invalid_user_id" }, { status: 400 });
    const body = await S.readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const password = S.toPassword(body);
    if (typeof password !== "string" || password.length < 8 || password.length > 72) {
      return json({ error: "invalid_password" }, { status: 400 });
    }
    const passwordHash = await hashPassword(password);
    await env.DB.prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2").bind(passwordHash, userId).run();
    return text("", { status: 204 });
  }

  if (pathname === "/api/admin/mailboxes" && request.method === "GET") {
    const authRes = await S.requireAdminOr403(request, env);
    if (authRes instanceof Response) return authRes;
    const res = await env.DB.prepare(
      "SELECT m.address, m.user_id, m.is_active, u.username FROM mailboxes m LEFT JOIN users u ON u.id = m.user_id ORDER BY m.created_at DESC",
    ).all<{ address: string; user_id: string | null; is_active: number; username: string | null }>();
    return json({
      mailboxes: res.results.map((r) => ({
        address: r.address,
        userId: r.user_id,
        username: r.username,
        isActive: Boolean(r.is_active),
      })),
    });
  }

  if (pathname === "/api/admin/mailboxes" && request.method === "POST") {
    const authRes = await S.requireAdminOr403(request, env);
    if (authRes instanceof Response) return authRes;
    const body = await S.readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const domain =
      typeof body === "object" && body && "domain" in body && typeof (body as any).domain === "string"
        ? S.normalizeDomain((body as any).domain)
        : "";
    const local =
      typeof body === "object" && body && "mailboxLocal" in body && typeof (body as any).mailboxLocal === "string"
        ? S.normalizeLocalPart((body as any).mailboxLocal)
        : "";
    const userId =
      typeof body === "object" && body && "userId" in body && typeof (body as any).userId === "string"
        ? (body as any).userId.trim()
        : "";
    if (!domain) return json({ error: "domain_required" }, { status: 400 });
    if (!local) return json({ error: "mailbox_required" }, { status: 400 });
    if (!S.isValidDomain(domain)) return json({ error: "invalid_domain" }, { status: 400 });
    if (!S.isValidLocalPart(local)) return json({ error: "invalid_mailbox_local" }, { status: 400 });
    const allowedDomain = await S.requireActiveDomain(env, domain);
    if (!allowedDomain) return json({ error: "domain_not_allowed" }, { status: 400 });
    const address = S.makeEmailAddress(local, allowedDomain);
    if (!userId) return json({ error: "invalid_user_id" }, { status: 400 });

    const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?1 LIMIT 1").bind(userId).first<{ id: string }>();
    if (!user?.id) return json({ error: "user_not_found" }, { status: 404 });

    const aliasTaken = await env.DB.prepare("SELECT 1 AS ok FROM mailbox_aliases WHERE address = ?1 AND is_active = 1 LIMIT 1")
      .bind(address)
      .first<{ ok: 1 }>();
    if (aliasTaken?.ok) return json({ error: "address_taken" }, { status: 409 });

    await env.DB.prepare("UPDATE mailboxes SET is_active = 0 WHERE user_id = ?1 AND is_active = 1").bind(userId).run();

    const existing = await env.DB.prepare("SELECT id, user_id FROM mailboxes WHERE address = ?1 LIMIT 1")
      .bind(address)
      .first<{ id: string; user_id: string | null }>();
    if (existing?.id) {
      if (existing.user_id && existing.user_id !== userId) return json({ error: "address_taken" }, { status: 409 });
      await env.DB.prepare("UPDATE mailboxes SET user_id = ?1, is_active = 1 WHERE id = ?2")
        .bind(userId, existing.id)
        .run();
      return json({ mailbox: { id: existing.id, address, userId } }, { status: 200 });
    }

    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO mailboxes (id, user_id, address, is_active) VALUES (?1, ?2, ?3, 1)")
      .bind(id, userId, address)
      .run();
    return json({ mailbox: { id, address, userId } }, { status: 201 });
  }

  return null;
}
