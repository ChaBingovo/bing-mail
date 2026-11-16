# 混合式邮件流水线

## 目标

Bingmail 是个人自有域名邮箱，不是临时邮箱或企业群件系统。设计取向是把“快速可读”和“接收阶段不做重计算”结合起来：原始邮件先可靠留存，再异步解析并预计算阅读、搜索和通知所需的数据。

关键目标是 **不在 SMTP 已接受邮件后静默失败**。当关键持久化或 Queue 投递失败时，入站处理器同步 `setReject()`，让上游按 SMTP 语义重试。不能把这表述为“绝不丢信”：发送方重试策略、平台故障、管理员删除和保留期都会影响邮件的最终可见性。

## 当前数据流

```text
Cloudflare Email Routing
  ↓
email() handler
  ├─ 校验原始大小（≤ 25 MiB）
  ├─ 查询主邮箱 / 别名、校验黑名单
  ├─ R2：archive/raw/<uuid>.eml
  ├─ Queue：{ messageId }
  └─ D1：messages(PENDING, r2_raw_key, mailbox_id)
  ↓
Queue Consumer
  ├─ 抢锁、重试、TTL 清扫与最终 FAILED
  ├─ 从 R2 读取原文并用 PostalMime 解析
  ├─ HTML：≤ 100 KiB 存 D1；更大则存 R2
  ├─ 附件：R2 + message_attachments 元数据
  ├─ 纯文本/主题：写 D1 与 FTS5
  ├─ Workers AI：验证码与服务名（可用时）
  └─ SUCCESS → MailEventsDO → WebSocket 提示；前端轮询兜底
```

当前顺序是 **R2 → Queue → D1**。它优先保证“Queue 发送失败时没有 PENDING 僵尸行，且仍可在 SMTP 应答前拒收”；代价是消费者可能先于 D1 行启动，必须重试“row not ready”。这是已实现并有测试覆盖的竞态处理，不可在不了解后果时调整。

下一阶段如需进一步提升可恢复性，应将其演进为 outbox 状态机：D1 先写 `QUEUING`，发送成功后标为 `PENDING`，cron 重投超时的 `QUEUING`。这能同时避免早到消费与 R2 孤儿对象；引入前必须通过正式迁移增加状态与索引。

## 存储与读取

| 数据 | 位置 | 原因 |
| --- | --- | --- |
| 原始 MIME | R2 | 可重试解析、避免把大对象放入 D1 |
| 小 HTML、纯文本、元数据 | D1 | 邮件详情可快速读取 |
| 大 HTML、附件 | R2 + D1 引用 | 避免大行并可流式下载 |
| 主题与纯文本索引 | D1 FTS5 | 支持服务端全文检索 |
| 连接与限流计数 | Durable Objects | 连接扇出、并发与额度控制 |

`MAIL_RETENTION_DAYS` 默认 90 天，可由管理员设置覆盖；`0` 表示不自动清理。每日 cron 删除过期的邮件行、FTS 行、附件元数据及相关 R2 对象。删除、保留期清理都必须先处理 R2，再删除数据库引用；对象删除失败时保留行以便下次重试。

## 安全边界

- 会话使用 HttpOnly、SameSite Cookie；改密码后 JWT 的密码版本不再匹配，从而吊销旧会话。
- 外部图片走 `/api/media/proxy`，执行协议、私网、重定向、大小和内容类型校验；CID 图片改写为鉴权附件端点。
- 邮件 HTML 在浏览器端经 DOMPurify 清洗并放入 Shadow DOM。HTML 下载接口的 CSP 是额外保护，但不等同于阅读器渲染时的 CSP 沙箱。
- `JWT_SECRET`、`TURNSTILE_SECRET` 等密钥只可放在 Worker Secret 或本地 `.dev.vars`。目前代码仍兼容读取旧的 D1 `turnstile_secret` 设置；应迁移并删除该兼容路径，禁止新增依赖。

## 已实现与未实现

| 已实现 | 尚未实现 |
| --- | --- |
| 收信、别名、黑名单、附件、删除、失败重试、保留期清理 | 入站幂等键与 outbox 重投 |
| FTS5、管理员跨邮箱搜索、游标分页 | 邮件归档、文件夹/标签、会话串 |
| WebSocket 通知与轮询回退 | Webhook / Bark / TG / 钉钉等对外通知 |
| AI 验证码与服务名提取 | AI 分类、账单金额/截止日、会议字段提取 |
| 基础纯文本发信与每日额度 | 发信附件、CC/BCC、草稿、富文本、已发送全文 |
| 单元/路由测试、手工本地注入链路 | 独立 Cloudflare 环境的端到端测试 |

## 平台限制

不要在文档中写死“免费版 50ms”。Cloudflare 的 CPU 时间取决于套餐和触发器；Queue Consumer 的默认 CPU 时间和可配置上限也与普通 HTTP 请求不同。提交前应查阅最新的 [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) 与 [Queues Limits](https://developers.cloudflare.com/queues/platform/limits/)，并以实测 CPU、延迟和失败率决定阈值。
