import DOMPurify from "dompurify";
import { createEffect } from "solid-js";

export function ShadowHtml(props: { html: string }) {
  let host!: HTMLDivElement;
  let root: ShadowRoot | null = null;

  createEffect(() => {
    const value = props.html || "";
    if (!root) root = host.attachShadow({ mode: "open" });
    const safe = DOMPurify.sanitize(value, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "style", "link", "meta"],
      FORBID_ATTR: ["onload", "onclick", "onerror"],
    });
    root.innerHTML = safe;
  });

  return <div ref={host} class="h-full w-full overflow-auto rounded-lg bg-white/5" />;
}

