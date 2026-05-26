import { Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import { EmailList } from "./components/EmailList";
import { EmailViewer } from "./components/EmailViewer";
import { LoginCard } from "./components/LoginCard";
import { RegisterCard } from "./components/RegisterCard";
import { SetupView } from "./components/SetupView";
import { Sidebar } from "./components/Sidebar";
import { AdminSettingsView } from "./components/AdminSettingsView";
import { UserSettingsView } from "./components/UserSettingsView";
import { NotificationIsland } from "./components/NotificationIsland";
import type { NotificationIslandData } from "./components/NotificationIsland";
import { Spotlight } from "./components/Spotlight";
import type { SpotlightAction } from "./components/Spotlight";
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
        <div class="flex h-dvh w-full items-center justify-center p-6">
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

  const [spotlightOpen, setSpotlightOpen] = createSignal(false);
  const [displayAddress, setDisplayAddress] = createSignal("");

  const [island, setIsland] = createSignal<NotificationIslandData | null>(null);
  const [islandClosing, setIslandClosing] = createSignal(false);
  const [hintTick, setHintTick] = createSignal(0);
  let lastNotifiedId = "";
  let islandTimer: number | null = null;
  const closeIsland = () => {
    if (!island()) return;
    setIslandClosing(true);
    if (islandTimer) window.clearTimeout(islandTimer);
    islandTimer = window.setTimeout(() => {
      setIsland(null);
      setIslandClosing(false);
    }, 200);
  };

  const showIsland = (data: NotificationIslandData) => {
    setIslandClosing(false);
    setIsland(data);
    if (islandTimer) window.clearTimeout(islandTimer);
    islandTimer = window.setTimeout(() => closeIsland(), 5200);
  };

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
    if (!displayAddress()) setDisplayAddress(addr);
  });

  const [aliases] = createResource(
    () => app.token(),
    async (t) => {
      if (!t) return { mailbox: "", aliases: [] as string[] };
      const data = await app.api.apiJson<{ aliases: string[]; mailbox: string }>("/api/user/aliases");
      return { mailbox: data.mailbox || "", aliases: Array.isArray(data.aliases) ? data.aliases : [] };
    },
  );

  const activeOwnedAddress = createMemo(() => {
    if (app.page() !== "inbox") return "";
    return mailboxAddress() || "";
  });

  const currentUnseen = createMemo(() => {
    const addr = mailboxAddress() || "";
    if (!addr) return 0;
    return app.unseenByMailbox()[addr] ?? 0;
  });

  const [messages, { refetch: refetchMessages }] = createResource(() => mailboxAddress() || "", async (address) => {
    if (!address) return [];
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
    const addr = mailboxAddress() || "";
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
          setHintTick((n) => n + 1);
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
          if (msg?.type === "hint") {
            setHintTick((n) => n + 1);
            schedule(120);
            refetchMessages();
          }
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
    if (!island()) return;
    onCleanup(() => {
      if (islandTimer) window.clearTimeout(islandTimer);
      islandTimer = null;
    });
  });

  createEffect(() => {
    hintTick();
    const addr = mailboxAddress() || "";
    const list = messages() || [];
    if (!addr || list.length === 0) return;
    const since = getLastSeen(addr);
    const latestNew = list.find((m) => (m.receivedAt || 0) > since);
    if (!latestNew || latestNew.id === lastNotifiedId) return;
    lastNotifiedId = latestNew.id;
    showIsland({
      title: "新邮件到达",
      subtitle: latestNew.subject || latestNew.fromName || latestNew.fromAddress || "",
      service: latestNew.aiService,
      code: latestNew.aiCode,
    });
  });

  createEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== "k") return;
      const el = document.activeElement as HTMLElement | null;
      const tag = (el?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || (el as any)?.isContentEditable) return;
      e.preventDefault();
      setSpotlightOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  const getSpotlightActions = (q: string): SpotlightAction[] => {
    const query = (q || "").trim().toLowerCase();
    const actions: SpotlightAction[] = [];

    actions.push({
      key: "nav-inbox",
      title: "收件箱",
      subtitle: "跳转到收件箱",
      right: "↩",
      onPick: () => app.setPage("inbox"),
    });
    actions.push({
      key: "nav-settings",
      title: "账户设置",
      subtitle: "跳转到账户设置",
      onPick: () => app.setPage("settings"),
    });
    if (app.currentUser()?.isAdmin) {
      actions.push({
        key: "nav-admin",
        title: "管理员设置",
        subtitle: "跳转到管理员设置",
        onPick: () => app.setPage("admin"),
      });
    }

    const mailbox = mailboxAddress() || "";
    const aliasList = aliases()?.aliases || [];
    const addrItems = [mailbox, ...aliasList].filter(Boolean);
    addrItems.forEach((a) => {
      actions.push({
        key: `addr-${a}`,
        title: a,
        subtitle: "切换显示邮箱地址",
        right: a === displayAddress() ? "当前" : "",
        onPick: () => setDisplayAddress(a),
      });
    });

    const list = messages() || [];
    const filtered =
      query.length === 0
        ? []
        : list
            .filter((m) => {
              const s = `${m.subject || ""} ${m.fromName || ""} ${m.fromAddress || ""} ${m.snippet || ""} ${
                m.aiCode || ""
              } ${m.aiService || ""}`.toLowerCase();
              return s.includes(query);
            })
            .slice(0, 10);
    filtered.forEach((m) => {
      actions.push({
        key: `msg-${m.id}`,
        title: m.subject || "(无主题)",
        subtitle: m.fromName || m.fromAddress || "",
        right: "打开",
        onPick: () => {
          app.setPage("inbox");
          app.setSelectedId(m.id);
        },
      });
    });

    if (!query) return actions;
    return actions.filter((a) => `${a.title} ${a.subtitle || ""}`.toLowerCase().includes(query));
  };

  const sidebar = () => (
    <Sidebar
      user={app.currentUser()!}
      page={app.page()}
      setPage={app.setPage}
      activeAddress={displayAddress() || mailboxAddress() || ""}
      currentUnseen={currentUnseen()}
      onRefresh={() => refetchMessages()}
      onLogout={() => app.logout()}
      onOpenSpotlight={() => setSpotlightOpen(true)}
    />
  );

  return (
    <div class="relative h-dvh w-full overflow-hidden p-4">
      <Show when={island()}>
        <NotificationIsland data={island()!} closing={islandClosing()} onClose={closeIsland} />
      </Show>
      <Spotlight open={spotlightOpen()} onClose={() => setSpotlightOpen(false)} getActions={getSpotlightActions} />

      <div class="glass-panel h-full overflow-hidden rounded-[28px]">
        <Show
          when={app.page() === "inbox"}
          fallback={
            <div class="grid h-full grid-cols-[280px_1fr] gap-0">
              {sidebar()}
              <Show when={app.page() === "settings"}>
                <UserSettingsView user={app.currentUser()!} api={app.api} />
              </Show>
              <Show when={app.page() === "admin"}>
                <AdminSettingsView api={app.api} />
              </Show>
            </div>
          }
        >
          <div class="grid h-full grid-cols-[280px_440px_1fr] gap-0">
            {sidebar()}

            <EmailList
              mailboxAddress={displayAddress() || activeOwnedAddress()}
              messages={messages() || []}
              loading={messages.state !== "ready"}
              selectedId={selectedId()}
              setSelectedId={(id) => app.setSelectedId(id)}
            />

            <EmailViewer detail={detail() || null} html={html() || ""} />
          </div>
        </Show>
      </div>
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
