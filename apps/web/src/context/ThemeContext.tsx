import { createContext, createEffect, createMemo, createSignal, onCleanup, useContext } from "solid-js";
import { getString, setString } from "../services/storage";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const THEME_KEY = "bingmail.theme";

export function parseThemeMode(raw: string | null | undefined): ThemeMode {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

export function resolveTheme(mode: ThemeMode, prefersLight: boolean): ResolvedTheme {
  if (mode === "light" || mode === "dark") return mode;
  return prefersLight ? "light" : "dark";
}

export function nextThemeMode(current: ThemeMode): ThemeMode {
  if (current === "system") return "light";
  if (current === "light") return "dark";
  return "system";
}

export function applyDocumentTheme(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("light", resolved === "light");
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = resolved;
}

type ThemeContextValue = {
  mode: () => ThemeMode;
  setMode: (mode: ThemeMode) => void;
  resolvedTheme: () => ResolvedTheme;
};

const ThemeCtx = createContext<ThemeContextValue>();

export function ThemeProvider(props: { children: any }) {
  const [mode, _setMode] = createSignal<ThemeMode>(parseThemeMode(getString(THEME_KEY)));
  const getSystemPrefersLight = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches;

  const [prefersLight, setPrefersLight] = createSignal<boolean>(getSystemPrefersLight());

  createEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (e: MediaQueryListEvent) => setPrefersLight(e.matches);
    setPrefersLight(mq.matches);
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      onCleanup(() => mq.removeEventListener("change", onChange));
    } else if (typeof mq.addListener === "function") {
      mq.addListener(onChange);
      onCleanup(() => mq.removeListener(onChange));
    }
  });

  const resolvedTheme = createMemo<ResolvedTheme>(() => resolveTheme(mode(), prefersLight()));

  createEffect(() => {
    applyDocumentTheme(resolvedTheme());
  });

  const setMode = (next: ThemeMode) => {
    _setMode(next);
    setString(THEME_KEY, next);
  };

  return (
    <ThemeCtx.Provider value={{ mode, setMode, resolvedTheme }}>
      {props.children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) {
    return {
      mode: () => "system" as ThemeMode,
      setMode: () => {},
      resolvedTheme: () => "dark" as ResolvedTheme,
    };
  }
  return ctx;
}
