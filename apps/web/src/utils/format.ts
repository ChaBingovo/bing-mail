export function formatTime(ts: number | undefined) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

