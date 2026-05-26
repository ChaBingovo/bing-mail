import { Show, createSignal } from "solid-js";

function toneFromService(service?: string | null) {
  const s = (service || "").toLowerCase();
  if (s.includes("github")) return { bg: "bg-slate-500/15", text: "text-slate-200", ring: "ring-slate-400/30" };
  if (s.includes("google") || s.includes("gmail"))
    return { bg: "bg-rose-500/15", text: "text-rose-200", ring: "ring-rose-400/30" };
  if (s.includes("apple") || s.includes("icloud"))
    return { bg: "bg-zinc-500/15", text: "text-zinc-200", ring: "ring-zinc-300/30" };
  if (s.includes("microsoft") || s.includes("outlook"))
    return { bg: "bg-sky-500/15", text: "text-sky-200", ring: "ring-sky-400/30" };
  if (s.includes("amazon") || s.includes("aws"))
    return { bg: "bg-amber-500/15", text: "text-amber-200", ring: "ring-amber-400/30" };
  if (s.includes("discord")) return { bg: "bg-indigo-500/15", text: "text-indigo-200", ring: "ring-indigo-400/30" };
  return { bg: "bg-indigo-500/15", text: "text-indigo-200", ring: "ring-indigo-400/30" };
}

export function AiCodeCard(props: { code: string; service?: string | null; size?: "sm" | "md" }) {
  const [copied, setCopied] = createSignal(false);

  const tone = () => toneFromService(props.service);
  const size = () => (props.size === "sm" ? "text-xs px-2.5 py-1" : "text-sm px-3 py-1.5");

  const copy = async () => {
    const v = props.code || "";
    if (!v) return;
    try {
      await navigator.clipboard?.writeText(v);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 900);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      class={`group relative inline-flex items-center gap-2 rounded-xl border border-white/10 ${tone().bg} ${size()} font-semibold ${tone().text} ring-1 ring-transparent transition-[transform,box-shadow,background-color] duration-200 ease-spring hover:-translate-y-0.5 hover:shadow-glassSm active:translate-y-0 active:scale-[0.985] active:shadow-none`}
      classList={{ [`${tone().ring}`]: copied(), "animate-pulse-ring": copied() }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void copy();
      }}
    >
      <Show when={props.service}>
        <span class="max-w-[12ch] truncate rounded-lg bg-white/5 px-2 py-0.5 text-[0.72em] font-semibold text-zinc-100/90">
          {props.service}
        </span>
      </Show>
      <span class="tracking-wider">{props.code}</span>
      <Show when={copied()}>
        <span class="text-[0.72em] font-semibold text-emerald-200">已复制</span>
      </Show>
    </button>
  );
}

