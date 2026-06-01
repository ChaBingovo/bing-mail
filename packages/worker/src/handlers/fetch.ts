import type { Env } from "../env";
import { json, text } from "../http";
import { logError } from "../log";
import { isDbSchemaError } from "./fetch.shared";
import { handleAdminRoutes } from "./fetch.routes.admin";
import { handleMailRoutes } from "./fetch.routes.mail";
import { handlePublicRoutes } from "./fetch.routes.public";
import { handleSearchRoutes } from "./fetch.routes.search";
import { handleUserRoutes } from "./fetch.routes.user";

export async function handleFetch(request: Request, env: Env) {
  if (request.method === "OPTIONS") return text("", { status: 204 });

  try {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (!pathname.startsWith("/api")) {
      return env.ASSETS.fetch(request);
    }
    const res =
      (await handlePublicRoutes(request, env, url, pathname)) ??
      (await handleUserRoutes(request, env, url, pathname)) ??
      (await handleAdminRoutes(request, env, pathname)) ??
      (await handleMailRoutes(request, env, url, pathname)) ??
      (await handleSearchRoutes(request, env, url, pathname));
    if (res) return res;

    return json({ error: "not_found" }, { status: 404 });
  } catch (err) {
    if (isDbSchemaError(err)) {
      const requestId = (request.headers.get("x-request-id") || "").trim() || crypto.randomUUID();
      const message = err instanceof Error ? err.message : String(err);
      logError({ event: "db_schema_error", requestId, error: message });
      return json({ error: "server_misconfigured", requestId }, { status: 500 });
    }
    throw err;
  }
}
