import { Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import { EmailList } from "./components/EmailList";
import { EmailViewer } from "./components/EmailViewer";
import { LoginCard } from "./components/LoginCard";
import { RegisterCard } from "./components/RegisterCard";
import { SetupView } from "./components/SetupView";
import { Sidebar } from "./components/Sidebar";
import { AdminSettingsView } from "./components/AdminSettingsView";
import { UserSettingsView } from "./components/UserSettingsView";
import { AppProvider, useApp } from "./context/AppContext";
import { VisibilityProvider, useVisibility } from "./context/VisibilityContext";
import type { AuthUser, MessageDetail, MessageMeta, RedDotResponse } from "./types";

function lastSeenKey(address: string) {
  return `bingmail.lastSeen.${address}`;
}

function getLastSeen(address: string) {
  return Math.max(Number(localStorage.getItem(lastSeenKey(address)) || "0") || 0, 0);
}

function setLastSeen(address: string, ts: number) {
  localStorage.setItem(lastSeenKey(address), String(Math.max(ts || 0, 0)));
}

function GuestView() {
  const app = useApp();
  const [tab, setTab] = createSignal<"login" | "register">("login");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  const [setup] = createResource(async () => {
    try {
      const res = await fetch("/api/setup/status");
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { initialized: boolean; allowRegister: boolean };
    } catch {
      return { initialized: true, allowRegister: false };
    }
  });

  createEffect(() => {
    if (tab() !== "register") return;
    if (setup()?.allowRegister) return;
    setTab("login");
  });

  const [domains] = createResource(async () => {
    try {
      const res = await fetch("/api/domains");
      if (!res.ok) return [] as string[];
      const data = (await res.json()) as { domains: string[] };
      return Array.isArray(data.domains) ? data.domains : [];
    } catch {
      return [] as string[];
    }
  });

  const login = async (username: string, password: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await app.api.apiJson<{ user: AuthUser; token: string }>("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      app.login(data.user, data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  const register = async (username: string, password: string, mailboxLocal: string, domain: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await app.api.apiJson<{ user: AuthUser; token: string }>("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, mailboxLocal, domain }),
      });
      app.login(data.user, data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Show
      when={setup.state === "ready" && setup()?.initialized === false}
      fallback={
        <div class="flex h-dvh w-full items-center justify-center bg-zinc-950 p-6">
          <Show
            when={tab() === "login"}
            fallback={
              <RegisterCard
                onRegister={register}
                domains={domains() || []}
                onGoLogin={() => setTab("login")}
                loading={loading()}
                error={error()}
              />
            }
          >
            <LoginCard
              onLogin={login}
              showRegister={Boolean(setup()?.allowRegister)}
              onGoRegister={() => setTab("register")}
              loading={loading()}
              error={error()}
            />
          </Show>
        </div>
      }
    >
      <SetupView onInitialized={(user, token) => app.login(user, token)} />
    </Show>
  );
}

function ConsoleView() {
  const app = useApp();
  const { isVisible } = useVisibility();

  const [mailboxAddress] = createResource(
    () => app.token(),
    async (t) => {
      if (!t) return null;
      const data = await app.api.apiJson<{ address: string | null }>("/api/user/mailbox");
      return data.address;
    },
  );

  createEffect(() => {
    const addr = mailboxAddress();
    if (!addr) return;
    if (app.activeAddress() !== addr) app.setActiveAddress(addr);
  });

  const activeOwnedAddress = createMemo(() => {
    if (app.page() !== "inbox") return "";
    return mailboxAddress() || "";
  });

  const currentUnseen = createMemo(() => {
    const addr = activeOwnedAddress();
    if (!addr) return 0;
    return app.unseenByMailbox()[addr] ?? 0;
  });

  const [messages, { refetch: refetchMessages }] = createResource(activeOwnedAddress, async (address) => {
    if (!address || app.page() !== "inbox") return [];
    const data = await app.api.apiJson<{ messages: MessageMeta[] }>("/api/user/messages?limit=100");
    return data.messages;
  });

  const selectedId = createMemo(() => {
    if (app.page() !== "inbox") return null;
    if (!activeOwnedAddress()) return null;
    return app.selectedId();
  });

  const [detail] = createResource(selectedId, async (id) => {
    if (!id || app.page() !== "inbox") return null;
    const data = await app.api.apiJson<{ message: MessageDetail }>(`/api/messages/${encodeURIComponent(id)}`);
    return data.message;
  });

  const [html] = createResource(selectedId, async (id) => {
    if (!id || app.page() !== "inbox") return "";
    return app.api.apiText(`/api/messages/${encodeURIComponent(id)}/html`);
  });

  createEffect(() => {
    if (app.page() !== "inbox") return;
    const addr = activeOwnedAddress();
    const list = messages() || [];
    if (!addr || !isVisible() || list.length === 0) return;
    const max = list.reduce((acc, m) => Math.max(acc, m.receivedAt || 0), 0);
    if (!max) return;
    if (max > getLastSeen(addr)) setLastSeen(addr, max);
    app.setUnseen(addr, 0);
  });

  createEffect(() => {
    if (app.page() !== "inbox") return;
    const addr = activeOwnedAddress();
    if (!addr) return;

    let stopped = false;
    let ws: WebSocket | null = null;
    let wsReady = false;
    let timer: number | null = null;
    let backoffMs = 0;
    let inflight = false;
    let queued = false;
    let lastRefetchAt = 0;

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const t = app.token() || "";
    const wsUrl = `${protocol}://${location.host}/api/user/ws?token=${encodeURIComponent(t)}`;

    const baseInterval = () => {
      if (!isVisible()) return 20000;
      if (wsReady) return 30000;
      return 4000;
    };

    const schedule = (delayMs: number) => {
      if (stopped) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void poll();
      }, Math.max(delayMs, 0));
    };

    const poll = async () => {
      if (stopped) return;
      if (inflight) {
        queued = true;
        return;
      }
      inflight = true;

      const since = getLastSeen(addr);
      try {
        const data = await app.api.apiJson<RedDotResponse>(
          `/api/user/red-dot?since=${encodeURIComponent(String(since))}`,
        );
        backoffMs = 0;
        app.setUnseen(addr, data.newCount);
        if (data.newCount > 0 && isVisible()) {
          const now = Date.now();
          if (now - lastRefetchAt > 800) {
            lastRefetchAt = now;
            refetchMessages();
          }
        }
      } catch {
        backoffMs = Math.min(backoffMs ? backoffMs * 2 : 1500, 30000);
      } finally {
        inflight = false;
        if (queued) {
          queued = false;
          void poll();
          return;
        }
        schedule(baseInterval() + backoffMs);
      }
    };

    const connectWs = () => {
      if (stopped || !isVisible()) return;
      if (ws) return;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        ws = null;
        schedule(baseInterval() + 1500);
        return;
      }

      ws.onopen = () => {
        wsReady = true;
        backoffMs = 0;
        schedule(50);
      };
      ws.onmessage = (evt) => {
        if (typeof evt.data !== "string") return;
        if (evt.data === "pong") return;
        try {
          const msg = JSON.parse(evt.data) as { type?: string };
          if (msg?.type === "hint") schedule(120);
        } catch {}
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {}
      };
      ws.onclose = () => {
        wsReady = false;
        ws = null;
        backoffMs = Math.min(backoffMs ? backoffMs * 2 : 1500, 30000);
        schedule(baseInterval() + backoffMs);
      };
    };

    connectWs();
    schedule(80);

    createEffect(() => {
      const visible = isVisible();
      if (!visible) {
        try {
          ws?.close();
        } catch {}
        ws = null;
        wsReady = false;
        schedule(baseInterval());
        return;
      }
      connectWs();
      schedule(50);
    });

    onCleanup(() => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      try {
        ws?.close();
      } catch {}
      ws = null;
    });
  });

  createEffect(() => {
    const addr = mailboxAddress() || "";
    const targets = addr ? [addr] : [];
    if (app.page() !== "inbox" || !isVisible() || targets.length === 0) return;

    let stopped = false;
    let timer: number | null = null;
    let backoffMs = 0;

    const tick = async () => {
      if (stopped) return;
      try {
        await Promise.all(
          targets.map(async (addr) => {
            const since = getLastSeen(addr);
            const data = await app.api.apiJson<RedDotResponse>(
              `/api/user/red-dot?since=${encodeURIComponent(String(since))}`,
            );
            app.setUnseen(addr, data.newCount);
          }),
        );
        backoffMs = 0;
      } catch {
        backoffMs = Math.min(backoffMs ? backoffMs * 2 : 2000, 30000);
      } finally {
        if (stopped) return;
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(tick, 20000 + backoffMs);
      }
    };

    void tick();

    onCleanup(() => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    });
  });

  return (
    <div class="h-dvh w-full overflow-hidden">
      <Show
        when={app.page() === "inbox"}
        fallback={
          <div class="grid h-full grid-cols-[260px_1fr] gap-0 border-zinc-800">
            <Sidebar
              user={app.currentUser()!}
              page={app.page()}
              setPage={app.setPage}
              currentUnseen={currentUnseen()}
              onRefresh={() => refetchMessages()}
              onLogout={() => app.logout()}
            />
            <Show when={app.page() === "settings"}>
              <UserSettingsView user={app.currentUser()!} api={app.api} />
            </Show>
            <Show when={app.page() === "admin"}>
              <AdminSettingsView api={app.api} />
            </Show>
          </div>
        }
      >
        <div class="grid h-full grid-cols-[260px_420px_1fr] gap-0 border-zinc-800">
          <Sidebar
            user={app.currentUser()!}
            page={app.page()}
            setPage={app.setPage}
            currentUnseen={currentUnseen()}
            onRefresh={() => refetchMessages()}
            onLogout={() => app.logout()}
          />

          <EmailList
            mailboxAddress={activeOwnedAddress()}
            messages={messages() || []}
            loading={messages.state !== "ready"}
            selectedId={selectedId()}
            setSelectedId={(id) => app.setSelectedId(id)}
          />

          <EmailViewer detail={detail() || null} html={html() || ""} />
        </div>
      </Show>
    </div>
  );
}

function Root() {
  const app = useApp();
  return <Show when={app.mode() === "user"} fallback={<GuestView />}><ConsoleView /></Show>;
}

export default function App() {
  return (
    <AppProvider>
      <VisibilityProvider>
        <Root />
      </VisibilityProvider>
    </AppProvider>
  );
}
