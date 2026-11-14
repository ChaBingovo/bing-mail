import type { MessageDetail } from "../types";
import { formatTime } from "./format";

export const MAX_RECIPIENTS = 20;
export const MAX_SUBJECT_LENGTH = 998;
export const MAX_SEND_BODY_LENGTH = 512 * 1024;

export type ComposeBodyMode = "plain" | "markdown";

export type ComposePrefill = {
  nonce: string;
  mode: "reply" | "forward" | "resend";
  from?: string;
  to: string[];
  subject: string;
  body: string;
};

export type ComposeDraft = {
  from: string;
  to: string[];
  subject: string;
  body: string;
  bodyMode: ComposeBodyMode;
  updatedAt: number;
};

/** Matches the backend validation in `fetch.shared.ts` so UI feedback matches server rules. */
export function isValidEmail(value: string) {
  const v = (value || "").trim();
  if (!v || v.length > 320) return false;
  if (/[\s,;<>"()[\]]/.test(v)) return false;
  const at = v.indexOf("@");
  if (at <= 0 || at !== v.lastIndexOf("@")) return false;
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (!local || local.length > 64) return false;
  if (!domain || domain.length > 255 || domain.includes("..")) return false;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain);
}

/** Splits pasted or typed recipient strings (supporting display-name <email>, comma, semicolon, and whitespace) and normalizes. */
export function parseRecipientsInput(raw: string): string[] {
  const out: string[] = [];
  const segments = (raw || "").split(/[,;，；\r\n]+/);
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const angle = trimmed.match(/<([^<>]+)>/);
    if (angle) {
      const addr = angle[1].trim().toLowerCase();
      if (addr) out.push(addr);
      continue;
    }
    for (const part of trimmed.split(/\s+/)) {
      const addr = part.trim().toLowerCase();
      if (addr) out.push(addr);
    }
  }
  return Array.from(new Set(out));
}

export function mergeRecipients(existing: string[], incoming: string[], max = MAX_RECIPIENTS): string[] {
  const seen = new Set(existing.map((item) => item.trim().toLowerCase()).filter(Boolean));
  const out = [...seen];
  for (const raw of incoming) {
    const addr = (raw || "").trim().toLowerCase();
    if (!addr || seen.has(addr)) continue;
    if (out.length >= max) break;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}

export function extractQuoteText(text: string, html: string, snippet: string | null | undefined) {
  const plain = (text || "").trim();
  if (plain) return plain;
  const rawHtml = (html || "").trim();
  if (rawHtml) {
    const stripped = rawHtml
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (stripped) return stripped;
  }
  return (snippet || "").trim();
}

function prefixSubject(prefix: "Re: " | "Fwd: ", subject: string | null | undefined) {
  const clean = (subject || "").trim();
  if (!clean) return `${prefix.trim()}`;
  if (prefix === "Re: " && /^re\s*:/i.test(clean)) return clean;
  if (prefix === "Fwd: " && /^(fwd|fw)\s*:/i.test(clean)) return clean;
  return `${prefix}${clean}`;
}

function quoteLines(source: string) {
  const trimmed = (source || "").trim();
  if (!trimmed) return "";
  return trimmed
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function formatSenderLabel(detail: MessageDetail) {
  if (detail.fromName && detail.fromAddress) return `${detail.fromName} <${detail.fromAddress}>`;
  return detail.fromAddress || detail.fromName || "未知发件人";
}

export function buildReplyPrefill(params: {
  detail: MessageDetail;
  text: string;
  html: string;
  fromAddress?: string;
}): ComposePrefill {
  const { detail, text, html, fromAddress } = params;
  const to = detail.fromAddress && isValidEmail(detail.fromAddress) ? [detail.fromAddress.trim().toLowerCase()] : [];
  const quoteSource = extractQuoteText(text, html, detail.snippet);
  const when = formatTime(detail.receivedAt);
  const who = formatSenderLabel(detail);
  const quoted = quoteLines(quoteSource);
  const header = when ? `在 ${when}，${who} 写道：` : `${who} 写道：`;
  const body = quoted ? `\n\n${header}\n${quoted}` : `\n\n${header}\n> `;

  return {
    nonce: crypto.randomUUID(),
    mode: "reply",
    from: fromAddress,
    to,
    subject: prefixSubject("Re: ", detail.subject),
    body,
  };
}

export function buildForwardPrefill(params: {
  detail: MessageDetail;
  text: string;
  html: string;
  fromAddress?: string;
}): ComposePrefill {
  const { detail, text, html, fromAddress } = params;
  const source = extractQuoteText(text, html, detail.snippet);
  const when = formatTime(detail.receivedAt);
  const who = formatSenderLabel(detail);
  const subject = (detail.subject || "(无主题)").trim();
  const metaLines = [
    "---------- 转发邮件 ----------",
    `发件人: ${who}`,
    when ? `时间: ${when}` : "",
    `主题: ${subject}`,
  ].filter(Boolean);
  const body = source ? `\n\n${metaLines.join("\n")}\n\n${source}` : `\n\n${metaLines.join("\n")}\n`;

  return {
    nonce: crypto.randomUUID(),
    mode: "forward",
    from: fromAddress,
    to: [],
    subject: prefixSubject("Fwd: ", detail.subject),
    body,
  };
}

export function mapSendError(code: string) {
  const clean = (code || "").trim();
  if (clean === "recipient_required") return "请至少填写一位收件人";
  if (clean === "too_many_recipients") return `收件人不能超过 ${MAX_RECIPIENTS} 位`;
  if (clean === "invalid_recipient") return "存在格式不正确的收件人地址";
  if (clean === "invalid_from") return "所选发件地址无效或已停用";
  if (clean === "subject_too_long") return `主题不能超过 ${MAX_SUBJECT_LENGTH} 个字符`;
  if (clean === "body_required") return "请填写邮件正文";
  if (clean === "body_too_large") return "邮件正文超出 512 KB 限制";
  if (clean === "mail_not_configured") return "当前环境未配置发信能力（EMAIL binding）";
  if (clean === "rate_limited") return "今日发信额度已达上限，请明天再试";
  if (clean === "mailbox_missing") return "当前账号尚未分配可用邮箱";
  if (clean === "send_failed") return "发信通道返回失败，请检查发件域名配置或稍后重试";
  return clean || "发送失败";
}

export function getUtf8ByteLength(value: string) {
  return new TextEncoder().encode(value || "").byteLength;
}

export function formatByteSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
