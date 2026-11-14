import { expect, test } from "bun:test";
import { looksLikeMarkdown, markdownToEmailHtml } from "../src/utils/markdownEmail";

test("looksLikeMarkdown detects common patterns", () => {
  expect(looksLikeMarkdown("# Title\nhi")).toBe(true);
  expect(looksLikeMarkdown("- a\n- b")).toBe(true);
  expect(looksLikeMarkdown("normal text")).toBe(false);
});

test("markdownToEmailHtml escapes raw html", () => {
  const html = markdownToEmailHtml("hello <script>alert(1)</script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
});

test("markdownToEmailHtml keeps unicode content", () => {
  const html = markdownToEmailHtml("中文测试 😄");
  expect(html).toContain("中文测试");
  expect(html).toContain("😄");
});

test("markdownToEmailHtml renders link and blocks unsafe schemes", () => {
  const html = markdownToEmailHtml("[bing](https://example.com)");
  expect(html).toContain('<a href="https://example.com">bing</a>');

  const unsafe = markdownToEmailHtml("[xss](javascript:alert(1))");
  expect(unsafe).not.toContain("javascript:");
  expect(unsafe).toContain("xss");
});

test("markdownToEmailHtml supports blockquotes and outbound variant", () => {
  const html = markdownToEmailHtml("> quoted line\n\n```ts\nconst x = 1;\n```", { variant: "outbound" });
  expect(html).toContain("<blockquote>quoted line</blockquote>");
  expect(html).toContain("rgba(127,127,127,.12)");
});

