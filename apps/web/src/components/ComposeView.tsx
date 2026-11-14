import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { useTheme } from "../context/ThemeContext";
import type { ApiClient } from "../services/api";
import { getJson, removeKey, setJson } from "../services/storage";
import { markdownToEmailHtml } from "../utils/markdownEmail";
import {
  MAX_RECIPIENTS,
  MAX_SEND_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  type ComposeBodyMode,
  type ComposeDraft,
  type ComposePrefill,
  formatByteSize,
  getUtf8ByteLength,
  isValidEmail,
  mapSendError,
  mergeRecipients,
  parseRecipientsInput,
} from "../utils/compose";
import { DropdownSelect, type DropdownSelectOption } from "./DropdownSelect";
import { ShadowHtml } from "./ShadowHtml";

export function ComposeView(props: {
  api: ApiClient;
  userId: string;
  mailbox: string;
  aliases: string[];
  prefill?: ComposePrefill | null;
  onConsumePrefill?: () => void;
  onOpenSent?: () => void;
}) {
  const theme = useTheme();
  const [from, setFrom] = createSignal("");
  const [recipients, setRecipients] = createSignal<string[]>([]);
  const [recipientInput, setRecipientInput] = createSignal("");
  const [subject, setSubject] = createSignal("");
  const [body, setBody] = createSignal("");
  const [bodyMode, setBodyMode] = createSignal<ComposeBodyMode>("plain");
  const [mdTab, setMdTab] = createSignal<"edit" | "preview">("edit");
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal("");
  const [ok, setOk] = createSignal("");
  const [draftSavedAt, setDraftSavedAt] = createSignal<number | null>(null);

  let recipientInputEl: HTMLInputElement | undefined;
  let hydratedUser = "";
  let lastPrefillNonce = "";

  const draftKey = createMemo(() => `bingmail.composeDraft.user.${props.userId || "anon"}`);

  const ownedAddresses = createMemo(() => {
    const primary = (props.mailbox || "").trim().toLowerCase();
    const out: string[] = [];
    if (primary) out.push(primary);
    for (const alias of props.aliases) {
      const addr = (alias || "").trim().toLowerCase();
      if (addr && !out.includes(addr)) out.push(addr);
    }
    return out;
  });

  const fromOptions = createMemo<DropdownSelectOption[]>(() => {
    const primary = (props.mailbox || "").trim().toLowerCase();
    return ownedAddresses().map((address) => ({
      value: address,
      label: address === primary ? `${address}（主邮箱）` : address,
    }));
  });

  // Restore saved local draft once per logged-in user unless an explicit prefill is pending.
  createEffect(() => {
    const uid = props.userId || "anon";
    if (hydratedUser === uid) return;
    hydratedUser = uid;
    if (props.prefill) return;
    const saved = getJson<ComposeDraft>(draftKey());
    if (!saved) return;
    if (saved.from) setFrom(saved.from);
    if (Array.isArray(saved.to)) setRecipients(saved.to.slice(0, MAX_RECIPIENTS));
    if (typeof saved.subject === "string") setSubject(saved.subject);
    if (typeof saved.body === "string") setBody(saved.body);
    if (saved.bodyMode === "markdown" || saved.bodyMode === "plain") setBodyMode(saved.bodyMode);
    if (typeof saved.updatedAt === "number") setDraftSavedAt(saved.updatedAt);
  });

  // Apply Reply / Forward / Resend prefill pushed from EmailViewer or SentView.
  createEffect(() => {
    const p = props.prefill;
    if (!p || p.nonce === lastPrefillNonce) return;
    lastPrefillNonce = p.nonce;
    const owned = ownedAddresses();
    const preferredFrom = (p.from || "").trim().toLowerCase();
    if (preferredFrom && (owned.length === 0 || owned.includes(preferredFrom))) {
      setFrom(preferredFrom);
    }
    setRecipients(mergeRecipients([], p.to, MAX_RECIPIENTS));
    setRecipientInput("");
    setSubject(p.subject || "");
    setBody(p.body || "");
    setBodyMode("plain");
    setMdTab("edit");
    setError("");
    setOk("");
    props.onConsumePrefill?.();
  });

  // Default `from` to the primary mailbox (or fall back if the selected alias disappeared).
  createEffect(() => {
    const owned = ownedAddresses();
    if (owned.length === 0) return;
    const current = from().trim().toLowerCase();
    if (!current || !owned.includes(current)) {
      setFrom(owned[0]);
    }
  });

  // Auto-save draft changes locally so switching tabs never loses work.
  createEffect(() => {
    const f = from();
    const toList = recipients();
    const subj = subject();
    const textVal = body();
    const mode = bodyMode();
    const key = draftKey();
    if (!hydratedUser) return;

    const hasContent = toList.length > 0 || subj.trim().length > 0 || textVal.trim().length > 0;
    if (!hasContent) {
      removeKey(key);
      setDraftSavedAt(null);
      return;
    }
    const now = Date.now();
    const draft: ComposeDraft = {
      from: f,
      to: toList,
      subject: subj,
      body: textVal,
      bodyMode: mode,
      updatedAt: now,
    };
    setJson(key, draft);
    setDraftSavedAt(now);
  });

  const commitRecipientRaw = (rawText?: string) => {
    const raw = rawText ?? recipientInput();
    const parsed = parseRecipientsInput(raw);
    if (parsed.length === 0) {
      if (rawText === undefined) setRecipientInput("");
      return recipients();
    }
    const current = recipients();
    const merged = mergeRecipients(current, parsed, MAX_RECIPIENTS);
    if (current.length + parsed.filter((p) => !current.includes(p)).length > MAX_RECIPIENTS) {
      setError(`收件人最多支持 ${MAX_RECIPIENTS} 位`);
    }
    setRecipients(merged);
    if (rawText === undefined) setRecipientInput("");
    return merged;
  };

  const removeRecipient = (addr: string) => {
    setRecipients((list) => list.filter((item) => item !== addr));
  };

  const clearDraft = () => {
    setRecipients([]);
    setRecipientInput("");
    setSubject("");
    setBody("");
    setBodyMode("plain");
    setMdTab("edit");
    setError("");
    setOk("");
    removeKey(draftKey());
    setDraftSavedAt(null);
  };

  const previewHtml = createMemo(() => {
    if (bodyMode() !== "markdown") return "";
    return markdownToEmailHtml(body(), {
      variant: theme.resolvedTheme() === "light" ? "outbound" : "reader",
    });
  });

  const bodyByteLength = createMemo(() => {
    const textBytes = getUtf8ByteLength(body());
    if (bodyMode() !== "markdown") return textBytes;
    const htmlBytes = getUtf8ByteLength(markdownToEmailHtml(body(), { variant: "outbound" }));
    return Math.max(textBytes, htmlBytes);
  });

  const hasInvalidRecipient = createMemo(() => recipients().some((addr) => !isValidEmail(addr)));

  const send = async () => {
    if (sending()) return;
    setError("");
    setOk("");

    const finalRecipients = commitRecipientRaw();
    if (finalRecipients.length === 0) {
      setError("请至少填写一位收件人");
      recipientInputEl?.focus();
      return;
    }
    if (finalRecipients.length > MAX_RECIPIENTS) {
      setError(`收件人不能超过 ${MAX_RECIPIENTS} 位`);
      return;
    }
    const invalid = finalRecipients.filter((addr) => !isValidEmail(addr));
    if (invalid.length > 0) {
      setError(`收件人格式无效：${invalid.join(", ")}`);
      return;
    }

    const cleanSubject = subject().trim();
    if (cleanSubject.length > MAX_SUBJECT_LENGTH) {
      setError(`主题不能超过 ${MAX_SUBJECT_LENGTH} 个字符`);
      return;
    }

    const textPayload = body();
    if (!textPayload.trim()) {
      setError("请填写邮件正文");
      return;
    }

    const htmlPayload =
      bodyMode() === "markdown" ? markdownToEmailHtml(textPayload, { variant: "outbound" }) : "";

    if (
      getUtf8ByteLength(textPayload) > MAX_SEND_BODY_LENGTH ||
      getUtf8ByteLength(htmlPayload) > MAX_SEND_BODY_LENGTH
    ) {
      setError("邮件正文超出 512 KB 限制");
      return;
    }

    setSending(true);
    try {
      await props.api.apiJson("/api/user/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: from() || undefined,
          to: finalRecipients.join(", "),
          subject: cleanSubject,
          text: textPayload,
          html: htmlPayload || undefined,
        }),
      });
      setRecipients([]);
      setRecipientInput("");
      setSubject("");
      setBody("");
      setBodyMode("plain");
      setMdTab("edit");
      removeKey(draftKey());
      setDraftSavedAt(null);
      setOk(`已发送至 ${finalRecipients.join(", ")}`);
    } catch (err) {
      const code = err instanceof Error ? err.message : "发送失败";
      setError(mapSendError(code));
    } finally {
      setSending(false);
    }
  };

  const onShortcutKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div class="h-full overflow-auto bg-white/0 p-6">
      <div class="mx-auto w-full max-w-3xl space-y-6">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div class="text-lg font-semibold text-zinc-100">写邮件</div>
            <div class="mt-1 text-sm text-zinc-500">支持主邮箱或已启用别名发信，可切换纯文本与 Markdown 富文本。</div>
          </div>
          <div class="flex items-center gap-3">
            <Show when={draftSavedAt() !== null}>
              <span class="text-xs text-zinc-500">
                草稿已自动保存 · {new Date(draftSavedAt()!).toLocaleTimeString("zh-CN", { hour12: false })}
              </span>
            </Show>
            <Show when={recipients().length > 0 || subject().trim() || body().trim()}>
              <button
                type="button"
                class="spring-colors pressable rounded-xl bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                onClick={clearDraft}
              >
                清空草稿
              </button>
            </Show>
            <Show when={props.onOpenSent}>
              <button
                type="button"
                class="spring-colors pressable rounded-xl bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/10"
                onClick={() => props.onOpenSent?.()}
              >
                查看已发邮件
              </button>
            </Show>
          </div>
        </div>

        <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div class="space-y-4">
            <div>
              <div class="text-xs font-medium text-zinc-400">发件人</div>
              <DropdownSelect
                value={from()}
                options={fromOptions()}
                placeholder="未分配邮箱"
                wrapperClass="relative mt-2"
                onChange={(v) => setFrom(v)}
              />
            </div>

            <div>
              <div class="flex items-center justify-between">
                <div class="text-xs font-medium text-zinc-400">收件人</div>
                <Show when={recipients().length > 0}>
                  <div class={`text-xs ${hasInvalidRecipient() ? "text-rose-300" : "text-zinc-500"}`}>
                    {recipients().length} / {MAX_RECIPIENTS}
                  </div>
                </Show>
              </div>
              <div
                class="mt-2 flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-indigo-500/40"
                onClick={() => recipientInputEl?.focus()}
              >
                <For each={recipients()}>
                  {(addr) => {
                    const valid = isValidEmail(addr);
                    return (
                      <span
                        class={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs font-medium ${
                          valid
                            ? "border-indigo-400/25 bg-indigo-500/15 text-indigo-100"
                            : "border-rose-400/40 bg-rose-500/15 text-rose-200"
                        }`}
                      >
                        <span>{addr}</span>
                        <button
                          type="button"
                          aria-label={`移除 ${addr}`}
                          class="rounded px-0.5 text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRecipient(addr);
                          }}
                        >
                          ×
                        </button>
                      </span>
                    );
                  }}
                </For>
                <input
                  ref={(el) => (recipientInputEl = el)}
                  value={recipientInput()}
                  onInput={(e) => setRecipientInput(e.currentTarget.value)}
                  onBlur={() => {
                    if (recipientInput().trim()) commitRecipientRaw();
                  }}
                  onPaste={(e) => {
                    const text = e.clipboardData?.getData("text") || "";
                    if (/[\s,;，；]/.test(text)) {
                      e.preventDefault();
                      commitRecipientRaw(text);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "," || e.key === "，" || e.key === ";" || e.key === "；") {
                      e.preventDefault();
                      commitRecipientRaw();
                      return;
                    }
                    if (e.key === "Tab" && recipientInput().trim()) {
                      e.preventDefault();
                      commitRecipientRaw();
                      return;
                    }
                    if (e.key === "Backspace" && !recipientInput() && recipients().length > 0) {
                      const list = recipients();
                      removeRecipient(list[list.length - 1]);
                    }
                  }}
                  placeholder={
                    recipients().length === 0
                      ? "输入邮箱后按回车或逗号分隔（支持批量粘贴）"
                      : "继续添加收件人…"
                  }
                  class="min-w-[200px] flex-1 bg-transparent px-1 py-1 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <div class="text-xs font-medium text-zinc-400">主题</div>
              <input
                value={subject()}
                onInput={(e) => setSubject(e.currentTarget.value)}
                onKeyDown={onShortcutKeyDown}
                placeholder="（可留空）"
                class="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>

            <div>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-medium text-zinc-400">正文</span>
                  <div class="inline-flex rounded-xl border border-white/10 bg-white/5 p-0.5 text-xs">
                    <button
                      type="button"
                      class="spring-colors rounded-lg px-2.5 py-1 font-medium text-zinc-400 hover:text-zinc-200"
                      classList={{ "bg-white/10 text-zinc-100": bodyMode() === "plain" }}
                      onClick={() => {
                        setBodyMode("plain");
                        setMdTab("edit");
                      }}
                    >
                      纯文本
                    </button>
                    <button
                      type="button"
                      class="spring-colors rounded-lg px-2.5 py-1 font-medium text-zinc-400 hover:text-zinc-200"
                      classList={{ "bg-white/10 text-zinc-100": bodyMode() === "markdown" }}
                      onClick={() => setBodyMode("markdown")}
                    >
                      Markdown
                    </button>
                  </div>
                </div>

                <div class="flex items-center gap-3">
                  <Show when={bodyMode() === "markdown"}>
                    <div class="inline-flex rounded-xl border border-white/10 bg-white/5 p-0.5 text-xs">
                      <button
                        type="button"
                        class="spring-colors rounded-lg px-2.5 py-1 font-medium text-zinc-400 hover:text-zinc-200"
                        classList={{ "bg-indigo-500/20 text-indigo-200": mdTab() === "edit" }}
                        onClick={() => setMdTab("edit")}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        class="spring-colors rounded-lg px-2.5 py-1 font-medium text-zinc-400 hover:text-zinc-200"
                        classList={{ "bg-indigo-500/20 text-indigo-200": mdTab() === "preview" }}
                        onClick={() => setMdTab("preview")}
                      >
                        预览 HTML
                      </button>
                    </div>
                  </Show>
                  <span class={`text-xs ${bodyByteLength() > MAX_SEND_BODY_LENGTH ? "text-rose-300" : "text-zinc-500"}`}>
                    {formatByteSize(bodyByteLength())} / 512 KB
                  </span>
                </div>
              </div>

              <Show
                when={bodyMode() === "markdown" && mdTab() === "preview"}
                fallback={
                  <textarea
                    value={body()}
                    onInput={(e) => setBody(e.currentTarget.value)}
                    onKeyDown={onShortcutKeyDown}
                    rows={14}
                    placeholder={
                      bodyMode() === "markdown"
                        ? "支持 # 标题、**加粗**、`代码`、> 引用、列表和 [链接](https://...)\n发送时将同时附带纯文本与渲染后的 HTML"
                        : "纯文本正文（支持 Ctrl / ⌘ + Enter 快捷发送）"
                    }
                    class="mt-2 w-full resize-y rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                }
              >
                <div class="mt-2 min-h-[308px] rounded-xl border border-white/10 bg-white/5 p-3">
                  <Show
                    when={body().trim().length > 0}
                    fallback={<div class="text-xs text-zinc-500">输入 Markdown 内容后即可在此预览邮件排版效果。</div>}
                  >
                    <ShadowHtml html={previewHtml()} debugId="compose-preview" />
                  </Show>
                </div>
              </Show>
            </div>

            <Show when={error()}>
              <div class="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {error()}
              </div>
            </Show>
            <Show when={ok()}>
              <div class="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                <span>{ok()}</span>
                <Show when={props.onOpenSent}>
                  <button
                    type="button"
                    class="shrink-0 font-semibold underline hover:text-emerald-100"
                    onClick={() => props.onOpenSent?.()}
                  >
                    前往已发邮件
                  </button>
                </Show>
              </div>
            </Show>

            <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
              <span class="text-xs text-zinc-500">快捷键：Ctrl / ⌘ + Enter 发送</span>
              <button
                type="button"
                disabled={sending()}
                class="spring-colors pressable rounded-xl bg-indigo-500/20 px-4 py-2 text-sm font-semibold text-indigo-100 hover:bg-indigo-500/30 disabled:opacity-60"
                onClick={() => void send()}
              >
                {sending() ? "发送中…" : "发送邮件"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
