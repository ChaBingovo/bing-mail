export function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-headers", "*");
  headers.set("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function text(body: string, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-headers", "*");
  headers.set("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  return new Response(body, { ...init, headers });
}
