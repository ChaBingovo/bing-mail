import type { Env } from "./env";

export type SendProvider = "none" | "cloudflare" | "resend";

export type SendCapabilities = {
  cloudflare: boolean;
  resend: boolean;
};

export type OutboundMailPayload = {
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
};

export class OutboundNotConfiguredError extends Error {
  constructor(public readonly provider: string) {
    super(`mail_not_configured:${provider}`);
    this.name = "OutboundNotConfiguredError";
  }
}

export function normalizeSendProvider(value: unknown): SendProvider | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "none" || v === "cloudflare" || v === "resend") return v;
  return null;
}

export function getSendCapabilities(env: Env): SendCapabilities {
  return {
    cloudflare: Boolean(env.EMAIL && typeof env.EMAIL.send === "function"),
    resend: Boolean(typeof env.RESEND_API_KEY === "string" && env.RESEND_API_KEY.trim().length > 0),
  };
}

export function canDomainSend(env: Env, provider: string | null | undefined): boolean {
  const caps = getSendCapabilities(env);
  if (provider === "cloudflare") return caps.cloudflare;
  if (provider === "resend") return caps.resend;
  return false;
}

export function extractDomainFromAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at === -1) return "";
  return address.slice(at + 1).trim().toLowerCase();
}

export async function sendOutboundEmail(
  env: Env,
  provider: SendProvider,
  payload: OutboundMailPayload,
): Promise<{ messageId: string | null }> {
  if (provider === "cloudflare") {
    if (!env.EMAIL || typeof env.EMAIL.send !== "function") {
      throw new OutboundNotConfiguredError("cloudflare");
    }
    const result = await env.EMAIL.send({
      from: payload.from,
      to: payload.to,
      subject: payload.subject,
      text: payload.text || undefined,
      html: payload.html || undefined,
    });
    return { messageId: result?.messageId ?? null };
  }

  if (provider === "resend") {
    const apiKey = typeof env.RESEND_API_KEY === "string" ? env.RESEND_API_KEY.trim() : "";
    if (!apiKey) {
      throw new OutboundNotConfiguredError("resend");
    }
    const body: Record<string, unknown> = {
      from: payload.from,
      to: payload.to,
      subject: payload.subject,
    };
    if (payload.text) body.text = payload.text;
    if (payload.html) body.html = payload.html;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let detail = `resend_http_${res.status}`;
      try {
        const errData = (await res.json()) as { message?: unknown; name?: unknown };
        if (typeof errData?.message === "string" && errData.message) {
          detail = errData.message;
        } else if (typeof errData?.name === "string" && errData.name) {
          detail = errData.name;
        }
      } catch {
        try {
          const errText = await res.text();
          if (errText) detail = errText.slice(0, 200);
        } catch {}
      }
      throw new Error(detail);
    }

    let messageId: string | null = null;
    try {
      const data = (await res.json()) as { id?: unknown };
      if (typeof data?.id === "string" && data.id) {
        messageId = data.id;
      }
    } catch {}
    return { messageId };
  }

  throw new OutboundNotConfiguredError(provider);
}
