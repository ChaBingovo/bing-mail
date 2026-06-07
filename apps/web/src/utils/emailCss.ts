function cleanUrlToken(raw: string) {
  let s = (raw || "").trim();
  while (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === "'" && b === "'") || (a === '"' && b === '"') || (a === "`" && b === "`")) s = s.slice(1, -1).trim();
    else break;
  }
  s = s.replaceAll("`", "").trim();
  return s;
}

function isAllowedCssUrl(url: string) {
  const u = url.trim().toLowerCase();
  if (u.startsWith("https://")) return true;
  if (u.startsWith("http://")) return true;
  if (u.startsWith("data:image/")) return true;
  return false;
}

export function sanitizeCssUrls(input: string) {
  const s = input || "";
  return s.replace(/url\s*\(\s*([^)]+)\s*\)/gi, (_m, raw) => {
    const cleaned = cleanUrlToken(String(raw || ""));
    if (!cleaned) return "url(\"\")";
    if (!isAllowedCssUrl(cleaned)) return "url(\"\")";
    const escaped = cleaned.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "").replaceAll("\r", "");
    return `url("${escaped}")`;
  });
}

export function filterEmailCss(input: string) {
  let css = input || "";
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  css = css.replace(/@import[^;]*;/gi, "");
  css = sanitizeCssUrls(css);
  css = css.replace(/expression\s*\(/gi, "");
  css = css.replace(/-moz-binding\s*:/gi, "");
  css = css.replace(/behavior\s*:/gi, "");
  css = css.replace(/(^|[,{]\s*)(html|body)\b/gi, "$1:host");
  return css.trim();
}

export function filterInlineStyle(input: string) {
  let v = input || "";
  v = sanitizeCssUrls(v);
  v = v.replace(/expression\s*\(/gi, "");
  v = v.replace(/-moz-binding\s*:/gi, "");
  v = v.replace(/behavior\s*:/gi, "");
  return v;
}

