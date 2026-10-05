import { expect, test } from "bun:test";
import { extractHtmlAndCss, rewriteCidSources, toProxyImageSrc } from "../src/utils/emailHtml";

/** Minimal Document stand-in: only what extractHtmlAndCss touches. */
function fakeDocument(styles: string[], bodyHtml: string) {
  const nodes = styles.map((css) => ({ textContent: css, remove() {} }));
  return {
    querySelectorAll: (selector: string) => (selector === "style" ? nodes : []),
    body: { innerHTML: bodyHtml },
  } as unknown as Document;
}

const noDom = () => {
  throw new Error("DOMParser unavailable");
};

test("remote images go through the same-origin proxy", () => {
  expect(toProxyImageSrc("https://cdn.example.com/a.png")).toBe(
    "/api/media/proxy?url=https%3A%2F%2Fcdn.example.com%2Fa.png",
  );
  expect(toProxyImageSrc("http://cdn.example.com/a.png")).toBe(
    "/api/media/proxy?url=http%3A%2F%2Fcdn.example.com%2Fa.png",
  );
  expect(toProxyImageSrc("  https://cdn.example.com/a.png  ")).toBe(
    "/api/media/proxy?url=https%3A%2F%2Fcdn.example.com%2Fa.png",
  );
});

test("non-remote image sources are left for the sanitiser to handle", () => {
  expect(toProxyImageSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  expect(toProxyImageSrc("cid:logo@example")).toBe("cid:logo@example");
  expect(toProxyImageSrc("/local/a.png")).toBe("/local/a.png");
  expect(toProxyImageSrc("javascript:alert(1)")).toBe("javascript:alert(1)");
  expect(toProxyImageSrc("")).toBe("");
});

test("style blocks are collected and stripped from the body", () => {
  const out = extractHtmlAndCss("<html/>", () => fakeDocument(["a{color:red}", "b{x:1}"], "<p>hi</p>"));
  expect(out.css).toBe("a{color:red}\nb{x:1}");
  expect(out.html).toBe("<p>hi</p>");
});

test("a parser failure degrades to the raw source instead of throwing", () => {
  expect(extractHtmlAndCss("<p>raw</p>", noDom)).toEqual({ html: "<p>raw</p>", css: "" });
});

test("an empty or missing document degrades cleanly", () => {
  expect(extractHtmlAndCss("", noDom)).toEqual({ html: "", css: "" });
  expect(extractHtmlAndCss(undefined as unknown as string, noDom)).toEqual({ html: "", css: "" });
});

const inlineImage = { contentId: "logo@example.com", url: "/api/messages/m1/attachments/a1?inline=1" };

test("cid references resolve to the same-origin attachment endpoint", () => {
  const html = '<p><img src="cid:logo@example.com"></p>';
  expect(rewriteCidSources(html, [inlineImage])).toBe(
    '<p><img src="/api/messages/m1/attachments/a1?inline=1"></p>',
  );
});

test("cid matching tolerates angle brackets, case and single quotes", () => {
  // The original quoting style is preserved so the surrounding markup is untouched.
  for (const html of ['<img src="cid:LOGO@example.com">', '<img src="cid:<logo@example.com>">', '<img src="cid:Logo@Example.com">']) {
    expect(rewriteCidSources(html, [inlineImage])).toContain('src="/api/messages/m1/attachments/a1?inline=1"');
  }
  expect(rewriteCidSources("<img src='cid:logo@example.com'>", [inlineImage])).toBe(
    "<img src='/api/messages/m1/attachments/a1?inline=1'>",
  );
});

test("an unresolved cid is left untouched rather than rewritten to a broken url", () => {
  const html = '<img src="cid:missing@example.com">';
  expect(rewriteCidSources(html, [inlineImage])).toBe(html);
  expect(rewriteCidSources(html, [])).toBe(html);
});

test("attachments without a content id never match cid references", () => {
  const html = '<img src="cid:logo@example.com">';
  const noCid = [{ contentId: null, url: "/api/messages/m1/attachments/a1?inline=1" }];
  expect(rewriteCidSources(html, noCid)).toBe(html);
});

test("non-src attributes and unrelated markup are untouched", () => {
  const html = '<a href="cid:logo@example.com">link</a> <img data-x="cid:logo@example.com">';
  expect(rewriteCidSources(html, [inlineImage])).toBe(html);
});

test("multiple cid images each resolve to their own attachment", () => {
  const html = '<img src="cid:a@x.com"><img src="cid:b@x.com">';
  const out = rewriteCidSources(html, [
    { contentId: "a@x.com", url: "/api/messages/m1/attachments/a1?inline=1" },
    { contentId: "b@x.com", url: "/api/messages/m1/attachments/a2?inline=1" },
  ]);
  expect(out).toBe('<img src="/api/messages/m1/attachments/a1?inline=1"><img src="/api/messages/m1/attachments/a2?inline=1">');
});
