import type { RedDotResponse } from "../types";
import { getLastSeen } from "./lastSeen";

export type MailSyncController = {
  start: () => void;
  stop: () => void;
};

export function createMailSyncController(params: {
  getToken: () => string | null;
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
  let backoffMs = 0;
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
      backoffMs = 0;
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
      backoffMs = Math.min(backoffMs ? backoffMs * 2 : 1500, 30000);
    } finally {
      inflight = false;
      if (queued) {
        queued = false;
        void poll(address);
      }
    }
  };

  const wsUrlFor = (token: string) => {
    const protocol = typeof location !== "undefined" && location.protocol === "https:" ? "wss" : "ws";
    const host = typeof location !== "undefined" ? location.host : "";
    return `${protocol}://${host}/api/user/ws?token=${encodeURIComponent(token)}`;
  };

  const connectWs = () => {
    if (stopped || !params.getIsVisible()) return;
    if (ws) return;
    const token = params.getToken();
    if (!token) return;
    if (typeof WebSocket === "undefined") return;

    try {
      ws = new WebSocket(wsUrlFor(token));
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
      wsReady = false;
      ws = null;
      backoffMs = Math.min(backoffMs ? backoffMs * 2 : 1500, 30000);
      schedule(baseInterval() + backoffMs);
    };
  };

  const resetForKey = (key: string) => {
    if (key === activeKey) return;
    activeKey = key;
    wsReady = false;
    backoffMs = 0;
    inflight = false;
    queued = false;
    lastRefetchAt = 0;
    closeWs();
    connectWs();
    schedule(80);
  };

  const tick = async () => {
    if (stopped) return;
    const token = params.getToken();
    const address = params.getAddress();
    if (!token || !address) {
      stop();
      return;
    }

    resetForKey(`${address}|${token}`);

    if (!params.getIsVisible()) {
      closeWs();
      wsReady = false;
    } else {
      connectWs();
    }

    await poll(address);
    schedule(baseInterval() + backoffMs);
  };

  const start = () => {
    const token = params.getToken();
    const address = params.getAddress();
    if (!token || !address) return;
    if (stopped) {
      stopped = false;
      resetForKey(`${address}|${token}`);
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
