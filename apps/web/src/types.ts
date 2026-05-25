export type MessageMeta = {
  id: string;
  status?: "PENDING" | "SUCCESS";
  fromName?: string | null;
  fromAddress?: string | null;
  subject?: string | null;
  snippet?: string | null;
  aiCode?: string | null;
  aiService?: string | null;
  receivedAt?: number;
};

export type MessageDetail = {
  id: string;
  status: "PENDING" | "SUCCESS";
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: number;
  parsedAt: number | null;
  hasHtml: boolean;
  aiCode: string | null;
  aiService: string | null;
};

export type RedDotResponse = {
  address: string;
  since: number;
  newCount: number;
  latestReceivedAt: number | null;
  latestNewReceivedAt: number | null;
};

export type AuthUser = {
  id: string;
  username: string;
};
