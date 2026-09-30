# 启动 & 测试指南

本指南覆盖在本机把 Bingmail 跑起来的完整流程：前置条件、一次性准备、启动、测试、数据位置与清库、环境坑，以及常见问题排查。全部命令都在仓库根目录执行。

一句话版本：**只需要 Bun**，不需要单独安装 Node，不需要 Cloudflare 账号，不需要联网部署。

## 1. 前置条件

- 安装 Bun，用 `bun --version` 确认可用（本机实测 1.3.14）。
- 不需要单独安装 Node（Bun 自带运行时，脚本用 `bun` 直接跑）。
- 不需要 Cloudflare 账号，也不需要 `wrangler login`——本地全部走 `--local` 模拟环境。
- Windows 建议先把终端切到 UTF-8，否则中文日志和中文路径会乱码：

  ```powershell
  chcp 65001
  ```

  更详细的终端/Git 中文配置见 [dev.md](./dev.md)。

## 2. 一次性准备

### 安装依赖

三条 `bun install`，后两条必须带 `--backend=copyfile`（Windows 下默认的软链接方式需要管理员权限或开发者模式）：

```bash
bun install
bun install --cwd packages/worker --backend=copyfile
bun install --cwd apps/web --backend=copyfile
```

### 配置 `.dev.vars`

在仓库根目录创建 `.dev.vars`（不要提交），至少要设置 `JWT_SECRET`，否则登录签发 JWT 会直接失败：

```ini
JWT_SECRET=dev-secret
WS_MAX_CONNECTIONS=3
TURNSTILE_MODE=off
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET=
```

## 3. 启动

```bash
bun run dev:worker
```

这一条命令会做完下面三件事：

1. 先自动跑数据库迁移（`packages/worker/scripts/wrangler-dev.ts` 里先执行 `db-migrate.ts`，所以全新克隆或刚清库之后也能直接起）。
2. 在 <http://127.0.0.1:8788> 启动 Worker，**API 和前端在同一个端口**。
3. 前端静态资源由 `wrangler.toml` 的 `[assets] directory = "apps/web/dist"` 提供。

因此有两点要注意：

- 前端产物来自 `apps/web/dist`。改完前端代码必须先重新构建，刷新页面才生效：

  ```bash
  bun run build:web
  ```

  （`dev:worker` 启动时会设 `BINGMAIL_SKIP_WEB_BUILD=1`，即启动过程中不再自动构建前端，构建时机由你自己掌握。）

- 只有需要前端热更新（HMR）时才额外开一个终端跑 Vite：

  ```bash
  bun run dev:web
  ```

  Vite 开发服务器会把 `/api` 代理到 8788 上的 Worker。

首次打开页面会进入初始化向导（创建管理员、填邮箱域名、分配主邮箱）。演示账号与此互不影响。

## 4. 测试

```bash
bun run check     # 提交前必跑：typecheck（worker + web）+ 全部测试 + 前端构建
bun run test      # 只跑测试：worker + web
```

只想跑一侧时：

```bash
bun --cwd packages/worker test   # 只跑 worker 测试
bun --cwd apps/web test          # 只跑 web 测试
bun run typecheck                # 只做类型检查（worker + web）
```

本机实测参考：`bun run check` 全绿时约 worker 35 pass / web 15 pass / 前端构建成功。

## 5. 数据位置与清库

本地数据全部落在仓库内，方便整体删除：

| 内容 | 位置 |
| --- | --- |
| D1 数据库 | `.wrangler/state/v3/d1/` |
| R2 附件与原始邮件 | `.wrangler/state/v3/r2/` |
| Durable Object（通知 / 登录限流） | `.wrangler/state/v3/do/` |
| 缓存 | `.wrangler/state/v3/cache/` |
| Wrangler 日志与配置 | `packages/worker/.wrangler-xdg/` |

Wrangler 的 `XDG_*` 变量被重定向到仓库内（见 `packages/worker/scripts/wrangler-env.ts`），所以日志不会散落在用户目录里。

### 清库（三段式：删表 → 清 R2/DO/缓存 → 重跑迁移）

```bash
bun --cwd packages/worker db:reset:local
```

### 演示账号

```bash
bun --cwd packages/worker db:seed:dev
```

- 用户名：`default`
- 密码：`default1234`
- **非管理员**。seed 故意不创建管理员：`isInitialized()` 以「是否存在管理员」判定系统是否初始化，若 seed 里塞了管理员，首次访问的初始化向导会被跳过。

### 额外：清掉卡住的僵尸邮件

本地 worker 如果在解析完成前被停掉，邮件会卡在 `PENDING`（`attempt=1`、正文为空）。把超龄的 `PENDING` 标记为 `FAILED`：

```bash
bun --cwd packages/worker ./scripts/db-fail-stale-pending.ts --older-than-minutes 5
```

## 6. 本机特有的三个坑

这三条是本机 workerd 能不能起来的决定性因素，改脚本或升级依赖前务必先读一遍。实现与原始注释见 `packages/worker/scripts/wrangler-env.ts`。

### 6.1 wrangler 必须精确锁在 4.19.0

新版 wrangler 自带的 workerd 在本机会直接 `std::terminate()` 崩溃，`wrangler dev` 和 `wrangler d1 execute` 全都跑不起来。`packages/worker/package.json` 里已经把 `wrangler` 从 `^4.19.0` 精确锁成 `4.19.0`，**升级前必须在本机重新验证**。

### 6.2 不要用 npx 或 `.bin` shim 包装调用

wrangler 必须是 shell 的直接子进程，并且带显式版本号：

```bash
cmd /c bunx wrangler@4.19.0 --cwd ../.. <args>
```

`npx`、`node_modules/.bin` 里的 shim、嵌套的 `bun run` 包装，以及不带版本号的解析（会捡到提升到仓库根目录的另一个 wrangler），都会让 workerd 崩溃。

### 6.3 不要把含中文的绝对路径传给 cmd

本仓库路径里含「项目」两个字，`cmd.exe` 会把这种非 ASCII 路径弄坏。所以所有脚本统一用 `cmd /c` + `--cwd ../..` 这种相对、纯 ASCII 的路径，并在 `packages/worker` 目录下发起调用。同理，wrangler 的 `--file` 是相对它自己的 `--cwd`（仓库根）解析的，不要传绝对路径。

## 7. 排查表

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 页面 404 / 白屏 | `apps/web/dist` 不存在或已过期（`dev:worker` 跳过了自动构建） | `bun run build:web`，然后刷新页面 |
| `The Workers runtime failed to start` | wrangler 版本不对（被提升到仓库根目录的新版本抢先解析） | 确认 `packages/worker/package.json` 里 `wrangler` 精确为 `4.19.0`，重装 `packages/worker` 依赖；不要用 `npx` / `.bin` shim 调用 |
| `ENOENT ... chdir` | 传给 wrangler 的 `--cwd` 是含中文的绝对路径，被 `cmd.exe` 弄坏 | 改用脚本里的相对路径（`--cwd ../..`），并从 `packages/worker` 目录发起 |
| 登录返回 unauthorized，但密码确认正确 | seed 中的密码哈希迭代次数落在 `src/auth.ts` 的 `[MIN_ITERATIONS, MAX_ITERATIONS]` 之外，`verifyPassword` 直接拒绝 | 不要手写哈希，用 `bun ./scripts/hash-password.ts 你的新密码` 重新生成（脚本会做 verify 往返校验），替换 `packages/db/seeds/dev.sql` 里的哈希 |
| 想彻底重来 | 本地库处于半初始化/脏数据状态 | `bun --cwd packages/worker db:reset:local` 再 `bun --cwd packages/worker db:seed:dev` |
| 邮件一直卡在 `PENDING`（正文为空、`attempt=1`） | 本地 worker 在解析完成前被停掉，行上的锁没有释放 | 跑 `bun --cwd packages/worker ./scripts/db-fail-stale-pending.ts --older-than-minutes 5`，把超龄 `PENDING` 标记为 `FAILED` |
| 用 `/cdn-cgi/handler/email` 注入测试邮件返回 400，报 `invalid or no message id provided` | **`.eml` 缺少 `Message-ID` 头**——本地注入端点强制要求该头，没有就直接 400 | 在 `.eml` 头部补一行 `Message-ID: <唯一值@example.com>`，见下方示例 |
| 注入邮件失败但看不到真实报错 | `Invoke-WebRequest` 会把服务端错误体吞掉，只给一个笼统的状态码 | 改用 `curl.exe` 发请求，才能看到服务端返回的真实错误信息 |

### 本地注入测试邮件的正确姿势

`.eml` 必须带 `Message-ID`（这是最容易踩的一条），最小可用示例：

```text
From: sender@example.com
To: admin@chabing.top
Subject: 测试邮件
Message-ID: <test-1@example.com>
Date: Mon, 01 Jan 2026 00:00:00 +0000
Content-Type: text/plain; charset=utf-8

这是一封本地注入的测试邮件。
```

注入（注意用 `curl.exe`，不要用 `Invoke-WebRequest`，否则看不到服务端真实报错）：

```powershell
curl.exe -i -X POST "http://127.0.0.1:8788/cdn-cgi/handler/email?from=sender@example.com&to=admin@chabing.top" --data-binary "@test.eml" -H "Content-Type: message/rfc822"
```

## 相关文档

- 本地开发与中文环境细节：[dev.md](./dev.md)
- 部署到 Cloudflare 前的检查清单：[deploy-checklist.md](./deploy-checklist.md)
- 邮件渲染相关检查：[email-rendering-checklist.md](./email-rendering-checklist.md)
