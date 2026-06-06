# 本地开发指南

## UTF-8 中文显示

### Windows Terminal / PowerShell

```powershell
chcp 65001
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
```

### Git（可选）

```bash
git config --global i18n.commitEncoding utf-8
git config --global i18n.logOutputEncoding utf-8
git config --global core.quotepath false
```

## 初始化与启动

### 1. 安装依赖

```bash
bun install
bun install --cwd packages/worker --backend=copyfile --omit optional
bun install --cwd apps/web --backend=copyfile
```

### 2. 配置本地环境变量（Wrangler）

在仓库根目录创建 `.dev.vars`（不要提交）：

```ini
JWT_SECRET_CURRENT=dev-secret
JWT_SECRET_PREVIOUS=
WS_MAX_CONNECTIONS=3
TURNSTILE_MODE=off
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET=
```

### 3. 初始化数据库

```bash
bun run db:migrate
bun --cwd packages/worker db:seed:dev
```

### 4. 启动服务

```bash
bun run dev:worker
bun run dev:web
```

## 默认开发账号（seed）

`packages/db/seeds/dev.sql` 会创建：

- 用户名：`default`
- 密码：`default1234`

## 清空本地数据（从头开始）

```bash
bun --cwd packages/worker db:reset:local
bun run db:migrate
bun --cwd packages/worker db:seed:dev
```
