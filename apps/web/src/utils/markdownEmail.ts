function escapeHtml(s: string) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function looksLikeMarkdown(text: string) {
  const t = (text || "").trim();
  if (!t) return false;
  if (/^#{1,6}\s+\S/m.test(t)) return true;
  if (/^\s*[-*+]\s+\S/m.test(t)) return true;
  if (/`{3,}/.test(t)) return true;
  if (/\[[^\]]+\]\([^)]+\)/.test(t)) return true;
  if (/\*\*[^*]+\*\*/.test(t)) return true;
  return false;
}

export function markdownToEmailHtml(markdown: string) {
  const src = (markdown || "").replaceAll("\r\n", "\n");
  const lines = src.split("\n");
  let i = 0;
  let out = "";

  function inline(md: string) {
    let s = escapeHtml(md);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `<a href="${escapeHtml(url)}">${label}</a>`);
    return s;
  }

  while (i < lines.length) {
    const line = lines[i] || "";

    const fence = line.match(/^\s*```(\w+)?\s*$/);
    if (fence) {
      const lang = fence[1] ? ` data-lang="${escapeHtml(fence[1])}"` : "";
      i += 1;
      let buf = "";
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i] || "")) {
        buf += (lines[i] || "") + "\n";
        i += 1;
      }
      i += 1;
      out += `<pre><code${lang}>${escapeHtml(buf)}</code></pre>`;
      continue;
    }

    const h = line.match(/^\s*(#{1,6})\s+(.+)\s*$/);
    if (h) {
      const level = h[1].length;
      out += `<h${level}>${inline(h[2])}</h${level}>`;
      i += 1;
      continue;
    }

    const li = line.match(/^\s*[-*+]\s+(.+)\s*$/);
    if (li) {
      let items = "";
      while (i < lines.length) {
        const m = (lines[i] || "").match(/^\s*[-*+]\s+(.+)\s*$/);
        if (!m) break;
        items += `<li>${inline(m[1])}</li>`;
        i += 1;
      }
      out += `<ul>${items}</ul>`;
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    let p = inline(line);
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !/^\s*#{1,6}\s+/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i])) {
      p += "<br/>" + inline(lines[i]);
      i += 1;
    }
    out += `<p>${p}</p>`;
  }

  const css = `
article{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji";font-size:14px;line-height:1.65;overflow-wrap:anywhere;word-break:break-word}
pre{padding:12px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);overflow:auto}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace}
ul{padding-left:1.25rem}
a{text-decoration:underline}
`;

  return `<style>${css}</style><article>${out}</article>`;
}

