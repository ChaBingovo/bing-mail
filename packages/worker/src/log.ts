type LogLevel = "info" | "warn" | "error";

type LogFields = {
  requestId?: string;
  messageId?: string;
  mailboxId?: string;
  userId?: string;
  attempt?: number;
  status?: string;
  event: string;
  error?: string;
};

function emit(level: LogLevel, fields: LogFields) {
  const payload = {
    level,
    event: fields.event,
    requestId: fields.requestId,
    messageId: fields.messageId,
    mailboxId: fields.mailboxId,
    userId: fields.userId,
    attempt: fields.attempt,
    status: fields.status,
    error: fields.error,
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function logInfo(fields: LogFields) {
  emit("info", fields);
}

export function logWarn(fields: LogFields) {
  emit("warn", fields);
}

export function logError(fields: LogFields) {
  emit("error", fields);
}
