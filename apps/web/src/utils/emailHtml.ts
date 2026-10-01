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
