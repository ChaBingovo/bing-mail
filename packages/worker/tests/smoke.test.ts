import { expect, test } from "bun:test";
import { signJwt, verifyJwt } from "../src/auth";
import { decodeCursor, encodeCursor, parseTurnstileMode, verifyJwtWithEnv } from "../src/handlers/fetch.shared";

test("cursor encode/decode roundtrip", () => {
  const ts = 1730000000000;
  const id = "a-b-c";
  const cur = encodeCursor(ts, id);
  const parsed = decodeCursor(cur);
  expect(parsed).toEqual({ receivedAt: ts, id });
});

test("parseTurnstileMode accepts known values", () => {
  expect(parseTurnstileMode("off")).toBe("off");
  expect(parseTurnstileMode("always")).toBe("always");
  expect(parseTurnstileMode("on_failure")).toBe("on_failure");
  expect(parseTurnstileMode("bad")).toBeNull();
});

test("verifyJwtWithEnv verifies signed token", async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = {
    JWT_SECRET: "secret",
  } as any;

  const token = await signJwt({ sub: "u1", exp: now + 60 }, env.JWT_SECRET);
  const direct = await verifyJwt(token, env.JWT_SECRET);
  expect(direct?.sub).toBe("u1");
  const withEnv = await verifyJwtWithEnv(token, env);
  expect(withEnv?.sub).toBe("u1");
});
