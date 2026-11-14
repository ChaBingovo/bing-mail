import { Show, createMemo } from "solid-js";
import { nextThemeMode, useTheme } from "../context/ThemeContext";

const LABELS = {
  system: "跟随系统",
  light: "浅色模式",
  dark: "深色模式",
} as const;

export function ThemeSwitcher() {
  const theme = useTheme();
  const label = createMemo(() => LABELS[theme.mode()]);
  const nextLabel = createMemo(() => LABELS[nextThemeMode(theme.mode())]);

  return (
    <button
      type="button"
      title={`当前：${label()}（点击切换为${nextLabel()}）`}
      aria-label={`当前：${label()}，点击切换为${nextLabel()}`}
      class="pressable spring-colors flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
      onClick={() => theme.setMode(nextThemeMode(theme.mode()))}
    >
      <Show when={theme.mode() === "system"}>
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <rect x="3" y="4" width="18" height="12" rx="2.5" />
          <path stroke-linecap="round" d="M9 20h6M12 16v4" />
        </svg>
      </Show>
      <Show when={theme.mode() === "light"}>
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="3.5" />
          <path
            stroke-linecap="round"
            d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"
          />
        </svg>
      </Show>
      <Show when={theme.mode() === "dark"}>
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M20.2 14.5A8.5 8.5 0 0 1 9.5 3.8a8.5 8.5 0 1 0 10.7 10.7Z"
          />
        </svg>
      </Show>
    </button>
  );
}
