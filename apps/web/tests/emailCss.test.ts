import { expect, test } from "bun:test";
import { filterEmailCss, filterInlineStyle } from "../src/utils/emailCss";

test("filterEmailCss keeps https background-image url", () => {
  const css = "div{background-image:url(' `https://esa-img.loliapi.cn/i/pe/img782.webp` ')}";
  const out = filterEmailCss(css);
  expect(out).toContain('/api/media/proxy?url=');
});

test("filterEmailCss rewrites body selector to :host for shadow dom", () => {
  const css = "\n   body {\n     background-image: url(' `https://esa-img.loliapi.cn/i/pe/img782.webp` ');\n   }\n";
  const out = filterEmailCss(css);
  expect(out).toContain(":host {");
  expect(out).toContain("/api/media/proxy?url=");
});

test("filterEmailCss strips javascript url", () => {
  const css = "div{background-image:url(javascript:alert(1))}";
  const out = filterEmailCss(css);
  expect(out).not.toContain("javascript:");
});

test("filterInlineStyle keeps https url", () => {
  const s = "background-image:url(https://example.com/a.png)";
  const out = filterInlineStyle(s);
  expect(out).toContain('/api/media/proxy?url=');
});
