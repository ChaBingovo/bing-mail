import { expect, test } from "bun:test";
import { attachRequestId } from "../src/index";

test("attachRequestId returns WebSocket responses with status 101", () => {
  const upstream = new Response(null, { status: 200, statusText: "OK" });
  Object.defineProperty(upstream, "webSocket", { value: {}, configurable: true });

  const res = attachRequestId(upstream, "request-1");

  expect(res.status).toBe(101);
  expect(res.statusText).toBe("Switching Protocols");
  expect(res.headers.get("x-request-id")).toBe("request-1");
});
