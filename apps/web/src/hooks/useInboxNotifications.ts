import { createEffect, createSignal, onCleanup } from "solid-js";
import type { NotificationIslandData } from "../components/NotificationIsland";
import type { MessageMeta } from "../types";
import { getLastSeen } from "../services/lastSeen";

export function useInboxNotifications(params: { mailboxAddress: () => string; messages: () => MessageMeta[] }) {
  const [hintTick, setHintTick] = createSignal(0);

  const [island, setIsland] = createSignal<NotificationIslandData | null>(null);
  const [islandClosing, setIslandClosing] = createSignal(false);
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

  const bumpHint = () => setHintTick((n) => n + 1);

  createEffect(() => {
    if (!island()) return;
    onCleanup(() => {
      if (islandTimer) window.clearTimeout(islandTimer);
      islandTimer = null;
    });
  });

  createEffect(() => {
    hintTick();
    const addr = params.mailboxAddress() || "";
    const list = params.messages() || [];
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

  return {
    island,
    islandClosing,
    closeIsland,
    bumpHint,
  };
}

