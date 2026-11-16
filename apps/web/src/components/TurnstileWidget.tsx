import { Show, createEffect, createSignal, onCleanup } from "solid-js";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: "light" | "dark" | "auto";
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstileScript(): Promise<TurnstileApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("turnstile_unavailable"));
  }
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
    );
    const finish = () => {
      if (window.turnstile) resolve(window.turnstile);
      else {
        scriptPromise = null;
        reject(new Error("turnstile_load_failed"));
      }
    };
    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener(
        "error",
        () => {
          scriptPromise = null;
          reject(new Error("turnstile_load_failed"));
        },
        { once: true },
      );
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = finish;
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("turnstile_load_failed"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function TurnstileWidget(props: {
  siteKey: string;
  theme?: "light" | "dark" | "auto";
  resetNonce?: number;
  onToken: (token: string) => void;
}) {
  let containerRef: HTMLDivElement | undefined;
  let widgetId: string | null = null;
  let lastResetNonce = props.resetNonce ?? 0;
  const [loadError, setLoadError] = createSignal(false);

  createEffect(() => {
    const siteKey = (props.siteKey || "").trim();
    const theme = props.theme ?? "auto";
    if (!siteKey || !containerRef) return;

    let cancelled = false;
    setLoadError(false);
    props.onToken("");

    void loadTurnstileScript()
      .then((api) => {
        if (cancelled || !containerRef) return;
        if (widgetId) {
          try {
            api.remove(widgetId);
          } catch {}
          widgetId = null;
        }
        widgetId = api.render(containerRef, {
          sitekey: siteKey,
          theme,
          callback: (token) => props.onToken(token),
          "expired-callback": () => props.onToken(""),
          "error-callback": () => props.onToken(""),
        });
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    onCleanup(() => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {}
        widgetId = null;
      }
    });
  });

  createEffect(() => {
    const nonce = props.resetNonce ?? 0;
    if (nonce === lastResetNonce) return;
    lastResetNonce = nonce;
    props.onToken("");
    if (widgetId && window.turnstile) {
      try {
        window.turnstile.reset(widgetId);
      } catch {}
    }
  });

  return (
    <div class="space-y-1">
      <div ref={(el) => (containerRef = el)} class="min-h-[65px]" />
      <Show when={loadError()}>
        <div class="text-[11px] text-rose-300">人机验证组件加载失败，请检查网络或刷新重试</div>
      </Show>
    </div>
  );
}
