import { expect, test } from "bun:test";
import { assertPublicHttpUrl, isPrivateHostname } from "../src/url-guard";

const blockedHosts = [
  "localhost",
  "localhost.",
  "app.localhost",
  "foo.local",
  "metadata.google.internal",
  "gateway.home.arpa",
  "127.0.0.1",
  "127.1.2.3",
  "10.0.0.5",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.1.1",
  "169.254.169.254",
  "100.64.0.1",
  "0.0.0.0",
  "224.0.0.1",
  "[::1]",
  "::1",
  "[fe80::1]",
  "[fd00::1]",
  "[::ffff:127.0.0.1]",
];

const allowedHosts = ["example.com", "8.8.8.8", "1.1.1.1", "172.32.0.1", "images.example.co.uk"];

test("private and internal hosts are rejected", () => {
  for (const host of blockedHosts) {
    expect(isPrivateHostname(host)).toBe(true);
  }
});

test("public hosts are allowed", () => {
  for (const host of allowedHosts) {
    expect(isPrivateHostname(host)).toBe(false);
  }
});

test("assertPublicHttpUrl only accepts absolute public http(s) urls", () => {
  expect(assertPublicHttpUrl("https://cdn.example.com/a.png").ok).toBe(true);
  expect(assertPublicHttpUrl("http://example.com/a.png").ok).toBe(true);

  expect(assertPublicHttpUrl("").ok).toBe(false);
  expect(assertPublicHttpUrl("/relative/a.png").ok).toBe(false);
  expect(assertPublicHttpUrl("file:///etc/passwd").ok).toBe(false);
  expect(assertPublicHttpUrl("data:image/png;base64,AAAA").ok).toBe(false);
  expect(assertPublicHttpUrl("javascript:alert(1)").ok).toBe(false);
  expect(assertPublicHttpUrl("https://user:pass@example.com/a.png").ok).toBe(false);
  expect(assertPublicHttpUrl("https://127.0.0.1/a.png").ok).toBe(false);
  expect(assertPublicHttpUrl("https://169.254.169.254/latest/meta-data/").ok).toBe(false);
  expect(assertPublicHttpUrl("https://localhost:8787/a.png").ok).toBe(false);
  expect(assertPublicHttpUrl(`https://example.com/${"a".repeat(2100)}`).ok).toBe(false);
});

test("blocked urls report a machine-readable reason", () => {
  const res = assertPublicHttpUrl("https://10.0.0.1/a.png");
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.reason).toBe("blocked_host");

  const proto = assertPublicHttpUrl("ftp://example.com/a.png");
  expect(proto.ok).toBe(false);
  if (!proto.ok) expect(proto.reason).toBe("invalid_protocol");
});