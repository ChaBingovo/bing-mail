# Bingmail

基于 Cloudflare Email Routing + Workers + R2 + D1 + Queues 的网页邮箱实验工程。

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

## 初始化白名单邮箱

先准备数据库结构和开发 seed，然后用默认开发用户创建白名单邮箱（示例）：

```bash
Invoke-RestMethod -Method POST -Uri http://127.0.0.1:8787/api/mailboxes -Headers @{ Authorization = "Bearer dev-token" } -ContentType "application/json" -Body '{"address":"you@example.com"}'
```

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
