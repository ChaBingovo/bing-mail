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
