import type { RedDotResponse } from "../types";
import { getLastSeen } from "./lastSeen";

export type MailSyncController = {
  start: () => void;
  stop: () => void;
};

export function createMailSyncController(params: {
  getToken?: () => string | null;
  getAddress: () => string;
  getIsVisible: () => boolean;
  apiJson: <T>(path: string, init?: RequestInit) => Promise<T>;
  onUnreadChange: (address: string, count: number) => void;
  onHint: () => void;
  onRefetchRequested: () => void;
}) {
  let stopped = true;
  let ws: WebSocket | null = null;
  let wsReady = false;
  let timer: number | null = null;
  let pollBackoffMs = 0;
  let wsBackoffMs = 0;
  let wsFailCount = 0;
  let wsNextAttemptAt = 0;
  let wsDisabledUntil = 0;
  let inflight = false;
  let queued = false;
  let lastRefetchAt = 0;
  let activeKey = "";

  const closeWs = () => {
    if (!ws) return;
    try {
      ws.close();
    } catch {}
    ws = null;
  };

  const baseInterval = () => {
    if (!params.getIsVisible()) return 20000;
    if (wsReady) return 30000;
    return 4000;
  };

  const schedule = (delayMs: number) => {
    if (stopped) return;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void tick();
    }, Math.max(delayMs, 0));
  };

  const poll = async (address: string) => {
    if (stopped) return;
    if (inflight) {
      queued = true;
      return;
    }
    inflight = true;

    const since = getLastSeen(address);
    try {
      const data = await params.apiJson<RedDotResponse>(`/api/user/red-dot?since=${encodeURIComponent(String(since))}`);
      pollBackoffMs = 0;
      params.onUnreadChange(address, data.newCount);
      if (data.newCount > 0 && params.getIsVisible()) {
        params.onHint();
        const now = Date.now();
        if (now - lastRefetchAt > 800) {
          lastRefetchAt = now;
          params.onRefetchRequested();
        }
      }
    } catch {
      pollBackoffMs = Math.min(pollBackoffMs ? pollBackoffMs * 2 : 1500, 30000);
    } finally {
      inflight = false;
      if (queued) {
        queued = false;
        void poll(address);
      }
    }
  };

  const wsUrlFor = () => {
    const protocol = typeof location !== "undefined" && location.protocol === "https:" ? "wss" : "ws";
    const host = typeof location !== "undefined" ? location.host : "";
    return `${protocol}://${host}/api/user/ws`;
  };

  const noteWsFailure = () => {
    const now = Date.now();
    wsReady = false;
    ws = null;
    wsFailCount += 1;
    wsBackoffMs = Math.min(wsBackoffMs ? wsBackoffMs * 2 : 1500, 30000);

    if (wsFailCount >= 6) {
      wsFailCount = 0;
      wsBackoffMs = 0;
      wsDisabledUntil = now + 60000;
      wsNextAttemptAt = wsDisabledUntil;
      return;
    }

    wsNextAttemptAt = now + wsBackoffMs;
  };

  const connectWs = () => {
    if (stopped || !params.getIsVisible()) return;
    if (ws) return;
    if (typeof WebSocket === "undefined") return;
    if (Date.now() < wsDisabledUntil) return;
    if (Date.now() < wsNextAttemptAt) return;

    try {
      ws = new WebSocket(wsUrlFor());
    } catch {
      noteWsFailure();
      schedule(baseInterval() + pollBackoffMs);
      return;
    }

    ws.onopen = () => {
      wsReady = true;
      wsBackoffMs = 0;
      wsFailCount = 0;
      wsNextAttemptAt = 0;
      wsDisabledUntil = 0;
      schedule(50);
    };
    ws.onmessage = (evt) => {
      if (typeof evt.data !== "string") return;
      if (evt.data === "pong") return;
      try {
        const msg = JSON.parse(evt.data) as { type?: string };
        if (msg?.type === "hint") {
          params.onHint();
          lastRefetchAt = Date.now();
          params.onRefetchRequested();
          schedule(120);
        }
      } catch {}
    };
    ws.onerror = () => {
      try {
        ws?.close();
      } catch {}
    };
    ws.onclose = () => {
      noteWsFailure();
      schedule(baseInterval() + pollBackoffMs);
    };
  };

  const resetForKey = (key: string) => {
    if (key === activeKey) return;
    activeKey = key;
    wsReady = false;
    pollBackoffMs = 0;
    wsBackoffMs = 0;
    wsFailCount = 0;
    wsNextAttemptAt = 0;
    wsDisabledUntil = 0;
    inflight = false;
    queued = false;
    lastRefetchAt = 0;
    closeWs();
    connectWs();
    schedule(80);
  };

  const tick = async () => {
    if (stopped) return;
    const address = params.getAddress();
    if (!address) {
      stop();
      return;
    }

    const token = params.getToken ? params.getToken() : null;
    resetForKey(`${address}|${token || ""}`);

    if (!params.getIsVisible()) {
      closeWs();
      wsReady = false;
    } else {
      connectWs();
    }

    await poll(address);
    schedule(baseInterval() + pollBackoffMs);
  };

  const start = () => {
    const address = params.getAddress();
    if (!address) return;
    if (stopped) {
      stopped = false;
      const token = params.getToken ? params.getToken() : null;
      resetForKey(`${address}|${token || ""}`);
      return;
    }
    schedule(50);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) window.clearTimeout(timer);
    timer = null;
    closeWs();
    wsReady = false;
  };

  return { start, stop } satisfies MailSyncController;
}
