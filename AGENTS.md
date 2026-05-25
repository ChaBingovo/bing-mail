# 基于 Cloudflare 生态的高性能网页邮箱：架构与设计理念

目标：以前端响应式性能怪兽 SolidJS 为核心交互层，后端采用极致性能语言/运行时组成的混合流水线，在 Cloudflare 生态内实现兼具「极致吞吐量」「毫秒级响应」「极低内存占用」的现代化邮箱服务。

## 技术栈选型

- IDE / AI 助手：Trae（利用其强大的上下文理解与代码生成能力）
- 前端框架：SolidJS + Tailwind CSS（更轻量、无虚拟 DOM、细粒度更新）
- 后端语言（最快选型）
  - Worker 接收端：TypeScript / JavaScript（受限于 Cloudflare Workers 环境；仅做流转发，不做密集计算）
  - 异步解析端（Queue Consumer）
    - Rust（WASM 运行在 Cloudflare Workers 上），或
    - 通过 Cloudflare Hyperdrive / Service Bindings 桥接到独立服务器上的 Go / Rust 高性能后端
- 存储与基础设施：Cloudflare Email Routing + R2（对象存储）+ D1（SQLite 关系库）+ Cloudflare Queues（队列）

## 系统核心架构设计总结

系统拆分为三个核心解耦层，以规避 Cloudflare 50ms CPU 限制，保证大邮件场景的稳定性与吞吐。

### 第一层：极致轻量的邮件收单层（Workers / TypeScript）

当 Cloudflare 收到邮件并触发 Worker 时，保持逻辑最简，目标 10ms 内结束请求：

- 鉴权与过滤：在 D1 中查询收件人是否存在、是否在黑名单中
- 流式写入 R2：不读取邮件内容，直接将原始邮件字节流（message.raw）通过管道转写入 R2（流式传输，CPU 占用极低）
- 记录待处理索引：在 D1 中插入状态为 `STATUS_PENDING` 的轻量索引（发件人、收件人、时间、R2 路径）
- 投递队列：向 Cloudflare Queues 推送消息 `{ emailId: "xxx" }`，随后立即向邮件服务器响应成功

### 第二层：异步高并发解析层（Queues / Rust WASM 或 Go）

队列消费者异步被唤醒，拥有更宽松的 CPU 时间限制，负责所有解析与索引工作：

- 读取原始流：从 R2 下载原始 MIME 数据
- 高性能解析：用 Rust 的 MIME 解析库（或 Go 后端）解包为：发件人姓名、主题、纯文本、HTML 富文本、附件
- 大文本分流策略（关键）
  - 若 HTML 富文本 `< 100KB`：直接写入 D1 的 `content` 字段
  - 若 HTML 富文本 `>= 100KB`：单独存为 R2 的 `.html` 文件，D1 仅记录 R2 链接（避免 D1 行大小限制、降低查询负担）
- 全文索引（FTS5）：将纯文本正文与主题写入 D1 的 SQLite FTS5 虚拟表，实现毫秒级搜索
- AI 智能卡片与通知：调用 Workers AI（LLM）提取验证码/分类邮件，并通过 Webhook 异步推送到离线客户端（TG、Bark 等）
- 状态回写：解析完成后将邮件状态从 `PENDING` 更新为 `SUCCESS`

### 第三层：零损耗极致渲染前端（SolidJS）

利用 SolidJS 的细粒度更新特性，提供比传统 SPA 更快的体验：

- 按需加载（Lazy Loading）：进入收件箱时 API 仅返回 D1 的轻量元数据（主题、发件人、验证码卡片等），列表滚动与渲染保持极低开销
- 富文本安全沙箱（Shadow DOM）：点击某封邮件后再请求 HTML 内容；在 Shadow DOM 内渲染并配合清理逻辑隔离样式、防止 XSS
- 实时红点（WebSocket / DO）：用 Cloudflare Durable Objects 或 WebSockets 维持长连接，当解析层将状态改为 `SUCCESS` 时向前端推送新邮件事件，实现无需刷新

## 引导 Trae 实现的 Prompt 路线图

建议按以下顺序分步实现，便于逐层验证与压测：

1. 定义数据库  
   「请基于 Drizzle ORM 设计 Cloudflare D1 数据库 Schema。需要包含用户表、邮箱账号表、邮件元数据索引表（包含状态：PENDING/SUCCESS）、以及一个利用 SQLite FTS5 的邮件全文检索虚拟表。」

2. 编写 Worker 收单端  
   「请用 TypeScript 编写 Cloudflare Email Worker。当收到 message 时，检查 D1 鉴权，然后通过流式（Streams）将 message.raw 写入 R2 存储，并在 D1 插入 PENDING 记录，最后向 Cloudflare Queue 投递一条包含 emailId 的消息。要求尽可能轻量，避免 CPU 超时。」

3. 编写队列消费者解析端  
   「请编写 Cloudflare Queue 的消费者 Worker。从队列中获取 emailId，从 R2 读取原始邮件，使用 PostalMime（或 Rust WASM 库）进行解析。解析后，纯文本写入 FTS5 全文检索表；若 HTML 超过 100KB 则转存 R2，否则存入 D1。处理完成后将状态改为 SUCCESS。」

4. 构建 SolidJS 前端  
   「请使用 SolidJS 和 Tailwind CSS 编写一个临时邮箱的前端三栏布局。第一栏是功能菜单，第二栏是邮件列表（从 API 获取轻量元数据并高亮 AI 提取的验证码），第三栏是邮件详情（使用 Shadow DOM 渲染邮件的 HTML 富文本内容）。要求利用 SolidJS 的 Signal 实现细粒度的极致性能响应。」

