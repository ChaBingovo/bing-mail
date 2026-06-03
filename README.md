# Bingmail

基于 Cloudflare Email Routing + Workers + R2 + D1 + Queues 的网页邮箱实验工程。

## 部署（Cloudflare Workers）

### 前置条件

- 一个已接入 Cloudflare 的域名，并在 Cloudflare 控制台启用 Email Routing
- 已安装 Bun（本仓库脚本默认用 Bun 驱动 Wrangler）

### 创建 Cloudflare 资源

1. 登录 Wrangler

```bash
bunx wrangler login
```

2. 创建 D1 / R2 / Queue（名称需与 [wrangler.toml](./wrangler.toml) 一致）

```bash
bunx wrangler d1 create bingmail
bunx wrangler r2 bucket create bingmail-mail
bunx wrangler queues create bingmail-parse
```

3. 回填 D1 database_id

`wrangler d1 create` 会输出 database_id，请将其写入 [wrangler.toml](./wrangler.toml) 的 `database_id`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "bingmail"
database_id = "REPLACE_ME"
```

### 配置 Secret

本项目需要 `JWT_SECRET_CURRENT` 用于登录态签名（不要提交到仓库）。可选配置 `JWT_SECRET_PREVIOUS` 用于平滑轮换：

```bash
bunx wrangler secret put JWT_SECRET_CURRENT
bunx wrangler secret put JWT_SECRET_PREVIOUS
```

### Wrangler 部署（推荐）

```bash
bun run deploy:worker
```

### GitHub Actions 自动部署

仓库已包含工作流： [.github/workflows/deploy-worker.yml](./.github/workflows/deploy-worker.yml)

在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加：

- `CLOUDFLARE_API_TOKEN`：具有 Workers 部署权限的 API Token
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Account ID
- `JWT_SECRET_CURRENT`：登录态签名密钥（会由工作流同步到 Cloudflare Worker Secret）
- `JWT_SECRET_PREVIOUS`：可选，用于平滑轮换旧密钥

第一次需要在 Actions 页面手动运行一次该工作流（用于“解锁”自动部署）；之后每次推送到 `main` 分支会自动部署。

### 仪表盘部署（不走本地 Wrangler）

Workers & Pages → Create → 选择从 GitHub 部署（或连接已有仓库），并确保在构建环境中能安装 `packages/worker` 的依赖并执行部署。

如果使用 npm（控制台默认），可参考：

```bash
npm --prefix packages/worker ci
npx --prefix packages/worker wrangler deploy --cwd .
```

并在仪表盘中配置与本地一致的 Secrets（至少 `JWT_SECRET`）。

## 本地开发

1. 安装依赖

```bash
bun install
bun install --cwd packages/worker --backend=copyfile --omit optional
bun install --cwd apps/web --backend=copyfile --omit optional
```

2. 启动 Worker（包含 Email 收单、Queue Consumer、HTTP API）

```bash
bun run dev:worker
```

3. 启动前端

```bash
bun run dev:web
```

## 配置归类

### Cloudflare Secrets（敏感）

- `JWT_SECRET_CURRENT`：JWT 签名密钥（必须）
- `JWT_SECRET_PREVIOUS`：旧 JWT 密钥（可选，用于轮换过渡）
- `TURNSTILE_SECRET`：Turnstile 服务端密钥（启用 Turnstile 时需要）

### `.dev.vars`（本地开发专用，不提交）

- `JWT_SECRET_CURRENT`：本地 JWT 密钥
- `JWT_SECRET_PREVIOUS`：可选，本地轮换过渡
- `TURNSTILE_MODE`：`off | always | on_failure`
- `TURNSTILE_SITE_KEY`：Turnstile 站点 Key
- `WS_MAX_CONNECTIONS`：同 mailbox 最大 WS 连接数

### D1（应用设置表 `app_settings`）

- `allow_register`：是否允许注册（`0/1`）
- `max_aliases`：每个邮箱最多别名数
- `turnstile_mode/turnstile_site_key/turnstile_secret`：Turnstile 配置（可用 DB 覆盖环境变量）

### 前端公开配置

- 当前无必须公开的前端环境变量（开发环境通过 Vite 代理 `/api` 到 Worker）。

## 初始化

系统启动后会先进入初始化向导：创建管理员账户、记录域名、分配管理员主邮箱地址。每个账户仅有一个主邮箱地址，额外邮箱通过“别名”管理。

## 数据库初始化

- 生成迁移（可选）

```bash
bun run db:generate
```

- 执行迁移（依赖 Wrangler 的 D1 配置与数据库已创建）

```bash
bun run db:migrate
```

- 写入开发 seed（默认用户）

```bash
bun run db:seed:dev
```

## 清空本地数据（从头开始）

```bash
bun --cwd packages/worker db:reset:local
```
