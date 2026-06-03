export type ApiClient = {
  apiJson<T>(path: string, init?: RequestInit): Promise<T>;
  apiText(path: string, init?: RequestInit): Promise<string>;
};

export function createApiClient(getToken: () => string | null, onUnauthorized: () => void): ApiClient {
  async function apiFetch(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    const token = getToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
    const res = await fetch(path, { ...init, headers });
    if (res.status === 401) onUnauthorized();
    return res;
  }

  async function apiJson<T>(path: string, init?: RequestInit) {
    const res = await apiFetch(path, init);
    if (!res.ok) {
      let msg = String(res.status);
      try {
        const data = (await res.clone().json()) as { error?: unknown };
        if (typeof data?.error === "string") msg = data.error;
      } catch {}
      throw new Error(msg);
    }
    return res.json() as Promise<T>;
  }

  async function apiText(path: string, init?: RequestInit) {
    const res = await apiFetch(path, init);
    if (res.status === 204) return "";
    if (!res.ok) {
      let msg = String(res.status);
      try {
        const data = (await res.clone().json()) as { error?: unknown };
        if (typeof data?.error === "string") msg = data.error;
      } catch {}
      throw new Error(msg);
    }
    return res.text();
  }

  return { apiJson, apiText };
}
