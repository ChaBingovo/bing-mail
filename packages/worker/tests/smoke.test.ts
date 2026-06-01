import { expect, test } from "bun:test";
import { signJwt } from "../src/auth";
import { decodeCursor, encodeCursor, parseTurnstileMode, verifyJwtRotating } from "../src/handlers/fetch.shared";

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

test("verifyJwtRotating enforces previous secret max exp", async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = {
    JWT_SECRET: "",
    JWT_SECRET_CURRENT: "current-secret",
    JWT_SECRET_PREVIOUS: "previous-secret",
  } as any;

  const tokenCurrent = await signJwt({ sub: "u1", exp: now + 60 }, env.JWT_SECRET_CURRENT);
  const currentPayload = await verifyJwtRotating(tokenCurrent, env);
  expect(currentPayload?.sub).toBe("u1");

  const tokenPrevOk = await signJwt({ sub: "u2", exp: now + 14 * 24 * 60 * 60 }, env.JWT_SECRET_PREVIOUS);
  const prevOkPayload = await verifyJwtRotating(tokenPrevOk, env);
  expect(prevOkPayload?.sub).toBe("u2");

  const tokenPrevTooLong = await signJwt({ sub: "u3", exp: now + 15 * 24 * 60 * 60 }, env.JWT_SECRET_PREVIOUS);
  const prevTooLongPayload = await verifyJwtRotating(tokenPrevTooLong, env);
  expect(prevTooLongPayload).toBeNull();
});
