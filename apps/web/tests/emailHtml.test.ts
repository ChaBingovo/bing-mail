import { expect, test } from "bun:test";
import { extractHtmlAndCss, toProxyImageSrc } from "../src/utils/emailHtml";

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
