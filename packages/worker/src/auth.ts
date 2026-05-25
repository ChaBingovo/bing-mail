export type JwtPayload = {
  sub: string;
  username?: string;
  exp: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncodeBytes(bytes: Uint8Array) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeToBytes(input: string) {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signJwt(payload: JwtPayload, secret: string) {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64UrlEncodeBytes(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncodeBytes(encoder.encode(JSON.stringify(payload)));
  const data = `${headerB64}.${payloadB64}`;

  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const sigB64 = base64UrlEncodeBytes(new Uint8Array(sig));

  return `${data}.${sigB64}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return null;

  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(decoder.decode(base64UrlDecodeToBytes(headerB64)));
    payload = JSON.parse(decoder.decode(base64UrlDecodeToBytes(payloadB64)));
  } catch {
    return null;
  }

  if (
    typeof header !== "object" ||
    !header ||
    (header as any).alg !== "HS256" ||
    (header as any).typ !== "JWT"
  ) {
    return null;
  }

  const data = `${headerB64}.${payloadB64}`;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, base64UrlDecodeToBytes(sigB64), encoder.encode(data));
  if (!ok) return null;

  if (typeof payload !== "object" || !payload) return null;
  const sub = (payload as any).sub;
  const exp = (payload as any).exp;
  const username = (payload as any).username;
  if (typeof sub !== "string" || typeof exp !== "number") return null;

  const now = Math.floor(Date.now() / 1000);
  if (exp <= now) return null;

  return {
    sub,
    exp,
    username: typeof username === "string" ? username : undefined,
  };
}

export function getBearerToken(request: Request) {
  const auth = request.headers.get("authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m?.[1]) return null;
  return m[1].trim();
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 210000;

  const key = await crypto.subtle.importKey("raw", encoder.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  const hash = new Uint8Array(bits);

  return `pbkdf2$${iterations}$${base64UrlEncodeBytes(salt)}$${base64UrlEncodeBytes(hash)}`;
}

export async function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");
  if (parts.length !== 4) return false;
  const [alg, iterRaw, saltB64, hashB64] = parts;
  if (alg !== "pbkdf2") return false;
  const iterations = Number(iterRaw);
  if (!Number.isFinite(iterations) || iterations < 10000) return false;

  const salt = base64UrlDecodeToBytes(saltB64);
  const expected = base64UrlDecodeToBytes(hashB64);

  const key = await crypto.subtle.importKey("raw", encoder.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    expected.length * 8,
  );
  const actual = new Uint8Array(bits);

  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
