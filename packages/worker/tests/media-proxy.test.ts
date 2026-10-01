import { afterEach, expect, test } from "bun:test";
import { signJwt } from "../src/auth";
import { handleMailRoutes } from "../src/handlers/fetch.routes.mail";

const SECRET = "test-secret";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngResponse() {
  return new Response(PNG, {
    headers: { "content-type": "image/png", "content-length": String(PNG.length) },
  });
}

async function token() {
  return signJwt(
    { sub: "u1", username: "alice", exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );
}

/** The media proxy only needs a JWT secret; it never touches DB/R2/Queues. */
function env() {
  return { JWT_SECRET: SECRET } as any;
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// workers-types augments `fetch` with `preconnect`, so a plain function does not
// satisfy `typeof fetch`; cast through the narrowed shape we actually mock.
function setFetch(fn: FetchFn) {
  globalThis.fetch = fn as unknown as typeof fetch;
}

async function proxy(urlParam: string, opts: { auth?: boolean } = {}) {
  const url = `https://mail.example.com/api/media/proxy?url=${encodeURIComponent(urlParam)}`;
  const headers: Record<string, string> = {};
  if (opts.auth !== false) headers.authorization = `Bearer ${await token()}`;
  const req = new Request(url, { headers });
  return handleMailRoutes(req, env(), new URL(req.url), "/api/media/proxy");
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("requires an authenticated session", async () => {
  let fetched = false;
  setFetch(async () => {
    fetched = true;
    return pngResponse();
  });
  const res = await proxy("https://cdn.example.com/a.png", { auth: false });
  expect(res?.status).toBe(401);
  expect(fetched).toBe(false);
});

test("an empty url is refused before any egress", async () => {
  setFetch(async () => {
    throw new Error("must not fetch");
  });
  const res = await proxy("");
  expect(res?.status).toBe(400);
});

test("a private target is blocked without being fetched", async () => {
  let fetched = false;
  setFetch(async () => {
    fetched = true;
    return pngResponse();
  });
  const res = await proxy("http://169.254.169.254/latest/meta-data/");
  expect(res?.status).toBe(403);
  expect(fetched).toBe(false);
});

test("proxies a real image and sets hardening headers", async () => {
  setFetch(async () => pngResponse());
  const res = await proxy("https://cdn.example.com/a.png");
  expect(res?.status).toBe(200);
  expect(res?.headers.get("content-type")).toBe("image/png");
  expect(res?.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res?.headers.get("content-security-policy")).toContain("sandbox");
  expect(res?.headers.get("cross-origin-resource-policy")).toBe("same-site");
  const body = new Uint8Array(await res!.arrayBuffer());
  expect([...body]).toEqual([...PNG]);
});

test("magic bytes win over a mismatched upstream content type", async () => {
  setFetch(async () =>
    new Response(PNG, { headers: { "content-type": "image/jpeg", "content-length": String(PNG.length) } }),
  );
  const res = await proxy("https://cdn.example.com/a.jpg");
  expect(res?.status).toBe(200);
  expect(res?.headers.get("content-type")).toBe("image/png");
});

test("HTML served at an image-looking URL is rejected", async () => {
  setFetch(async () =>
    new Response("<html><body>hi</body></html>", { headers: { "content-type": "text/html" } }),
  );
  const res = await proxy("https://cdn.example.com/evil.png");
  expect(res?.status).toBe(415);
});

test("a declared non-image type with no magic bytes is rejected", async () => {
  setFetch(async () => new Response("not an image", { headers: { "content-type": "text/plain" } }));
  const res = await proxy("https://cdn.example.com/noext");
  expect(res?.status).toBe(415);
});

test("a redirect to a private host is blocked before the hop is fetched", async () => {
  const calls: string[] = [];
  setFetch(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("cdn.example.com/start")) {
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret.png" } });
    }
    return pngResponse();
  });
  const res = await proxy("https://cdn.example.com/start");
  expect(res?.status).toBe(403);
  expect(calls.length).toBe(1);
});

test("a same-origin redirect is followed and the target fetched", async () => {
  const calls: string[] = [];
  setFetch(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/start")) {
      return new Response(null, { status: 301, headers: { location: "https://cdn.example.com/final.png" } });
    }
    return pngResponse();
  });
  const res = await proxy("https://cdn.example.com/start");
  expect(res?.status).toBe(200);
  expect(calls.length).toBe(2);
});

test("gives up after the redirect budget", async () => {
  let calls = 0;
  setFetch(async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: "https://cdn.example.com/next" } });
  });
  const res = await proxy("https://cdn.example.com/start");
  expect(res?.status).toBe(502);
  expect(calls).toBe(4);
});

test("an oversized declared body is refused with 413", async () => {
  setFetch(async () =>
    new Response(null, {
      headers: { "content-type": "image/png", "content-length": String(10 * 1024 * 1024 + 1) },
    }),
  );
  const res = await proxy("https://cdn.example.com/a.png");
  expect(res?.status).toBe(413);
});

test("a body that exceeds the cap while streaming is refused with 413", async () => {
  const big = new Uint8Array(10 * 1024 * 1024 + 1);
  big[0] = 0x89;
  big[1] = 0x50;
  big[2] = 0x4e;
  big[3] = 0x47;
  setFetch(async () => new Response(big, { headers: { "content-type": "image/png" } }));
  const res = await proxy("https://cdn.example.com/a.png");
  expect(res?.status).toBe(413);
});

test("an upstream fetch failure surfaces as 503", async () => {
  setFetch(async () => {
    throw new Error("network down");
  });
  const res = await proxy("https://cdn.example.com/a.png");
  expect(res?.status).toBe(503);
});
