function lastSeenKey(address: string) {
  return `bingmail.lastSeen.${address}`;
}

export function getLastSeen(address: string) {
  try {
    if (typeof localStorage === "undefined") return 0;
    return Math.max(Number(localStorage.getItem(lastSeenKey(address)) || "0") || 0, 0);
  } catch {
    return 0;
  }
}

export function setLastSeen(address: string, ts: number) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(lastSeenKey(address), String(Math.max(ts || 0, 0)));
  } catch {}
}

