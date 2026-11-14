/** Mirrors the messages.status CHECK constraint in packages/db. */
export type MessageStatus = "PENDING" | "SUCCESS" | "FAILED";

export type MessageMeta = {
  id: string;
  status?: MessageStatus;
  fromName?: string | null;
  fromAddress?: string | null;
  toAddress?: string | null;
  subject?: string | null;
  snippet?: string | null;
  aiCode?: string | null;
  aiService?: string | null;
  receivedAt?: number;
};

export type Attachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentId: string | null;
  isInline: boolean;
  url: string;
};

export type MessageDetail = {
  id: string;
  status: MessageStatus;
  fromName: string | null;
  fromAddress: string | null;
  toAddress?: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: number;
  parsedAt: number | null;
  hasText: boolean;
  hasHtml: boolean;
  aiCode: string | null;
  aiService: string | null;
  attachments?: Attachment[];
};

export type SentMessage = {
  id: string;
  fromAddress: string;
  toAddress: string;
  subject: string | null;
  snippet: string | null;
  status: "SENT" | "FAILED";
  errorReason: string | null;
  sentAt: number;
};

export type RedDotResponse = {
  address: string | null;
  since: number;
  newCount: number;
  latestReceivedAt: number | null;
  latestNewReceivedAt: number | null;
};

export type AuthUser = {
  id: string;
  username: string;
  isAdmin?: boolean;
};
