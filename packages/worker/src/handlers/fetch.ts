import type { Env } from "../env";
import { json, text } from "../http";
import { getBearerToken, hashPassword, signJwt, verifyJwt, verifyPassword } from "../auth";

function isMissingAiColumnsError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("no such column: ai_code") || msg.includes("no such column: ai_service");
}

function isMissingIsAdminColumnError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("no such column: is_admin");
}

function isMissingAppSettingsTableError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("no such table: app_settings");
}

function isMissingDomainsTableError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("no such table: domains");
}

function isMissingUsersTableError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("no such table: users");
}

function isMissingMailboxesTableError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("no such table: mailboxes");
}

function isMissingMessagesTableError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("no such table: messages");
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

function normalizeDomain(input: string) {
  return (input || "").trim().toLowerCase();
}

function isValidDomain(domain: string) {
  if (!domain) return false;
  if (domain.length > 253) return false;
  if (domain.includes("..")) return false;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain);
}

function normalizeLocalPart(input: string) {
  return (input || "").trim();
}

function isValidLocalPart(local: string) {
  if (!local) return false;
  if (local.length > 64) return false;
  return /^[a-zA-Z0-9._+-]+$/.test(local);
}

function makeEmailAddress(local: string, domain: string) {
  const l = normalizeLocalPart(local);
  const d = normalizeDomain(domain);
  return `${l}@${d}`.toLowerCase();
}

async function getSetting(env: Env, key: string) {
  try {
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?1 LIMIT 1")
      .bind(key)
      .first<{ value: string }>();
    return typeof row?.value === "string" ? row.value : null;
  } catch (err) {
    if (isMissingAppSettingsTableError(err)) return null;
    throw err;
  }
}

function parseSettingInt(raw: string | null, fallback: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i <= 0) return fallback;
  return i;
}

async function getMaxAliases(env: Env) {
  return parseSettingInt(await getSetting(env, "max_aliases"), 3);
}

async function isInitialized(env: Env) {
  try {
    const row = await env.DB.prepare("SELECT 1 AS ok FROM users WHERE is_admin = 1 LIMIT 1").first<{ ok: 1 }>();
    return Boolean(row?.ok);
  } catch (err) {
    if (isMissingUsersTableError(err)) return false;
    if (isMissingIsAdminColumnError(err)) return false;
    throw err;
  }
}

async function listActiveDomains(env: Env) {
  try {
    const res = await env.DB.prepare("SELECT domain FROM domains WHERE is_active = 1 ORDER BY domain ASC").all<{
      domain: string;
    }>();
    return res.results.map((r) => r.domain).filter((d) => typeof d === "string" && d.length > 0);
  } catch (err) {
    if (isMissingDomainsTableError(err)) return [];
    throw err;
  }
}

async function requireActiveDomain(env: Env, domain: string) {
  const d = normalizeDomain(domain);
  if (!isValidDomain(d)) return null;
  try {
    const row = await env.DB.prepare("SELECT 1 AS ok FROM domains WHERE domain = ?1 AND is_active = 1 LIMIT 1")
      .bind(d)
      .first<{ ok: 1 }>();
    return row?.ok ? d : null;
  } catch (err) {
    if (isMissingDomainsTableError(err)) return null;
    throw err;
  }
}

async function getMailboxAuth(env: Env, address: string) {
  try {
    const mailbox = await env.DB.prepare(
      "SELECT id, user_id, address FROM mailboxes WHERE address = ?1 AND is_active = 1 LIMIT 1",
    )
      .bind(address)
      .first<{ id: string; user_id: string | null; address: string }>();
    if (mailbox?.id) return mailbox;

    const alias = await env.DB.prepare(
      "SELECT m.id, m.user_id, m.address FROM mailbox_aliases a JOIN mailboxes m ON m.id = a.mailbox_id WHERE a.address = ?1 AND a.is_active = 1 AND m.is_active = 1 LIMIT 1",
    )
      .bind(address)
      .first<{ id: string; user_id: string | null; address: string }>();
    return alias?.id ? alias : null;
  } catch (err) {
    if (isMissingMailboxesTableError(err)) return null;
    throw err;
  }
}

async function requireMailboxAccess(env: Env, auth: { sub: string; isAdmin?: boolean }, address: string) {
  const mailbox = await getMailboxAuth(env, address);
  if (!mailbox?.id) return null;
  if (auth.isAdmin) return mailbox;
  if (!mailbox.user_id) return null;
  if (mailbox.user_id !== auth.sub) return null;
  return mailbox;
}

async function requireMessageAccess(env: Env, auth: { sub: string; isAdmin?: boolean }, messageId: string) {
  let row:
    | ({
        mailbox_user_id: string | null;
      } & Record<string, any>)
    | null;
  try {
    row = await env.DB.prepare(
      "SELECT m.id, m.mailbox_id, m.status, m.from_name, m.from_address, m.subject, m.snippet, m.received_at, m.parsed_at, m.html_r2_key, m.html_inline, m.ai_code, m.ai_service, mb.user_id AS mailbox_user_id FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id WHERE m.id = ?1 LIMIT 1",
    )
      .bind(messageId)
      .first();
  } catch (err) {
    if (isMissingMessagesTableError(err) || isMissingMailboxesTableError(err)) return null;
    if (!isMissingAiColumnsError(err)) throw err;
    row = await env.DB.prepare(
      "SELECT m.id, m.mailbox_id, m.status, m.from_name, m.from_address, m.subject, m.snippet, m.received_at, m.parsed_at, m.html_r2_key, m.html_inline, mb.user_id AS mailbox_user_id FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id WHERE m.id = ?1 LIMIT 1",
    )
      .bind(messageId)
      .first();
  }
  if (!row?.id) return null;
  if (!auth.isAdmin) {
    if (!row.mailbox_user_id) return null;
    if (row.mailbox_user_id !== auth.sub) return null;
  }
  return row;
}

async function requireAuth(request: Request, env: Env) {
  if (!hasJwtSecret(env)) return null;
  const token = getBearerToken(request);
  if (!token) return null;
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) return null;
  return payload;
}

async function requireAuthWs(request: Request, env: Env) {
  if (!hasJwtSecret(env)) return null;
  const url = new URL(request.url);
  const token = getBearerToken(request) || (url.searchParams.get("token") || "").trim();
  if (!token) return null;
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) return null;
  return payload;
}

export async function handleFetch(request: Request, env: Env) {
  if (request.method === "OPTIONS") return text("", { status: 204 });

  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === "/api/domains" && request.method === "GET") {
    const domains = await listActiveDomains(env);
    return json({ domains });
  }

  if (pathname === "/api/setup/status" && request.method === "GET") {
    const initialized = await isInitialized(env);
    const allowRegister = initialized ? (await getSetting(env, "allow_register")) === "1" : false;
    return json({ initialized, allowRegister });
  }

  if (pathname === "/api/setup/domains" && request.method === "POST") {
    if (await isInitialized(env)) return json({ error: "already_initialized" }, { status: 409 });
    const body = await readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const domain =
      typeof body === "object" && body && "domain" in body && typeof (body as any).domain === "string"
        ? normalizeDomain((body as any).domain)
        : "";
    if (!isValidDomain(domain)) return json({ error: "invalid_domain" }, { status: 400 });
    try {
      await env.DB.prepare("INSERT OR IGNORE INTO domains (id, domain, is_active) VALUES (?1, ?2, 1)")
        .bind(crypto.randomUUID(), domain)
        .run();
    } catch (err) {
      if (isMissingDomainsTableError(err)) return json({ error: "server_misconfigured" }, { status: 500 });
      throw err;
    }
    return json({ domain });
  }

  if (pathname === "/api/setup/init" && request.method === "POST") {
    if (!hasJwtSecret(env)) return json({ error: "server_misconfigured" }, { status: 500 });
    const initialized = await isInitialized(env);
    if (initialized) return json({ error: "already_initialized" }, { status: 409 });

    const body = await readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });

    const username = toUsername(body);
    const password = toPassword(body);
    if (!isValidUsername(username)) return json({ error: "invalid_username" }, { status: 400 });
    if (typeof password !== "string" || password.length < 8 || password.length > 72) {
      return json({ error: "invalid_password" }, { status: 400 });
    }

    const domain =
      typeof body === "object" && body && "domain" in body && typeof (body as any).domain === "string"
        ? normalizeDomain((body as any).domain)
        : "";
    const mailboxLocal =
      typeof body === "object" && body && "mailboxLocal" in body && typeof (body as any).mailboxLocal === "string"
        ? normalizeLocalPart((body as any).mailboxLocal)
        : "";
    if (!domain) return json({ error: "domain_required" }, { status: 400 });
    if (!mailboxLocal) return json({ error: "mailbox_required" }, { status: 400 });
    if (!isValidDomain(domain)) return json({ error: "invalid_domain" }, { status: 400 });
    if (!isValidLocalPart(mailboxLocal)) return json({ error: "invalid_mailbox_local" }, { status: 400 });
    const mailboxAddress = makeEmailAddress(mailboxLocal, domain);

    const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?1 LIMIT 1")
      .bind(username)
      .first<{ id: string }>();
    if (existing?.id) return json({ error: "username_taken" }, { status: 409 });

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    await env.DB.prepare("INSERT INTO users (id, username, password_hash, is_admin) VALUES (?1, ?2, ?3, 1)")
      .bind(id, username, passwordHash)
      .run();

    try {
      await env.DB.prepare(
        "INSERT INTO app_settings (key, value, updated_at) VALUES ('allow_register', '0', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
        .bind(Date.now())
        .run();
    } catch (err) {
      if (!isMissingAppSettingsTableError(err)) throw err;
    }

    try {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('max_aliases', '3')",
      ).run();
    } catch (err) {
      if (!isMissingAppSettingsTableError(err)) throw err;
    }

    try {
      await env.DB.prepare("INSERT OR IGNORE INTO domains (id, domain, is_active) VALUES (?1, ?2, 1)")
        .bind(crypto.randomUUID(), domain)
        .run();
    } catch (err) {
      if (!isMissingDomainsTableError(err)) throw err;
    }

    const mailboxExisting = await env.DB.prepare("SELECT id FROM mailboxes WHERE address = ?1 LIMIT 1")
      .bind(mailboxAddress)
      .first<{ id: string }>();
    if (mailboxExisting?.id) return json({ error: "mailbox_taken" }, { status: 409 });
    const mailboxId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO mailboxes (id, user_id, address, is_active) VALUES (?1, ?2, ?3, 1)")
      .bind(mailboxId, id, mailboxAddress)
      .run();

    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const token = await signJwt({ sub: id, username, isAdmin: true, exp }, env.JWT_SECRET);
    return json({ user: { id, username, isAdmin: true }, token }, { status: 201 });
  }

  if (pathname === "/api/auth/register" && request.method === "POST") {
    if (!hasJwtSecret(env)) return json({ error: "server_misconfigured" }, { status: 500 });
    if (!(await isInitialized(env))) return json({ error: "not_initialized" }, { status: 409 });
    const allowRegister = (await getSetting(env, "allow_register")) === "1";
    if (!allowRegister) return json({ error: "register_disabled" }, { status: 403 });
    const body = await readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });

    const username = toUsername(body);
    const password = toPassword(body);
    if (!isValidUsername(username)) return json({ error: "invalid_username" }, { status: 400 });
    if (typeof password !== "string" || password.length < 8 || password.length > 72) {
      return json({ error: "invalid_password" }, { status: 400 });
    }

    const domain =
      typeof body === "object" && body && "domain" in body && typeof (body as any).domain === "string"
        ? normalizeDomain((body as any).domain)
        : "";
    const mailboxLocal =
      typeof body === "object" && body && "mailboxLocal" in body && typeof (body as any).mailboxLocal === "string"
        ? normalizeLocalPart((body as any).mailboxLocal)
        : "";
    if (!domain) return json({ error: "domain_required" }, { status: 400 });
    if (!mailboxLocal) return json({ error: "mailbox_required" }, { status: 400 });
    if (!isValidDomain(domain)) return json({ error: "invalid_domain" }, { status: 400 });
    if (!isValidLocalPart(mailboxLocal)) return json({ error: "invalid_mailbox_local" }, { status: 400 });
    const allowedDomain = await requireActiveDomain(env, domain);
    if (!allowedDomain) return json({ error: "domain_not_allowed" }, { status: 400 });
    const mailboxAddress = makeEmailAddress(mailboxLocal, allowedDomain);

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
    const token = await signJwt({ sub: id, username, isAdmin: false, exp }, env.JWT_SECRET);
    return json({ user: { id, username, isAdmin: false }, token }, { status: 201 });
  }

  if (pathname === "/api/auth/login" && request.method === "POST") {
    if (!hasJwtSecret(env)) return json({ error: "server_misconfigured" }, { status: 500 });
    if (!(await isInitialized(env))) return json({ error: "not_initialized" }, { status: 409 });
    const body = await readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });

    const username = toUsername(body);
    const password = toPassword(body);
    if (!isValidUsername(username)) return json({ error: "invalid_username" }, { status: 400 });
    if (typeof password !== "string" || password.length < 1) return json({ error: "invalid_password" }, { status: 400 });

    const user = await env.DB.prepare("SELECT id, password_hash, is_admin FROM users WHERE username = ?1 LIMIT 1")
      .bind(username)
      .first<{ id: string; password_hash: string; is_admin: number }>();
    if (!user?.id) return json({ error: "unauthorized" }, { status: 401 });
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return json({ error: "unauthorized" }, { status: 401 });

    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const isAdmin = Boolean(user.is_admin);
    const token = await signJwt({ sub: user.id, username, isAdmin, exp }, env.JWT_SECRET);
    return json({ user: { id: user.id, username, isAdmin }, token });
  }

  if (pathname === "/api/user/password" && request.method === "PUT") {
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "unauthorized" }, { status: 401 });
    const body = await readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const oldPassword =
      typeof body === "object" && body && "oldPassword" in body && typeof (body as any).oldPassword === "string"
        ? (body as any).oldPassword
        : "";
    const newPassword =
      typeof body === "object" && body && "newPassword" in body && typeof (body as any).newPassword === "string"
        ? (body as any).newPassword
        : "";
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

  if (pathname === "/api/admin/settings" && request.method === "GET") {
    const auth = await requireAuth(request, env);
    if (!auth?.isAdmin) return json({ error: "forbidden" }, { status: 403 });
    const allowRegister = (await getSetting(env, "allow_register")) === "1";
    const maxAliases = await getMaxAliases(env);
    return json({ allowRegister, maxAliases });
  }

  if (pathname === "/api/admin/settings" && request.method === "PUT") {
    const auth = await requireAuth(request, env);
    if (!auth?.isAdmin) return json({ error: "forbidden" }, { status: 403 });
    const body = await readJsonBody(request);
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

    try {
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
    } catch (err) {
      if (!isMissingAppSettingsTableError(err)) throw err;
    }
    const nextAllowRegister = (await getSetting(env, "allow_register")) === "1";
    const nextMaxAliases = await getMaxAliases(env);
    return json({ allowRegister: nextAllowRegister, maxAliases: nextMaxAliases });
  }

  if (pathname === "/api/admin/domains" && request.method === "GET") {
    const auth = await requireAuth(request, env);
    if (!auth?.isAdmin) return json({ error: "forbidden" }, { status: 403 });
    try {
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
    } catch (err) {
      if (isMissingDomainsTableError(err)) return json({ domains: [] });
      throw err;
    }
  }

  if (pathname === "/api/admin/domains" && request.method === "POST") {
    const auth = await requireAuth(request, env);
    if (!auth?.isAdmin) return json({ error: "forbidden" }, { status: 403 });
    const body = await readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const domain =
      typeof body === "object" && body && "domain" in body && typeof (body as any).domain === "string"
        ? (body as any).domain.trim().toLowerCase()
        : "";
    if (!domain || !domain.includes(".")) return json({ error: "invalid_domain" }, { status: 400 });
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare("INSERT INTO domains (id, domain, is_active) VALUES (?1, ?2, 1)").bind(id, domain).run();
    } catch (err) {
      if (isMissingDomainsTableError(err)) return json({ error: "server_misconfigured" }, { status: 500 });
      throw err;
    }
    return json({ domain: { id, domain, isActive: true } }, { status: 201 });
  }

  const adminDomainDeleteMatch = pathname.match(/^\/api\/admin\/domains\/([^/]+)$/);
  if (adminDomainDeleteMatch && request.method === "DELETE") {
    const auth = await requireAuth(request, env);
    if (!auth?.isAdmin) return json({ error: "forbidden" }, { status: 403 });
    const domain = decodeURIComponent(adminDomainDeleteMatch[1]).trim().toLowerCase();
    if (!domain) return json({ error: "invalid_domain" }, { status: 400 });
    try {
      await env.DB.prepare("DELETE FROM domains WHERE domain = ?1").bind(domain).run();
    } catch (err) {
      if (!isMissingDomainsTableError(err)) throw err;
    }
    return text("", { status: 204 });
  }

  if (pathname === "/api/admin/users" && request.method === "GET") {
    const auth = await requireAuth(request, env);
    if (!auth?.isAdmin) return json({ error: "forbidden" }, { status: 403 });
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
    const auth = await requireAuth(request, env);
    if (!auth?.isAdmin) return json({ error: "forbidden" }, { status: 403 });
    const body = await readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const username = toUsername(body);
    const password = toPassword(body);
    const domain =
      typeof body === "object" && body && "domain" in body && typeof (body as any).domain === "string"
        ? normalizeDomain((body as any).domain)
        : "";
    const mailboxLocal =
      typeof body === "object" && body && "mailboxLocal" in body && typeof (body as any).mailboxLocal === "string"
        ? normalizeLocalPart((body as any).mailboxLocal)
        : "";
    const isAdmin =
      typeof body === "object" && body && "isAdmin" in body && typeof (body as any).isAdmin === "boolean"
        ? (body as any).isAdmin
        : false;
    if (!isValidUsername(username)) return json({ error: "invalid_username" }, { status: 400 });
    if (typeof password !== "string" || password.length < 8 || password.length > 72) {
      return json({ error: "invalid_password" }, { status: 400 });
    }
    if (!domain) return json({ error: "domain_required" }, { status: 400 });
    if (!mailboxLocal) return json({ error: "mailbox_required" }, { status: 400 });
    if (!isValidDomain(domain)) return json({ error: "invalid_domain" }, { status: 400 });
    if (!isValidLocalPart(mailboxLocal)) return json({ error: "invalid_mailbox_local" }, { status: 400 });
    const allowedDomain = await requireActiveDomain(env, domain);
    if (!allowedDomain) return json({ error: "domain_not_allowed" }, { status: 400 });
    const mailboxAddress = makeEmailAddress(mailboxLocal, allowedDomain);

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
    const auth = await requireAuth(request, env);
    if (!auth?.isAdmin) return json({ error: "forbidden" }, { status: 403 });
    const userId = decodeURIComponent(adminUserPasswordMatch[1]).trim();
    if (!userId) return json({ error: "invalid_user_id" }, { status: 400 });
    const body = await readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const password = toPassword(body);
    if (typeof password !== "string" || password.length < 8 || password.length > 72) {
      return json({ error: "invalid_password" }, { status: 400 });
    }
    const passwordHash = await hashPassword(password);
    await env.DB.prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2").bind(passwordHash, userId).run();
    return text("", { status: 204 });
  }

  if (pathname === "/api/admin/mailboxes" && request.method === "GET") {
    const auth = await requireAuth(request, env);
    if (!auth?.isAdmin) return json({ error: "forbidden" }, { status: 403 });
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
    const auth = await requireAuth(request, env);
    if (!auth?.isAdmin) return json({ error: "forbidden" }, { status: 403 });
    const body = await readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const domain =
      typeof body === "object" && body && "domain" in body && typeof (body as any).domain === "string"
        ? normalizeDomain((body as any).domain)
        : "";
    const local =
      typeof body === "object" && body && "mailboxLocal" in body && typeof (body as any).mailboxLocal === "string"
        ? normalizeLocalPart((body as any).mailboxLocal)
        : "";
    const userId =
      typeof body === "object" && body && "userId" in body && typeof (body as any).userId === "string"
        ? (body as any).userId.trim()
        : "";
    if (!domain) return json({ error: "domain_required" }, { status: 400 });
    if (!local) return json({ error: "mailbox_required" }, { status: 400 });
    if (!isValidDomain(domain)) return json({ error: "invalid_domain" }, { status: 400 });
    if (!isValidLocalPart(local)) return json({ error: "invalid_mailbox_local" }, { status: 400 });
    const allowedDomain = await requireActiveDomain(env, domain);
    if (!allowedDomain) return json({ error: "domain_not_allowed" }, { status: 400 });
    const address = makeEmailAddress(local, allowedDomain);
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

  if (pathname === "/api/user/mailbox" && request.method === "GET") {
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "unauthorized" }, { status: 401 });

    const row = await env.DB.prepare("SELECT address FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ address: string }>();
    return json({ address: row?.address || null });
  }

  if (pathname === "/api/user/messages" && request.method === "GET") {
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "unauthorized" }, { status: 401 });

    const mailbox = await env.DB.prepare("SELECT id, address FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ id: string; address: string }>();
    if (!mailbox?.id) return json({ messages: [], address: null });

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
    });
  }

  if (pathname === "/api/user/red-dot" && request.method === "GET") {
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "unauthorized" }, { status: 401 });

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
    const auth = await requireAuthWs(request, env);
    if (!auth) return json({ error: "unauthorized" }, { status: 401 });

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
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "unauthorized" }, { status: 401 });

    const mailbox = await env.DB.prepare("SELECT id, address FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ id: string; address: string }>();
    if (!mailbox?.id) return json({ error: "mailbox_missing" }, { status: 409 });

    const res = await env.DB.prepare(
      "SELECT address FROM mailbox_aliases WHERE mailbox_id = ?1 AND is_active = 1 ORDER BY created_at DESC",
    )
      .bind(mailbox.id)
      .all<{ address: string }>();
    const maxAliases = await getMaxAliases(env);
    return json({ aliases: res.results.map((r) => r.address), maxAliases, mailbox: mailbox.address });
  }

  if (pathname === "/api/user/aliases" && request.method === "POST") {
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "unauthorized" }, { status: 401 });

    const body = await readJsonBody(request);
    if (!body) return json({ error: "invalid_json" }, { status: 400 });
    const domain =
      typeof body === "object" && body && "domain" in body && typeof (body as any).domain === "string"
        ? normalizeDomain((body as any).domain)
        : "";
    const local =
      typeof body === "object" && body && "local" in body && typeof (body as any).local === "string"
        ? normalizeLocalPart((body as any).local)
        : "";
    if (!domain) return json({ error: "domain_required" }, { status: 400 });
    if (!local) return json({ error: "mailbox_required" }, { status: 400 });
    if (!isValidDomain(domain)) return json({ error: "invalid_domain" }, { status: 400 });
    if (!isValidLocalPart(local)) return json({ error: "invalid_mailbox_local" }, { status: 400 });
    const allowedDomain = await requireActiveDomain(env, domain);
    if (!allowedDomain) return json({ error: "domain_not_allowed" }, { status: 400 });
    const address = makeEmailAddress(local, allowedDomain);

    const mailbox = await env.DB.prepare("SELECT id, address FROM mailboxes WHERE user_id = ?1 AND is_active = 1 LIMIT 1")
      .bind(auth.sub)
      .first<{ id: string; address: string }>();
    if (!mailbox?.id) return json({ error: "mailbox_missing" }, { status: 409 });
    if (address === mailbox.address) return json({ error: "invalid_alias" }, { status: 400 });

    const maxAliases = await getMaxAliases(env);
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
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "unauthorized" }, { status: 401 });
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

  const wsMailboxMatch = pathname.match(/^\/api\/ws\/mailboxes\/([^/]+)$/);
  if (wsMailboxMatch && request.method === "GET") {
    const auth = await requireAuthWs(request, env);
    if (!auth) return json({ error: "unauthorized" }, { status: 401 });
    const address = decodeURIComponent(wsMailboxMatch[1]).trim().toLowerCase();
    const mailbox = await requireMailboxAccess(env, auth, address);
    if (!mailbox?.id) return json({ error: "mailbox_not_found" }, { status: 404 });

    const id = env.MAIL_EVENTS.idFromName(mailbox.address);
    const stub = env.MAIL_EVENTS.get(id);
    const doReq = new Request("https://mail-events/connect", request);
    return stub.fetch(doReq);
  }

  const mailboxMatch = pathname.match(/^\/api\/mailboxes\/([^/]+)\/messages$/);
  if (mailboxMatch && request.method === "GET") {
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "unauthorized" }, { status: 401 });
    const address = decodeURIComponent(mailboxMatch[1]).trim().toLowerCase();
    const mailbox = await requireMailboxAccess(env, auth, address);
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
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "unauthorized" }, { status: 401 });
    const address = decodeURIComponent(redDotMatch[1]).trim().toLowerCase();
    const mailbox = await requireMailboxAccess(env, auth, address);
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
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "unauthorized" }, { status: 401 });
    const id = decodeURIComponent(msgMetaMatch[1]);
    const row = await requireMessageAccess(env, auth, id);
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
    const auth = await requireAuth(request, env);
    if (!auth) return text("", { status: 401 });
    const id = decodeURIComponent(msgHtmlMatch[1]);
    const row = await requireMessageAccess(env, auth, id);
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
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "unauthorized" }, { status: 401 });
    const address = (url.searchParams.get("address") || "").trim().toLowerCase();
    const q = (url.searchParams.get("q") || "").trim();
    if (!address || !q) return json({ error: "missing_params" }, { status: 400 });

    const mailbox = await requireMailboxAccess(env, auth, address);
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
