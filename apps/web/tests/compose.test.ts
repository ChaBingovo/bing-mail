import { expect, test } from "bun:test";
import type { MessageDetail } from "../src/types";
import {
  MAX_RECIPIENTS,
  buildForwardPrefill,
  buildReplyPrefill,
  extractQuoteText,
  isValidEmail,
  mapSendError,
  mergeRecipients,
  parseRecipientsInput,
} from "../src/utils/compose";

function makeDetail(overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    id: "m1",
    status: "SUCCESS",
    fromName: "Alice",
    fromAddress: "alice@example.com",
    subject: "Hello World",
    snippet: "Snippet body",
    receivedAt: 1700000000000,
    parsedAt: 1700000001000,
    hasText: true,
    hasHtml: false,
    aiCode: null,
    aiService: null,
    ...overrides,
  };
}

test("parseRecipientsInput handles commas, Chinese commas, semicolons, whitespace, and angle brackets", () => {
  expect(
    parseRecipientsInput("Alice <Alice@Example.com>, bob@test.org；carol@demo.net\n  BOB@test.org "),
  ).toEqual(["alice@example.com", "bob@test.org", "carol@demo.net"]);
});

test("isValidEmail validates addresses consistently with backend rules", () => {
  expect(isValidEmail("user@example.com")).toBe(true);
  expect(isValidEmail("first.last+tag@sub.example.co")).toBe(true);
  expect(isValidEmail("bad")).toBe(false);
  expect(isValidEmail("a@b")).toBe(false);
  expect(isValidEmail("a@b..com")).toBe(false);
  expect(isValidEmail("a b@example.com")).toBe(false);
});

test("mergeRecipients deduplicates and enforces the cap", () => {
  const existing = ["a@example.com", "b@example.com"];
  const merged = mergeRecipients(existing, ["B@example.com", "c@example.com"]);
  expect(merged).toEqual(["a@example.com", "b@example.com", "c@example.com"]);

  const many = Array.from({ length: 25 }, (_, i) => `u${i}@example.com`);
  expect(mergeRecipients([], many).length).toBe(MAX_RECIPIENTS);
});

test("extractQuoteText prefers plain text and falls back to stripped html or snippet", () => {
  expect(extractQuoteText("plain body", "<p>html body</p>", "snippet")).toBe("plain body");
  expect(extractQuoteText("", "<p>Hello<br/>World &amp; Friends</p>", "snippet")).toBe("Hello\nWorld & Friends");
  expect(extractQuoteText("", "", "fallback snippet")).toBe("fallback snippet");
});

test("buildReplyPrefill sets recipient, avoids duplicate Re:, and quotes text", () => {
  const prefill = buildReplyPrefill({
    detail: makeDetail({ subject: "Re: Project Update" }),
    text: "Line 1\nLine 2",
    html: "",
    fromAddress: "alias@mydomain.com",
  });
  expect(prefill.mode).toBe("reply");
  expect(prefill.from).toBe("alias@mydomain.com");
  expect(prefill.to).toEqual(["alice@example.com"]);
  expect(prefill.subject).toBe("Re: Project Update");
  expect(prefill.body).toContain("Alice <alice@example.com> 写道：");
  expect(prefill.body).toContain("> Line 1\n> Line 2");

  const firstReply = buildReplyPrefill({
    detail: makeDetail({ subject: "Meeting" }),
    text: "See you",
    html: "",
  });
  expect(firstReply.subject).toBe("Re: Meeting");
});

test("buildForwardPrefill leaves recipient empty, avoids duplicate Fwd:, and includes metadata", () => {
  const prefill = buildForwardPrefill({
    detail: makeDetail({ subject: "Invoice" }),
    text: "Amount: $10",
    html: "",
  });
  expect(prefill.mode).toBe("forward");
  expect(prefill.to).toEqual([]);
  expect(prefill.subject).toBe("Fwd: Invoice");
  expect(prefill.body).toContain("---------- 转发邮件 ----------");
  expect(prefill.body).toContain("发件人: Alice <alice@example.com>");
  expect(prefill.body).toContain("Amount: $10");
});

test("mapSendError translates known API error codes", () => {
  expect(mapSendError("rate_limited")).toContain("上限");
  expect(mapSendError("invalid_recipient")).toContain("收件人");
  expect(mapSendError("custom_error")).toBe("custom_error");
});
