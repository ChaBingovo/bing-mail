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
bun install --cwd packages/worker --backend=copyfile
bun install --cwd apps/web --backend=copyfile
```

### 2. 配置本地环境变量（Wrangler）

在仓库根目录创建 `.dev.vars`（不要提交）：

```ini
JWT_SECRET=dev-secret
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

### 5. 首次打开页面

seed 只创建普通演示账号，**不会**创建管理员：`isInitialized()` 以「是否存在管理员」判定系统是否已初始化，若 seed 里塞一个管理员，初始化向导会被直接跳过。所以首次访问仍会进入初始化向导：

1. 在向导里创建管理员账号、填写邮箱域名、分配主邮箱地址。
2. 初始化完成后用下面的演示账号登录，或直接用刚创建的管理员账号。

管理员账号与演示账号互相独立，互不影响。

## 默认开发账号（seed）

`packages/db/seeds/dev.sql` 会创建：

- 用户名：`default`
- 密码：`default1234`
- 主邮箱：`dev@example.test`
- 管理员：否（需要管理员功能时见下面的提升方式）

### 修改或重新生成 seed 密码

密码哈希必须落在 `packages/worker/src/auth.ts` 的 `[MIN_ITERATIONS, MAX_ITERATIONS]` 区间内，否则 `verifyPassword` 会直接拒绝，表现为「密码正确但登录失败」。不要手写哈希，用生成脚本：

```bash
bun ./scripts/hash-password.ts 你的新密码
# 把输出中 '...' 那一行替换 packages/db/seeds/dev.sql 里的哈希
```

脚本会做一次 verify 往返校验，校验失败时绝不打印哈希。`packages/worker/tests/seed.test.ts` 也会在 `bun run test` 时校验 seed 哈希可验证。

### 本地提升为管理员

```bash
bunx wrangler d1 execute bingmail --local --yes --command "UPDATE users SET is_admin = 1 WHERE username = 'default';"
```

## 清空本地数据（从头开始）

```bash
bun --cwd packages/worker db:reset:local
bun run db:migrate
bun --cwd packages/worker db:seed:dev
```

## 提交前自检

```bash
bun run check   # typecheck（worker + web）+ 单元/集成测试 + 前端构建
```