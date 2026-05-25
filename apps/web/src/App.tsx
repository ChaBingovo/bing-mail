import { Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import { EmailList } from "./components/EmailList";
import { EmailViewer } from "./components/EmailViewer";
import { LoginCard } from "./components/LoginCard";
import { RegisterCard } from "./components/RegisterCard";
import { Sidebar } from "./components/Sidebar";
import { AppProvider, useApp } from "./context/AppContext";
import { VisibilityProvider, useVisibility } from "./context/VisibilityContext";
import type { MessageDetail, MessageMeta, RedDotResponse } from "./types";

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

  const login = async (username: string, password: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await app.api.apiJson<{ user: { id: string; username: string }; token: string }>("/api/auth/login", {
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

  const register = async (username: string, password: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await app.api.apiJson<{ user: { id: string; username: string }; token: string }>(
        "/api/auth/register",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username, password }),
        },
      );
      app.login(data.user, data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="flex h-dvh w-full items-center justify-center bg-zinc-950 p-6">
      <Show
        when={tab() === "login"}
        fallback={<RegisterCard onRegister={register} onGoLogin={() => setTab("login")} loading={loading()} error={error()} />}
      >
        <LoginCard
          onLogin={login}
          onGoRegister={() => setTab("register")}
          onEnterAnon={() => app.enterAnon()}
          loading={loading()}
          error={error()}
        />
      </Show>
    </div>
  );
}

function ConsoleView(props: { mode: "anon" | "user" }) {
  const app = useApp();
  const { isVisible } = useVisibility();

  const currentUnseen = createMemo(() => {
    const addr = app.activeAddress();
    if (!addr) return 0;
    return app.unseenByMailbox()[addr] ?? 0;
  });

  const [publicMailboxes] = createResource(async () => {
    try {
      const data = await app.api.apiJson<{ mailboxes: string[] }>("/api/mailboxes");
      return data.mailboxes;
    } catch {
      return [];
    }
  });

  const [userMailboxes, { refetch: refetchUserMailboxes }] = createResource(
    () => (app.mode() === "user" ? app.token() : null),
    async (t) => {
      if (!t) return [];
      const data = await app.api.apiJson<{ mailboxes: string[] }>("/api/user/mailboxes");
      return data.mailboxes;
    },
  );

  const [messages, { refetch: refetchMessages }] = createResource(app.activeAddress, async (address) => {
    if (!address) return [];
    const data = await app.api.apiJson<{ messages: MessageMeta[] }>(
      `/api/mailboxes/${encodeURIComponent(address)}/messages?limit=100`,
    );
    return data.messages;
  });

  const [detail] = createResource(app.selectedId, async (id) => {
    if (!id) return null;
    const data = await app.api.apiJson<{ message: MessageDetail }>(`/api/messages/${encodeURIComponent(id)}`);
    return data.message;
  });

  const [html] = createResource(app.selectedId, async (id) => {
    if (!id) return "";
    return app.api.apiText(`/api/messages/${encodeURIComponent(id)}/html`);
  });

  const setModeDefaults = () => {
    const m = app.mode();
    const userId = app.currentUser()?.id || "unknown";
    const mailboxKey = m === "user" ? `bingmail.mailbox.user.${userId}` : "bingmail.mailbox";
    const selectedKey = m === "user" ? `bingmail.selected.user.${userId}` : "bingmail.selected";
    const savedMailbox = localStorage.getItem(mailboxKey) || "";
    const savedSelected = localStorage.getItem(selectedKey) || "";
    if (savedMailbox) app.setActiveAddress(savedMailbox);
    if (savedSelected) app.setSelectedId(savedSelected || null);
  };

  createEffect(() => {
    setModeDefaults();
  });

  createEffect(() => {
    const addr = app.activeAddress();
    const list = messages() || [];
    if (!addr || !isVisible() || list.length === 0) return;
    const max = list.reduce((acc, m) => Math.max(acc, m.receivedAt || 0), 0);
    if (!max) return;
    if (max > getLastSeen(addr)) setLastSeen(addr, max);
    app.setUnseen(addr, 0);
  });

  createEffect(() => {
    const addr = app.activeAddress();
    if (!addr) return;
    if (app.mode() === "guest") return;

    let stopped = false;
    let ws: WebSocket | null = null;
    let wsReady = false;
    let timer: number | null = null;
    let backoffMs = 0;
    let inflight = false;
    let queued = false;
    let lastRefetchAt = 0;

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${protocol}://${location.host}/api/ws/mailboxes/${encodeURIComponent(addr)}`;

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
          `/api/mailboxes/${encodeURIComponent(addr)}/red-dot?since=${encodeURIComponent(String(since))}`,
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
    const publicList = publicMailboxes() || [];
    const mine = userMailboxes() || [];
    const list = app.mode() === "user" ? [...mine, ...publicList] : publicList;
    const targets = Array.from(new Set(list)).slice(0, 10);
    if (!isVisible() || targets.length === 0) return;

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
              `/api/mailboxes/${encodeURIComponent(addr)}/red-dot?since=${encodeURIComponent(String(since))}`,
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

  const onBindToUser = async (address: string) => {
    const addr = (address || "").trim().toLowerCase();
    if (!addr) return;
    await app.api.apiJson("/api/user/mailboxes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: addr }),
    });
    refetchUserMailboxes();
  };

  const onUnbindFromUser = async (address: string) => {
    const addr = (address || "").trim().toLowerCase();
    if (!addr) return;
    await app.api.apiText(`/api/user/mailboxes/${encodeURIComponent(addr)}`, { method: "DELETE" });
    refetchUserMailboxes();
  };

  createEffect(() => {
    if (app.mode() !== "user") return;
    const list = userMailboxes() || [];
    if (app.activeAddress()) return;
    if (list.length > 0) app.setActiveAddress(list[0]);
  });

  return (
    <div class="h-dvh w-full overflow-hidden">
      <div class="grid h-full grid-cols-[260px_420px_1fr] gap-0 border-zinc-800">
        <Sidebar
          mode={props.mode}
          user={app.currentUser()}
          activeAddress={app.activeAddress()}
          setActiveAddress={app.setActiveAddress}
          currentUnseen={currentUnseen()}
          unseenByMailbox={app.unseenByMailbox()}
          onRefresh={() => refetchMessages()}
          userMailboxes={userMailboxes() || []}
          publicMailboxes={publicMailboxes() || []}
          onBindToUser={onBindToUser}
          onUnbindFromUser={onUnbindFromUser}
          onLogout={() => app.logout()}
        />

        <EmailList
          mailboxAddress={app.activeAddress()}
          messages={messages() || []}
          loading={messages.state !== "ready"}
          selectedId={app.selectedId()}
          setSelectedId={(id) => app.setSelectedId(id)}
        />

        <EmailViewer detail={detail() || null} html={html() || ""} />
      </div>
    </div>
  );
}

function Root() {
  const app = useApp();
  return (
    <Show when={app.mode() !== "guest"} fallback={<GuestView />}>
      <Show when={app.mode() === "user"} fallback={<ConsoleView mode="anon" />}>
        <ConsoleView mode="user" />
      </Show>
    </Show>
  );
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
