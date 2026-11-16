# Bingmail

Bingmail 是一个部署在 Cloudflare 上的个人网页邮箱：用自己的域名收信，在浏览器里查看邮件、管理别名、搜索历史邮件，并用实时通知和 AI 验证码提取提升日常使用效率。

当前重点是“可靠收信 + 网页收件箱”。基础纯文本发信、已发送记录与每日额度已经可用；附件、抄送/密送、草稿、富文本编辑和会话回复仍未完成。请将它视为个人主力收件箱、验证码邮箱和别名管理工具，而不是功能齐全的企业邮件套件。

## 架构原则

Bingmail 使用混合式流水线：入站 Worker 只校验收件人/黑名单/大小、保存原始 MIME 并投递解析任务；Queue Consumer 再完成 MIME 解析、附件保存、全文索引、AI 验证码提取和通知。关键写入在 SMTP 应答前完成：失败会拒收，让发送方按 SMTP 语义重试，避免“已接受但后台静默失败”。

这不是“绝不丢信”的承诺：发送方是否重试、平台故障和用户配置仍会影响最终投递。完整流程、已实现能力和边界见 [docs/architecture.md](./docs/architecture.md) 与 [docs/summary.md](./docs/summary.md)。

## 日常使用

### 第一次打开

部署完成后访问 Worker 域名或绑定的自定义域名。系统会进入初始化向导，需要完成：

1. 创建管理员账号。
2. 填写邮箱域名。
3. 分配管理员主邮箱地址。

每个账号只有一个主邮箱地址，额外地址通过“别名”管理。别名收到的邮件会进入同一个收件箱。

### 收信

1. 在 Cloudflare 控制台启用 Email Routing，并确保域名 MX 记录已生效。
2. 把需要接收的地址路由到 Bingmail Worker。
3. 登录网页端，邮件会进入收件箱；新邮件解析完成后会通过通知中心提示。

如果页面已经打开，Bingmail 会优先使用 WebSocket 接收新邮件通知；断线或后台场景下仍可通过刷新/同步看到最新邮件。

### 查看和搜索邮件

- 左侧列表查看最近邮件，点开邮件可阅读正文。
- 验证码类邮件会显示 AI 提取的验证码卡片，适合日常登录、注册场景。
- 使用 `Cmd+K` 或 `Ctrl+K` 打开 Spotlight 搜索，可搜索邮件、切换别名或跳转页面。

### 管理别名

普通用户可以在设置里查看主邮箱并新增/删除别名。别名数量由管理员配置，默认来自数据库设置 `max_aliases`。

适合的使用方式：

- 主邮箱用于长期身份。
- 别名用于注册服务、临时订阅、不同用途分流。
- 不再使用的别名可以停用，避免继续收信。

### 管理员日常维护

管理员可以在后台完成：

- 创建用户和分配邮箱地址。
- 调整每个账号可创建的别名数量。
- 开关注册入口。
- 配置 Turnstile 人机验证策略。

建议公开使用时启用 Turnstile，并关闭不需要的公开注册。

## 本地使用

详细开发说明见 [docs/dev.md](./docs/dev.md)。

启动、测试与本机常见问题排查见 [docs/quickstart.md](./docs/quickstart.md)。
项目现状、本轮完成的工作与待实现事项见 [docs/summary.md](./docs/summary.md)。

### 安装依赖

```bash
bun install
bun install --cwd packages/worker --backend=copyfile
bun install --cwd apps/web --backend=copyfile
```

### 配置本地变量

在仓库根目录创建 `.dev.vars`：

```ini
JWT_SECRET=dev-secret
WS_MAX_CONNECTIONS=3
TURNSTILE_MODE=off
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET=
```

### 初始化本地数据库

```bash
bun run db:migrate
bun --cwd packages/worker db:seed:dev
```

开发 seed 默认账号：

- 用户名：`default`
- 密码：`default1234`

### 启动

分别启动 Worker 和前端：

```bash
bun run dev:worker
bun run dev:web
```

前端开发环境通过 Vite 代理 `/api` 到 Worker。

### 清空本地数据

项目仍处于开发阶段，本地数据库可以直接重建：

```bash
bun --cwd packages/worker db:reset:local
bun --cwd packages/worker db:seed:dev
```

### 提交前自检

```bash
bun run check   # typecheck（worker + web）+ 测试 + 前端构建
```

## 部署到 Cloudflare

部署检查清单见 [docs/deploy-checklist.md](./docs/deploy-checklist.md)。

### 前置条件

- 一个已接入 Cloudflare 的域名。
- Cloudflare Email Routing 已启用。
- 已安装 Bun。
- Wrangler 已登录。

```bash
bunx wrangler login
```

### 创建资源

资源名称需要与 [wrangler.jsonc](./wrangler.jsonc) 保持一致：

```bash
bunx wrangler d1 create bingmail
bunx wrangler r2 bucket create bing-mail
bunx wrangler queues create bingmail-parse
```

把 `bunx wrangler d1 create bingmail` 输出的 `database_id` 写入 [wrangler.jsonc](./wrangler.jsonc)：

```jsonc
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "bingmail",
      "database_id": "REPLACE_ME"
    }
  ]
```

### 配置 Secrets

```bash
bunx wrangler secret put JWT_SECRET
bunx wrangler secret put TURNSTILE_SECRET
```

`JWT_SECRET` 必须配置；`TURNSTILE_SECRET` 仅在启用 Turnstile 时需要。

### 迁移和部署

```bash
# 本地迁移用于本地开发；生产 D1 必须显式加 --remote。
bun --cwd packages/worker db:migrate:remote
bun run check
bun run deploy:worker
```

部署后建议验证：

- 初始化向导或登录页能正常打开。
- `/api/setup/status` 返回正常。
- Email Routing 能把测试邮件投递到 Worker。
- 收件箱能看到测试邮件，通知和搜索可用。

## 一键部署到 Cloudflare（wrangler.jsonc）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ChaBingovo/bing-mail)

点击上方按钮后，Cloudflare 会基于 [wrangler.jsonc](./wrangler.jsonc) 自动创建所需的 D1、R2、Queue、Durable Objects 和 Workers AI 绑定，并引导填写 `.dev.vars.example` 中的 Secret（`JWT_SECRET`）：

1. 在部署向导中授权 GitHub 并设置 `JWT_SECRET`（其余资源会自动创建并回填配置）。
2. 构建与部署命令会由根目录 [package.json](./package.json) 自动识别（`bun run build` / `bun run deploy`，包含远程 D1 迁移 `wrangler d1 migrations apply DB --remote`）。
3. 部署完成后，按 [docs/deploy-checklist.md](./docs/deploy-checklist.md) 配置 Email Routing 与域名，然后访问 Worker 域名或自定义域名完成初始化。

## 配置速查

Cloudflare Secrets：

- `JWT_SECRET`：JWT 签名密钥，必须。
- `TURNSTILE_SECRET`：Turnstile 服务端密钥，可选。

`.dev.vars` 本地变量：

- `JWT_SECRET`
- `TURNSTILE_MODE`：`off | always | on_failure`
- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET`
- `WS_MAX_CONNECTIONS`

D1 应用设置表 `app_settings`：

- `allow_register`：是否允许注册，`0/1`。
- `max_aliases`：每个邮箱最多别名数。
- `turnstile_mode`
- `turnstile_site_key`

`TURNSTILE_SECRET` 仅应来自 Cloudflare Worker Secret 或本地 `.dev.vars`；不要把它写进 `app_settings`。
