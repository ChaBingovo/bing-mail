export function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-headers", "*");
  headers.set("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  headers.set("access-control-expose-headers", "x-request-id");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function text(body: string, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-headers", "*");
  headers.set("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  headers.set("access-control-expose-headers", "x-request-id");
  const status = init?.status ?? 200;
  const nullBodyStatus = status === 204 || status === 205 || status === 304;
  return new Response(nullBodyStatus ? null : body, { ...init, status, headers });
}
