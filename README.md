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

## 部署到 Cloudflare（基于 wrangler.jsonc）

Bingmail 的所有 Cloudflare 资源绑定与默认环境变量都已声明在根目录 [wrangler.jsonc](./wrangler.jsonc) 中。**首次部署时 Wrangler 会自动创建 D1、R2、Queue、Durable Objects 等资源，不需要提前去控制台手动一个一个创建。**

> 完整上线核对清单见 [docs/deploy-checklist.md](./docs/deploy-checklist.md)。

---

### 方式一：Deploy to Cloudflare 一键部署（适合他人在自己账号新建副本）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ChaBingovo/bing-mail)

1. 点击上方按钮并授权 GitHub（页面会读取仓库根目录的 [wrangler.jsonc](./wrangler.jsonc)、[package.json](./package.json) 和 [.dev.vars.example](./.dev.vars.example)）。
2. 在环境变量 / Secret 表单中填写 `JWT_SECRET`（任意长随机字符串，用于签发登录会话，**必填**）。
3. 确认构建与部署命令：
   - **Build command**：`bun run build`
   - **Deploy command**：`bun run deploy`（会先自动建库并部署 Worker，再执行 `npx wrangler d1 migrations apply DB --remote` 创建全部数据库表）
4. 部署完成后继续看下面的 [部署后必做配置](#部署后必做配置)。

> 如果按钮第一步提示 **“无法获取存储库内容”**：请到 GitHub `Settings -> Applications -> Installed GitHub Apps -> Cloudflare Workers and Pages -> Configure` 确认开启了 **All repositories** 或勾选了当前仓库；或者直接使用下面的**方式二**。

---

### 方式二：Cloudflare 控制台导入仓库（推荐给自己账号部署 / Fork 后部署）

在 Cloudflare 控制台操作最稳定，以后每次 `git push` 也会自动更新：

1. 进入 Cloudflare 控制台 → **Workers & Pages** → **创建（Create）** → **导入存储库（Import a repository）**，选择你的 `bing-mail` 仓库。
2. **项目名称（Project / Worker name）**：建议填 `bingmail`（与 [wrangler.jsonc](./wrangler.jsonc) 一致；若填了 `bing-mail`，Wrangler 会自动兼容覆盖并提示一次名称差异，不影响运行）。
3. **构建与部署命令（关键！）**：
   - **构建命令（Build command）**：`bun run build`（默认 `npm run build` 也能跑通）
   - **部署命令（Deploy command）**：**一定要把默认的 `npx wrangler deploy` 改成 `bun run deploy`**！
     - 原因：默认的 `npx wrangler deploy` 只会创建空 D1 数据库，**不会创建数据表**；改为 `bun run deploy` 后才会自动执行 `npx wrangler d1 migrations apply DB --remote` 建表。
4. 点击 **部署（Deploy）**。
5. 部署成功后，进入该 Worker 的 **Settings（设置）-> Variables and Secrets（变量和机密）**，添加至少一个 **Secret**：
   - 变量名：`JWT_SECRET`，类型选 **Secret**，值填一个高强度随机字符串（例如 32 位以上随机字符）。
6. 如刚才忘了改 Deploy command 或后补了 `JWT_SECRET`，点击 **Retry build / 重新部署** 或触发一次构建即可。

---

### 方式三：本地命令行手动部署

适合本地直接推上 Cloudflare：

```bash
# 1. 登录 Cloudflare
bunx wrangler login

# 2. 构建前端并自动创建 D1/R2/Queue、部署 Worker、执行远程 D1 迁移
bun run build
bun run deploy

# 3. 写入必填 Secret
bunx wrangler secret put JWT_SECRET
```

---

### 变量与绑定完整说明（哪些自动，哪些手动）

#### 1. 自动创建并绑定的资源（已在 `wrangler.jsonc` 声明，无需手动创建）

| 绑定名 | 类型 | 资源名 / 说明 | 是否需要手动建 |
| --- | --- | --- | --- |
| `DB` | D1 Database | `bingmail`（不填 `database_id` 触发自动创建） | 自动创建（**需 `bun run deploy` 建表**） |
| `MAIL_BUCKET` | R2 Bucket | `bing-mail`（存储原始 MIME 与大附件） | 自动创建 |
| `PARSE_QUEUE` | Queue | `bingmail-parse`（入站异步解析队列 + 消费者） | 自动创建 |
| `MAIL_EVENTS` | Durable Object | `MailEventsDO`（WebSocket 实时新邮件推送） | 自动随代码迁移 |
| `AUTH_RATE` | Durable Object | `AuthRateLimitDO`（登录限流与每日发信额度） | 自动随代码迁移 |
| `AI` | Workers AI | 用于邮件验证码提取 | 自动绑定 |
| `ASSETS` | Static Assets | 托管 `apps/web/dist` 前端静态页面 | 自动上传 |
| `EMAIL` | Send Email | Cloudflare Email Service 发信绑定（按域名可选） | 自动绑定（发信需域内开通） |

#### 2. 已内置默认值的环境变量（已在 `wrangler.jsonc` 的 `vars` 中配置，通常无需改动）

| 变量名 | 默认值 | 用途 |
| --- | --- | --- |
| `HTML_INLINE_LIMIT` | `102400` | HTML 正文小于 100 KiB 存 D1，超过存 R2 |
| `PARSE_QUEUE_MAX_ATTEMPTS` | `5` | 队列解析最大重试次数 |
| `WS_MAX_CONNECTIONS` | `3` | 单账号允许的同时 WebSocket 连接数 |
| `LOGIN_FAIL_LIMIT` | `5` | 登录失败锁定阈值 |
| `LOGIN_FAIL_WINDOW_MS` | `600000` | 登录限流统计窗口（10 分钟） |
| `SEND_DAILY_LIMIT` | `200` | 单账号每日外发邮件上限 |
| `MAIL_RETENTION_DAYS` | `90` | 邮件保留天数（`0` 关闭清理；可在管理后台覆盖） |

#### 3. 需要手动配置的 Secrets（敏感密钥，不可写入 `wrangler.jsonc`）

在 Cloudflare 控制台 **Worker -> Settings -> Variables and Secrets**（选 Secret 类型）或通过 `wrangler secret put` 设置：

| Secret 名称 | 是否必填 | 说明 |
| --- | --- | --- |
| `JWT_SECRET` | **必填** | 登录 Cookie JWT 签名密钥；未设置时无法完成初始化与登录 |
| `RESEND_API_KEY` | 选填 | 仅当你在管理后台把某个域名发信商设为 **Resend** 时需要 |
| `TURNSTILE_SECRET` | 选填 | 仅当在管理后台启用 Turnstile 人机验证时需要（Site Key 在后台界面里填） |

---

### 部署后必做配置

1. **打开初始化向导**：
   - 访问你的 Worker 域名（`*.workers.dev`）或绑定的自定义域名。
   - 首次访问会自动进入 4 步初始化向导：创建管理员账号 → 添加收信域名 →（可选）选择发信服务（Cloudflare Email Service / Resend / 暂不配置，系统内部互发邮件无需配置外发服务）→ 分配管理员主邮箱。
2. **配置收信（Cloudflare Email Routing）**：
   - 在 Cloudflare 域名控制台开启 **Email Routing**，确认域名 MX 记录生效。
   - 添加路由规则（如 Catch-all 或指定前缀）→ 操作选择 **发送到 Worker（Send to a Worker）** → 选择你部署的 Bingmail Worker。
3. **（可选）绑定自定义域名**：
   - 在 Worker 的 **Settings -> Domains & Routes** 添加你的域名（例如 `mail.example.com`）。

---

### 常见问题排查

- **刚部署完打开不是初始化向导，或提示“D1 数据库尚未初始化表结构”**：
  - 这是因为 Workers Builds 的 **Deploy command** 仍为默认的 `npx wrangler deploy`，只创建了空 D1 数据库但没跑建表迁移。
  - 解决办法：在 Worker 的 **Settings -> Builds** 将 Deploy command 改为 `bun run deploy` 后重新部署（或在本地登录 Wrangler 后执行一次 `npx wrangler d1 migrations apply DB --remote`）。
- **提示“尚未配置 JWT_SECRET Secret”**：
  - 请在 Worker 的 **Settings -> Variables and Secrets** 添加类型为 **Secret** 的 `JWT_SECRET` 后重新部署或刷新。
- **本地开发变量（`.dev.vars`）与后台设置表（`app_settings`）**：
  - 本地开发在根目录创建 `.dev.vars`（至少包含 `JWT_SECRET=dev-secret`，其余 `TURNSTILE_MODE=off` 等见 [docs/quickstart.md](./docs/quickstart.md)）。
  - 注册开关 `allow_register`、每号最大别名数 `max_aliases`、保留天数 `retention_days` 等运行期配置存储在 D1 `app_settings` 表中，直接通过网页管理后台修改即可。

---

## 许可证

- 本项目自身以 **MIT** 许可证发布，全文见 [LICENSE](./LICENSE)。
- 第三方组件与字体的版权声明、许可证全文见 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)。
- 界面字体为 **Noto Sans SC**（SIL OFL 1.1），经 Google Fonts 以外部样式表引入；本项目**不分发任何字体文件**。若外部字体不可达，会自动回退到系统字体。若部署环境无法访问 `fonts.googleapis.com`，可把 `apps/web/index.html` 中的地址替换为 `fonts.googleapis.cn`，或下载字体自行托管（OFL 1.1 允许再分发，但需随附许可证全文）。
- 许可证审计过程与依赖清单见 [docs/license-audit.md](./docs/license-audit.md)。
