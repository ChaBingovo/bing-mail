import type { Env } from "../env";
import { json } from "../http";
import { hashPassword, signJwt, verifyPassword } from "../auth";
import * as S from "./fetch.shared";

export async function handlePublicRoutes(request: Request, env: Env, url: URL, pathname: string): Promise<Response | null> {
  if (pathname === "/api/domains" && request.method === "GET") {
    const domains = await S.listActiveDomains(env);
    return json({ domains });
  }

  if (pathname === "/api/setup/status" && request.method === "GET") {
    const initialized = await S.isInitialized(env);
    const allowRegister = initialized ? (await S.getSetting(env, "allow_register")) === "1" : false;
    return json({ initialized, allowRegister });
  }

  if (pathname === "/api/turnstile/config" && request.method === "GET") {
    const cfg = await S.getTurnstileConfig(env);
    return json({ mode: cfg.mode, siteKey: cfg.siteKey }, { headers: { "cache-control": "no-store" } });
  }

  if (pathname === "/api/setup/domains" && request.method === "POST") {
    if (await S.isInitialized(env)) return json({ error: "already_initialized" }, { status: 409 });
    const body = await S.readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const domain =
      typeof body === "object" && body && "domain" in body && typeof (body as any).domain === "string"
        ? S.normalizeDomain((body as any).domain)
        : "";
    if (!S.isValidDomain(domain)) return json({ error: "invalid_domain" }, { status: 400 });
    await env.DB.prepare("INSERT OR IGNORE INTO domains (id, domain, is_active) VALUES (?1, ?2, 1)")
      .bind(crypto.randomUUID(), domain)
      .run();
    return json({ domain });
  }

  if (pathname === "/api/setup/init" && request.method === "POST") {
    if (!S.hasJwtSecret(env)) return json({ error: "server_misconfigured" }, { status: 500 });
    const initialized = await S.isInitialized(env);
    if (initialized) return json({ error: "already_initialized" }, { status: 409 });

    const body = await S.readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });

    const turnstile = await S.getTurnstileConfig(env);
    if (turnstile.mode !== "off") {
      const turnstileRes = await S.requireTurnstileToken(request, turnstile.secret, body, true);
      if (turnstileRes) return turnstileRes;
    }

    const username = S.toUsername(body);
    const password = S.toPassword(body);
    if (!S.isValidUsername(username)) return json({ error: "invalid_username" }, { status: 400 });
    if (typeof password !== "string" || password.length < 8 || password.length > 72) {
      return json({ error: "invalid_password" }, { status: 400 });
    }

    const domain =
      typeof body === "object" && body && "domain" in body && typeof (body as any).domain === "string"
        ? S.normalizeDomain((body as any).domain)
        : "";
    const mailboxLocal =
      typeof body === "object" && body && "mailboxLocal" in body && typeof (body as any).mailboxLocal === "string"
        ? S.normalizeLocalPart((body as any).mailboxLocal)
        : "";
    if (!domain) return json({ error: "domain_required" }, { status: 400 });
    if (!mailboxLocal) return json({ error: "mailbox_required" }, { status: 400 });
    if (!S.isValidDomain(domain)) return json({ error: "invalid_domain" }, { status: 400 });
    if (!S.isValidLocalPart(mailboxLocal)) return json({ error: "invalid_mailbox_local" }, { status: 400 });
    const mailboxAddress = S.makeEmailAddress(mailboxLocal, domain);

    const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?1 LIMIT 1")
      .bind(username)
      .first<{ id: string }>();
    if (existing?.id) return json({ error: "username_taken" }, { status: 409 });

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    await env.DB.prepare("INSERT INTO users (id, username, password_hash, is_admin) VALUES (?1, ?2, ?3, 1)")
      .bind(id, username, passwordHash)
      .run();

    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES ('allow_register', '0', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
      .bind(now)
      .run();

    await env.DB.prepare("INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES ('max_aliases', '3', ?1)")
      .bind(now)
      .run();

    await env.DB.prepare("INSERT OR IGNORE INTO domains (id, domain, is_active) VALUES (?1, ?2, 1)")
      .bind(crypto.randomUUID(), domain)
      .run();

    const mailboxExisting = await env.DB.prepare("SELECT id FROM mailboxes WHERE address = ?1 LIMIT 1")
      .bind(mailboxAddress)
      .first<{ id: string }>();
    if (mailboxExisting?.id) return json({ error: "mailbox_taken" }, { status: 409 });
    const mailboxId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO mailboxes (id, user_id, address, is_active) VALUES (?1, ?2, ?3, 1)")
      .bind(mailboxId, id, mailboxAddress)
      .run();

    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const secret = S.getJwtSecretCurrent(env);
    if (!secret) return json({ error: "server_misconfigured" }, { status: 500 });
    const token = await signJwt({ sub: id, username, isAdmin: true, exp }, secret);
    return json({ user: { id, username, isAdmin: true }, token }, { status: 201 });
  }

  if (pathname === "/api/auth/register" && request.method === "POST") {
    if (!S.hasJwtSecret(env)) return json({ error: "server_misconfigured" }, { status: 500 });
    if (!(await S.isInitialized(env))) return json({ error: "not_initialized" }, { status: 409 });
    const allowRegister = (await S.getSetting(env, "allow_register")) === "1";
    if (!allowRegister) return json({ error: "register_disabled" }, { status: 403 });
    const body = await S.readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });

    const turnstile = await S.getTurnstileConfig(env);
    if (turnstile.mode !== "off") {
      const turnstileRes = await S.requireTurnstileToken(request, turnstile.secret, body, true);
      if (turnstileRes) return turnstileRes;
    }

    const username = S.toUsername(body);
    const password = S.toPassword(body);
    if (!S.isValidUsername(username)) return json({ error: "invalid_username" }, { status: 400 });
    if (typeof password !== "string" || password.length < 8 || password.length > 72) {
      return json({ error: "invalid_password" }, { status: 400 });
    }

    const domain =
      typeof body === "object" && body && "domain" in body && typeof (body as any).domain === "string"
        ? S.normalizeDomain((body as any).domain)
        : "";
    const mailboxLocal =
      typeof body === "object" && body && "mailboxLocal" in body && typeof (body as any).mailboxLocal === "string"
        ? S.normalizeLocalPart((body as any).mailboxLocal)
        : "";
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
    await env.DB.prepare("INSERT INTO users (id, username, password_hash, is_admin) VALUES (?1, ?2, ?3, 0)")
      .bind(id, username, passwordHash)
      .run();

    const mailboxExisting = await env.DB.prepare("SELECT id FROM mailboxes WHERE address = ?1 LIMIT 1")
      .bind(mailboxAddress)
      .first<{ id: string }>();
    if (mailboxExisting?.id) return json({ error: "mailbox_taken" }, { status: 409 });
    const mailboxId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO mailboxes (id, user_id, address, is_active) VALUES (?1, ?2, ?3, 1)")
      .bind(mailboxId, id, mailboxAddress)
      .run();

    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const secret = S.getJwtSecretCurrent(env);
    if (!secret) return json({ error: "server_misconfigured" }, { status: 500 });
    const token = await signJwt({ sub: id, username, isAdmin: false, exp }, secret);
    return json({ user: { id, username, isAdmin: false }, token }, { status: 201 });
  }

  if (pathname === "/api/auth/login" && request.method === "POST") {
    if (!S.hasJwtSecret(env)) return json({ error: "server_misconfigured" }, { status: 500 });
    if (!(await S.isInitialized(env))) return json({ error: "not_initialized" }, { status: 409 });
    const body = await S.readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });

    const username = S.toUsername(body);
    const password = S.toPassword(body);
    if (!S.isValidUsername(username)) return json({ error: "invalid_username" }, { status: 400 });
    if (typeof password !== "string" || password.length < 1) return json({ error: "invalid_password" }, { status: 400 });

    const keys: string[] = [S.rateKeyUser(username)];
    const ip = S.getClientIp(request);
    if (ip) keys.push(S.rateKeyIp(ip));

    let hasFailures = false;
    for (const k of keys) {
      const id = env.AUTH_RATE.idFromName(k);
      const stub = env.AUTH_RATE.get(id);
      const res = await stub.fetch("https://auth-rate/check", { method: "POST" });
      const data = (await res.json()) as { limited?: unknown; count?: unknown };
      if (data?.limited === true) return json({ error: "rate_limited" }, { status: 429 });
      if (typeof data?.count === "number" && data.count > 0) hasFailures = true;
    }

    const turnstile = await S.getTurnstileConfig(env);
    const required = turnstile.mode === "always" || (turnstile.mode === "on_failure" && hasFailures);
    if (turnstile.mode !== "off") {
      const turnstileRes = await S.requireTurnstileToken(request, turnstile.secret, body, required);
      if (turnstileRes) return turnstileRes;
    }

    const user = await env.DB.prepare("SELECT id, password_hash, is_admin FROM users WHERE username = ?1 LIMIT 1")
      .bind(username)
      .first<{ id: string; password_hash: string; is_admin: number }>();
    if (!user?.id) {
      await Promise.all(keys.map((k) => S.authRateFail(env, k)));
      return json({ error: "unauthorized" }, { status: 401 });
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      await Promise.all(keys.map((k) => S.authRateFail(env, k)));
      return json({ error: "unauthorized" }, { status: 401 });
    }

    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const isAdmin = Boolean(user.is_admin);
    const secret = S.getJwtSecretCurrent(env);
    if (!secret) return json({ error: "server_misconfigured" }, { status: 500 });
    const token = await signJwt({ sub: user.id, username, isAdmin, exp }, secret);
    await Promise.all(keys.map((k) => S.authRateReset(env, k)));
    return json({ user: { id: user.id, username, isAdmin }, token });
  }

  return null;
}
