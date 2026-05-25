export function getString(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setString(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function removeKey(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

export function getJson<T>(key: string): T | null {
  const raw = getString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setJson(key: string, value: unknown) {
  setString(key, JSON.stringify(value));
}

