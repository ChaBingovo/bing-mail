import DOMPurify from "dompurify";
import { createEffect } from "solid-js";
import { filterEmailCss, filterInlineStyle } from "../utils/emailCss";

function extractHtmlAndCss(raw: string) {
  try {
    const doc = new DOMParser().parseFromString(raw || "", "text/html");
    const styles = Array.from(doc.querySelectorAll("style"))
      .map((s) => s.textContent || "")
      .join("\n");
    doc.querySelectorAll("style").forEach((s) => s.remove());
    const html = doc.body?.innerHTML || "";
    return { html, css: styles };
  } catch {
    return { html: raw || "", css: "" };
  }
}

let hooksInstalled = false;
function ensureHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
    if (data.attrName === "style") data.attrValue = filterInlineStyle(String(data.attrValue || ""));
  });
}

export function ShadowHtml(props: { html: string; debugId?: string }) {
  let host!: HTMLDivElement;
  let root: ShadowRoot | null = null;

  createEffect(() => {
    const value = props.html || "";
    if (!root) root = host.attachShadow({ mode: "open" });
    ensureHooks();
    const extracted = extractHtmlAndCss(value);
    const safe = DOMPurify.sanitize(extracted.html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "style", "link", "meta", "base", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "option", "svg", "math"],
      FORBID_ATTR: ["onload", "onclick", "onerror", "srcset"],
    });

    const baseCss = `
:host{display:block;color:rgb(228 228 231);background:transparent}
img,video{max-width:100%;height:auto}
table{max-width:100%;border-collapse:collapse}
pre{white-space:pre-wrap;word-break:break-word}
*{max-width:100%}
`;

    try {
      const tpl = document.createElement("template");
      tpl.innerHTML = safe;
      tpl.content.querySelectorAll("a[href]").forEach((a) => {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noreferrer noopener");
      });
      tpl.content.querySelectorAll("img").forEach((img) => {
        const src = (img.getAttribute("src") || "").trim();
        const lower = src.toLowerCase();
        if (lower.startsWith("https://") || lower.startsWith("http://")) {
          img.setAttribute("src", `/api/media/proxy?url=${encodeURIComponent(src)}`);
        }
        img.setAttribute("loading", "lazy");
        img.setAttribute("referrerpolicy", "no-referrer");
      });

      root.replaceChildren();
      const styleEl = document.createElement("style");
      styleEl.textContent = `${baseCss}\n${filterEmailCss(extracted.css)}`;
      root.append(styleEl, tpl.content.cloneNode(true));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[bingmail] email_html_render_failed", { messageId: props.debugId || null, error: msg });
      root.textContent = value;
    }
  });

  return <div ref={host} class="h-full w-full overflow-auto rounded-lg bg-white/5" />;
}
