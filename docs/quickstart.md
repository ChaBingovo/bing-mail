# 启动 & 测试指南

面向"忘了怎么跑起来"的场景。下面所有命令都在**仓库根目录**执行，从上往下照做即可。

一句话：只需要 **Bun**。不需要单独装 Node，不需要 Cloudflare 账号，不需要联网部署——本地用 Miniflare 模拟 D1 / R2 / Queue / Durable Object。

## 1. 前置条件

- `bun --version` 能打印版本号即可（本机实测 `1.3.14`）。
- 不需要单独安装 Node。
- 不需要 `wrangler login`：本地全部走 `--local`。
- Windows 建议先把终端切到 UTF-8，否则中文日志和中文路径会显示为乱码：

```powershell
chcp 65001
```

终端与 Git 的中文环境配置详见 [dev.md](./dev.md)。

## 2. 一次性准备

### 安装依赖

三条命令，后两条**必须**带 `--backend=copyfile`（Windows 下默认的软链接方式需要管理员权限或开发者模式）：

```powershell
bun install
bun install --cwd packages/worker --backend=copyfile
bun install --cwd apps/web --backend=copyfile
```

### 配置 .dev.vars

在仓库根目录创建 `.dev.vars`（已被 git 忽略），至少要设置 `JWT_SECRET`，否则登录签发 JWT 会直接失败：

```ini
JWT_SECRET=dev-secret
WS_MAX_CONNECTIONS=3
TURNSTILE_MODE=off
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET=
```

## 3. 启动

```powershell
bun run dev:worker
```

这一条命令会依次完成：

1. **自动跑数据库迁移**（全新克隆或刚清库之后也能直接起）。
2. 在 <http://127.0.0.1:8788> 启动 Worker，**API 和前端在同一个端口**。
3. 前端静态资源按 `wrangler.toml` 的 `[assets] directory = "apps/web/dist"` 提供。

看到下面这行就绪：

```
[wrangler:info] Ready on http://127.0.0.1:8788
```

然后浏览器打开 <http://127.0.0.1:8788>。首次打开会进入初始化向导（创建管理员 → 填邮箱域名 → 分配主邮箱）。

### 关于前端产物

页面来自**已经构建好的** `apps/web/dist`。改完前端代码要先重新构建，刷新页面才生效：

```powershell
bun run build:web
bun run dev:worker
```

（`dev:worker` 启动时会设 `BINGMAIL_SKIP_WEB_BUILD=1`，即它本身不再触发前端构建，构建时机由你自己掌握。）

只有需要前端热更新时才额外开一个终端：

```powershell
bun run dev:web
```

Vite 会把 `/api` 代理到 8788 上的 Worker。

## 4. 测试

```powershell
bun run check       # 提交前必跑：typecheck(worker+web) + 全部测试 + 前端构建
bun run test        # 只跑测试（worker + web）
bun run typecheck   # 只做类型检查
```

只想跑一侧：

```powershell
bun --cwd packages/worker test
bun --cwd apps/web test
```

本机实测参考值：`bun run check` 全绿时 worker 47 pass / web 15 pass / 前端构建成功。

## 5. 本地数据

### 位置

本地数据全部落在仓库内，方便整体备份或删除：

| 内容 | 位置 |
| --- | --- |
| D1 数据库（用户/邮箱/别名/邮件元数据） | `.wrangler/state/v3/d1/` |
| R2 附件与原始邮件 | `.wrangler/state/v3/r2/` |
| Durable Object（通知 WS、登录限流） | `.wrangler/state/v3/do/` |
| Wrangler 日志与配置 | `packages/worker/.wrangler-xdg/` |

### 清空

```powershell
bun --cwd packages/worker db:reset:local
```

它会：删掉所有表 → 清掉本地 R2 / Durable Object / 缓存 → 重新跑一遍迁移。跑完是仅剩表结构的干净库，页面会重新进入初始化向导。

### 演示账号（可选）

不想走初始化向导时可以灌一个现成账号：

```powershell
bun --cwd packages/worker db:seed:dev
```

- 用户名 `default`，密码 `default1234`，主邮箱 `dev@example.test`
- 权限是**普通用户**：`isInitialized()` 以"存在管理员"为判据，所以 seed 故意不创建管理员，否则初始化向导会被跳过

需要管理员权限时：

```powershell
bunx wrangler@4.19.0 --cwd . d1 execute bingmail --local --yes --command "UPDATE users SET is_admin = 1 WHERE username = 'default';"
```

### 解析卡住的行会自己恢复

邮件解析被中断（例如本地 worker 在解析完成前被停掉）会留下 `PENDING` 行。队列消费者现在**每个批次开头都会机会性清扫一次**，把下面两类无法再推进的行自动置为 `FAILED`：

- 持锁时间超过 lock TTL（默认 5 分钟）的行——持有锁的消费者已经不在了
- `attempt` 已达上限、且邮件早于 6×TTL 的行——重试预算耗尽

清扫只碰超过 TTL 的行，不会打断正在解析的邮件。因此正常情况下你**不需要做任何事**，页面会把它显示为"解析失败"而不是永远"解析中"。

需要人工定点清理时仍可用：

```powershell
bun --cwd packages/worker ./scripts/db-fail-stale-pending.ts --older-than-minutes 10
```

## 6. 本机特有的三个坑

本机环境有三个特殊之处，项目脚本已经绕开；但你手动敲命令时要注意。

### 6.1 wrangler 必须精确锁在 4.19.0

新版 wrangler 自带的 workerd 在这台机器上会直接 `std::terminate()` 崩溃（`wrangler dev` 和 `wrangler d1 execute` 全都起不来）。`packages/worker/package.json` 里已把 `wrangler` 从 `^4.19.0` 精确锁成 `4.19.0`——**升级前必须在本机重新验证**。

手动执行时务必写全版本号 `bunx wrangler@4.19.0`；只写 `bunx wrangler` 会解析到仓库根目录里被其他依赖提升上来的新版本，然后崩掉。

### 6.2 不要用包装器调用 wrangler

经 `npx`、`node_modules/.bin` 的 shim、或再嵌一层 `bun run` 去调 wrangler，都会让 workerd 起不来。项目脚本统一采用下面这一种已验证可行的方式：

```powershell
cmd /c bunx wrangler@4.19.0 --cwd ../.. <args>
```

### 6.3 不要把含中文的绝对路径传给 cmd

`cmd.exe` 会把中文路径（本仓库的 `项目` 目录）传成乱码，导致 `ENOENT: no such file or directory, chdir ...`。脚本统一改用相对路径 `../..` 规避，这也是它们看起来有点绕的原因。

这三条集中注释在 `packages/worker/scripts/wrangler-env.ts` 顶部，改脚本前先看一眼。

## 7. 排查表

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 页面 404 或白屏 | `apps/web/dist` 不存在或已过期（`dev:worker` 不触发前端构建） | `bun run build:web`，再 `bun run dev:worker` |
| `The Workers runtime failed to start` / `std::terminate()` | wrangler 版本不对（被提升到仓库根目录的新版本抢先解析） | 确认 `packages/worker/package.json` 里是精确 `4.19.0`，重装 `packages/worker` 依赖；不要用 `npx` / `.bin` shim 调用 |
| `ENOENT ... chdir` | 把含中文的绝对路径传给了 `cmd` | 改用相对路径，或直接用 `bun run dev:worker` |
| 登录提示 `unauthorized` 但密码没错 | 密码哈希的迭代次数落在 `verifyPassword` 接受区间之外 | 用 `bun ./scripts/hash-password.ts 你的密码` 重新生成，不要手写哈希 |
| 页面一直进初始化向导 | 库里没有管理员账号（`isInitialized()` 以"存在管理员"为判据） | 按向导创建管理员；或按第 5 节灌演示账号 |
| 邮件一直显示"解析中" | 解析被中断，行停在 `PENDING` | 消费者会按 TTL 自动置为 `FAILED`（见 5.4）；也可手工跑 `db-fail-stale-pending.ts` |
| 端口 8788 被占用 | 之前启动的 worker 还活着 | 结束残留的 `workerd` 进程，或关掉对应的终端 |
| 想彻底重来 | 本地库处于半初始化或脏数据状态 | `bun --cwd packages/worker db:reset:local`，再重开 `bun run dev:worker` |

### 手动投递一封测试邮件

本地有一个注入端点可以走**真实收信链路**（R2 落盘 → 队列消费 → MIME 解析 → AI 提码 → WS 通知），比直接往 D1 插一行假数据可靠得多。它的约定是：**`from` / `to` 放 URL 查询参数，原始邮件放请求体**。

先准备一个 `.eml`——注意 `Message-ID` 头**必需**，缺了会直接返回 400 `invalid or no message id provided`：

```
From: Test Sender <sender@example.com>
To: admin@chabing.top
Subject: Your verification code 486213
Message-ID: <test-1@example.com>
MIME-Version: 1.0
Content-Type: text/plain; charset="utf-8"

Your verification code is 486213.
```

然后投递（用 `curl.exe` 而不是 `Invoke-WebRequest`，后者只给一个 400、看不到服务端真实报错）：

```powershell
curl.exe -s -X POST "http://127.0.0.1:8788/cdn-cgi/handler/email?from=sender@example.com&to=admin@chabing.top" --data-binary "@test.eml" -H "Content-Type: message/rfc822"
```

成功时返回 `Worker successfully processed email`。收件人必须已存在于 `mailboxes` 且 `is_active=1`，否则会被 `setReject` 拒绝。

接下来可以在 worker 日志里看到完整链路：`email_ingest_accept → enqueued → stored → queue_message_claimed → queue_r2_raw_read → queue_mime_parsed → queue_ai_start → queue_ai_done → queue_message_saved → queue_fts_updated → queue_notify_sent`。

## 8. 一分钟速查

```powershell
# 一次性
bun install
bun install --cwd packages/worker --backend=copyfile
bun install --cwd apps/web --backend=copyfile

bun run dev:worker        # 启动（含迁移）→ http://127.0.0.1:8788
bun run build:web         # 改了前端后重新构建
bun run check             # 提交前自检：类型 + 测试 + 构建

bun --cwd packages/worker db:reset:local   # 清空本地数据
bun --cwd packages/worker db:seed:dev      # 演示账号 default / default1234
```

相关文档：[summary.md](./summary.md)（项目现状与待办）、[dev.md](./dev.md)（环境细节）、[deploy-checklist.md](./deploy-checklist.md)（部署）、[email-rendering-checklist.md](./email-rendering-checklist.md)（邮件渲染验收）。


