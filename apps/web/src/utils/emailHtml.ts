/**
 * Pure helpers behind `ShadowHtml`. They live here (rather than inside the
 * component) so the DOM-free parts — most importantly the degradation path — can
 * be covered by automatic tests without shipping a DOM emulator.
 */

/**
 * Routes remote images through the same-origin media proxy so the reader's IP is
 * never exposed to the sender. Only absolute `http(s)` sources are rewritten;
 * `data:`, `cid:`, relative and `javascript:` sources are left for DOMPurify to
 * accept or drop.
 */
export function toProxyImageSrc(src: string) {
  const value = (src || "").trim();
  const lower = value.toLowerCase();
  if (lower.startsWith("https://") || lower.startsWith("http://")) {
    return `/api/media/proxy?url=${encodeURIComponent(value)}`;
  }
  return value;
}

export type ExtractedHtml = { html: string; css: string };

export type CidAttachment = {
  contentId: string | null;
  url: string;
};

/**
 * Maps `src="cid:..."` to the same-origin attachment endpoint so inline images
 * render without exposing the reader to the sender's server.
 *
 * Matching is done on the raw `cid:` reference (angle brackets and casing vary
 * between clients), and only attachments that actually carry a Content-ID are
 * considered. Unresolved references are left untouched rather than rewritten to a
 * broken URL.
 */
export function rewriteCidSources(html: string, attachments: CidAttachment[]) {
  const source = html || "";
  if (!source || attachments.length === 0) return source;

  const byCid = new Map<string, string>();
  for (const attachment of attachments) {
    const cid = normalizeCid(attachment.contentId);
    if (cid && attachment.url) byCid.set(cid, attachment.url);
  }
  if (byCid.size === 0) return source;

  return source.replace(/\bsrc\s*=\s*(?:"cid:([^"]*)"|'cid:([^']*)')/gi, (match, doubleQuoted, singleQuoted) => {
    const raw = doubleQuoted ?? singleQuoted ?? "";
    const url = byCid.get(normalizeCid(raw));
    if (!url) return match;
    const attribute = doubleQuoted !== undefined ? `"${url}"` : `'${url}'`;
    return `src=${attribute}`;
  });
}

/** Strips the optional angle brackets and lowercases, per RFC 2392 practice. */
function normalizeCid(value: string | null | undefined) {
  const v = (value || "").trim().replace(/^<|>$/g, "");
  return v ? v.toLowerCase() : "";
}

/**
 * Splits an email document into body markup and the collected `<style>` CSS.
 *
 * A parser failure degrades to the raw source instead of throwing, which is what
 * keeps a malformed message readable. `parse` is injectable so that fallback can
 * be tested deterministically.
 */
export function extractHtmlAndCss(raw: string, parse?: (html: string) => Document): ExtractedHtml {
  const source = raw || "";
  try {
    const doc = (parse ?? ((html: string) => new DOMParser().parseFromString(html, "text/html")))(source);
    const styles = Array.from(doc.querySelectorAll("style"))
      .map((s) => s.textContent || "")
      .join("\n");
    doc.querySelectorAll("style").forEach((s) => s.remove());
    return { html: doc.body?.innerHTML || "", css: styles };
  } catch {
    return { html: source, css: "" };
  }
}
