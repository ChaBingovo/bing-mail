/**
 * Guard for the outbound media proxy (`/api/media/proxy`).
 *
 * The proxy exists so email HTML can display images without leaking the reader's
 * IP to the sender. It must never become a way to reach the local network or
 * Cloudflare-internal endpoints, so every hop is validated before it is fetched.
 */

const MAX_HOST_LENGTH = 253;

function isAllDigits(s: string) {
  return s.length > 0 && /^[0-9]+$/.test(s);
}

/** `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `127.0.0.0/8`, `0.0.0.0/8`, CGNAT, multicast. */
function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  if (!parts.every((p) => isAllDigits(p) && Number(p) <= 255)) return false;
  const [a, b] = parts.map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

/** Loopback, unspecified, link-local, unique-local and IPv4-mapped forms. */
function isPrivateIpv6(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1") return true;
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  if (host.startsWith("ff")) return true;
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

export function isPrivateHostname(hostname: string) {
  const host = (hostname || "").trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return true;
  if (isPrivateIpv4(host)) return true;
  if (isPrivateIpv6(host)) return true;
  return false;
}

export type SafeUrlResult = { ok: true; url: string } | { ok: false; reason: string };

/** Accepts only absolute, public http(s) URLs; used before every outbound hop. */
export function assertPublicHttpUrl(rawUrl: string): SafeUrlResult {
  const raw = (rawUrl || "").trim();
  if (!raw) return { ok: false, reason: "empty_url" };
  if (raw.length > 2048) return { ok: false, reason: "url_too_long" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "invalid_protocol" };
  if (url.username || url.password) return { ok: false, reason: "credentials_not_allowed" };
  const host = url.hostname;
  if (!host || host.length > MAX_HOST_LENGTH) return { ok: false, reason: "invalid_host" };
  if (isPrivateHostname(host)) return { ok: false, reason: "blocked_host" };

  return { ok: true, url: url.toString() };
}