# 项目现状

最后核对：2026-11-14。本文描述当前代码与已验证能力；架构决策见 [architecture.md](./architecture.md)，本地启动见 [quickstart.md](./quickstart.md)。

## 项目定位

Bingmail 是部署在 Cloudflare 上的个人网页邮箱：使用自有域名收信，在浏览器中阅读、搜索和管理邮件，并支持别名、附件、实时通知与验证码提取。

它采用“原始邮件先保存、解析异步化、阅读数据预计算”的混合流水线。目标是关键步骤失败时同步拒收，防止 SMTP 已接受后静默失败；不承诺“绝不丢信”。

技术栈：Cloudflare Workers、D1、R2、Queues、Durable Objects、Workers AI；前端为 SolidJS + Tailwind。

## 当前能力

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 收信（主邮箱 + 别名） | 可用 | 未知收件人、黑名单和超 25 MiB 邮件会同步拒收；R2、Queue、D1 的关键失败会在 SMTP 应答前触发临时拒收 |
| 异步解析与恢复 | 可用 | Queue 抢锁、有限重试、TTL 清扫、FAILED 状态与人工重试；当前 Queue 先于 D1 行投递，消费者会处理短暂竞态 |
| 阅读与附件 | 可用 | HTML 经 DOMPurify + Shadow DOM 渲染；文本/Markdown 降级；附件存 R2，支持下载与 CID 内联图片 |
| 外部图片 | 可用 | 同源媒体代理，拦截私网目标，限制重定向、大小并校验内容类型/魔数 |
| 搜索 | 可用 | D1 FTS5 搜索主题与纯文本；支持安全默认模式、高级 FTS 语法和管理员跨邮箱搜索 |
| 实时提示 | 可用 | Durable Object WebSocket 推送；连续重连失败时轮询回退 |
| 邮箱管理 | 可用 | 别名配额、黑名单、管理员用户/域名/注册/Turnstile/保留期管理；已读状态服务端同步 |
| 生命周期 | 可用 | 删除邮件、每日保留期清理、同步删除附件与 FTS；默认保留 90 天，`0` 为永久保留 |
| 发信 | 基础可用 | 原生 `send_email`、主邮箱或别名发件、纯文本正文、每日额度、失败记录与已发送摘要 |
| AI | 基础可用 | Workers AI 提取验证码与服务名；AI 不可用或失败不会阻断邮件解析 |

## 重要边界

- 发信尚不支持附件、CC/BCC、草稿、富文本编辑、已发送正文阅读或回复线程。
- 收件箱是平铺时间线，尚无归档、文件夹/标签、会话串或规则引擎。
- AI 尚不做自动分类、账单金额/日期、会议字段提取或自动回复。
- 没有用户可配置的 Webhook（TG、Bark、钉钉、企业微信等）。
- 自动化测试覆盖单元、路由和本地模拟；真实 Cloudflare 环境的收信 → Queue → R2/D1 → 通知端到端测试尚未建立。
- 邮件 HTML 的主防线是 DOMPurify、禁止危险标签/属性、Shadow DOM、链接隔离和图片代理。HTML 下载接口的 CSP 不应被描述为阅读器本身的 CSP 沙箱。
- 目前仍兼容从 D1 读取 `turnstile_secret`。这与“密钥应只存 Worker Secret”的目标冲突，应优先迁移并移除。

## 验证基线

2026-11-14 在本地执行 `bun run check` 成功：

- Worker：131 个测试通过；
- Web：30 个测试通过；
- Worker/Web TypeScript 检查与 Vite 生产构建通过。

测试数量会变化，以命令实际输出为准。

## 下一轮建议

1. **可靠性**：引入 intake/outbox 状态机、入站幂等键（Message-ID + 原文哈希兜底）和孤儿 R2 对象清理。
2. **安全与交付**：把 Turnstile secret 从 D1 迁移到 Worker Secret；提交 `bun.lock`、固定 CI Bun 版本并使用冻结安装；补 Origin/CSRF 纵深校验。
3. **测试与可观测性**：建立独立 Cloudflare 测试环境，监控 Queue 积压、FAILED 比例、R2/D1 错误和 CPU 限额。
4. **产品闭环**：先补发信附件、CC/BCC、草稿与 HTML；随后完成归档/标签/会话串和 Webhook。
5. **智能化**：在用户可选择、可关闭且有成本上限的前提下增加分类、账单和会议提取。

## 常用命令

```powershell
bun run check
bun run dev:worker
bun --cwd packages/worker db:reset:local
bun --cwd packages/worker db:migrate:remote
```

生产迁移必须使用 `db:migrate:remote`；根目录 `db:migrate` 仅迁移本地 Miniflare D1。
