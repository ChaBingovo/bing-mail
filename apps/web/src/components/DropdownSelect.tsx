import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

export type DropdownSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function DropdownSelect(props: {
  value: string;
  options: DropdownSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  wrapperClass?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  let rootEl: HTMLDivElement | undefined;

  const selectedLabel = createMemo(() => {
    const v = props.value ?? "";
    const hit = props.options.find((o) => o.value === v);
    return hit?.label ?? "";
  });

  const close = () => setOpen(false);
  const toggle = () => {
    if (props.disabled) return;
    setOpen((v) => !v);
  };

  createEffect(() => {
    if (!open()) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (!rootEl) return;
      if (!rootEl.contains(target)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  const pick = (opt: DropdownSelectOption) => {
    if (opt.disabled) return;
    props.onChange(opt.value);
    close();
  };

  return (
    <div ref={(el) => (rootEl = el)} class={props.wrapperClass || "relative"}>
      <div
        role="button"
        tabindex={props.disabled ? -1 : 0}
        class={`select-control flex items-center justify-between gap-2 ${props.class || ""} ${
          props.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        }`}
        onClick={toggle}
        onKeyDown={(e) => {
          if (props.disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            return;
          }
        }}
      >
        <Show when={props.value} fallback={<span class="text-zinc-500">{props.placeholder || "请选择"}</span>}>
          <span class="truncate">{selectedLabel()}</span>
        </Show>
      </div>

      <Show when={open()}>
        <ul class="glass-panel-sm absolute left-0 right-0 z-50 mt-2 max-h-64 overflow-auto rounded-2xl py-1 shadow-glassSm">
          <For each={props.options}>
            {(opt) => (
              <li>
                <button
                  type="button"
                  disabled={Boolean(opt.disabled)}
                  class={`spring-colors flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm ${
                    opt.disabled ? "cursor-not-allowed text-zinc-600" : "text-zinc-200 hover:bg-white/10"
                  } ${opt.value === props.value ? "bg-white/10" : ""}`}
                  onClick={() => pick(opt)}
                >
                  <span class="min-w-0 flex-1 truncate">{opt.label}</span>
                  <Show when={opt.value === props.value}>
                    <span class="text-xs font-semibold text-zinc-400">✓</span>
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
