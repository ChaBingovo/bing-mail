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

function encodeMimeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}

function buildRawMime(payload: OutboundMailPayload, recipient: string): string {
  const messageId = `<${crypto.randomUUID()}@${extractDomainFromAddress(payload.from) || "localhost"}>`;
  const headers = [
    `From: ${payload.from}`,
    `To: ${recipient}`,
    `Subject: ${encodeMimeHeader(payload.subject || "(no subject)")}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
  ];
  const text = payload.text || "";
  const html = payload.html || "";
  if (text && html) {
    const boundary = `bm_${crypto.randomUUID().replace(/-/g, "")}`;
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      text,
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      html,
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }
  const contentType = html ? 'text/html; charset="utf-8"' : 'text/plain; charset="utf-8"';
  return [...headers, `Content-Type: ${contentType}`, "Content-Transfer-Encoding: 8bit", "", html || text, ""].join(
    "\r\n",
  );
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
    try {
      const result = await env.EMAIL.send({
        from: payload.from,
        to: payload.to,
        subject: payload.subject,
        text: payload.text || undefined,
        html: payload.html || undefined,
      });
      return { messageId: result?.messageId ?? null };
    } catch (err) {
      // Older workerd runtimes (e.g. local wrangler@4.19.0 / compat 2025-05-25) only
      // accept `EmailMessage(from, to, raw)` from `cloudflare:email` instead of the
      // Email Service builder object. Fall back only when `cloudflare:email` exists.
      const emailMod = await import("cloudflare:email").catch(() => null);
      const EmailMessageCtor = (emailMod as { EmailMessage?: new (f: string, t: string, r: string) => EmailMessage } | null)
        ?.EmailMessage;
      if (!EmailMessageCtor || !(err instanceof TypeError || /EmailMessage|raw/i.test(String(err)))) {
        throw err;
      }
      let lastId: string | null = null;
      for (const recipient of payload.to) {
        const msg = new EmailMessageCtor(payload.from, recipient, buildRawMime(payload, recipient));
        const res = await env.EMAIL.send(msg);
        if (res?.messageId) lastId = res.messageId;
      }
      return { messageId: lastId };
    }
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
