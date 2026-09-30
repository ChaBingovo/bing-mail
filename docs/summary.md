# 项目现状总结

最后更新：2026-10-01（beta 分支 `f2174f7`）

本文记录 Bingmail 当前的功能状态、本轮完成的工作、待办事项与已知限制。启动与测试流程见 [quickstart.md](./quickstart.md)，部署见 [deploy-checklist.md](./deploy-checklist.md)。

## 一、项目是什么

部署在 Cloudflare 上的个人网页邮箱：用自有域名收信，在浏览器里查看邮件、管理别名、搜索历史邮件，并用实时通知与 AI 提取验证码。

技术栈：Cloudflare Workers + D1 + R2 + Queues + Durable Objects + Workers AI，前端 SolidJS + Tailwind。单仓多包：`apps/web`、`packages/worker`、`packages/db`。

**邮件流（当前重心）**：

```
Email Routing → Worker email() → 校验收件人/黑名单 → R2 存原始邮件
                                          → Queue 入队（先入队后落库）
Queue 消费 → 抢锁 → 读 R2 → MIME 解析 → AI 提码 → 落库 SUCCESS
                                          → 更新 FTS5 → 通知 Durable Object → WebSocket 推送
```

## 二、当前能力

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 收信（主邮箱 + 别名） | 可用 | 未知收件人与黑名单会 `setReject` |
| 邮件正文渲染 | 可用 | HTML 走 Shadow DOM + DOMPurify + CSP sandbox；纯文本/Markdown 有降级 |
| 外部图片 | 可用 | 走 `/api/media/proxy`，带出站白名单、重定向上限、体积上限 |
| AI 提取验证码 | 可用 | 先正则粗筛再调 Workers AI，实测能正确提取验证码与服务名 |
| 实时通知 | 可用 | WebSocket 推送 + 轮询回退（连续失败降级） |
| 搜索 | 可用 | FTS5；输入会 token 引用化，非法语法返回 400 而非 500 |
| 别名管理 | 可用 | 上限由 `max_aliases` 控制，`0` 表示禁用 |
| 管理后台 | 可用 | 用户/邮箱/域名/注册开关/Turnstile 配置 |
| 游标分页 | 可用 | 首屏 100 条，可"加载更早的邮件" |
| 发信 | **未实现** | `wrangler.toml` 有 `send_email` 绑定但未接入主流程 |

## 三、本轮完成的工作

### 3.1 审查问题分级修复（P0→P3）

| 级别 | 问题 | 处理 |
| --- | --- | --- |
| P0 | seed 默认账号无法登录（哈希 210k 迭代 vs 校验上限 100k），且会让初始化向导撞用户名 | 参数抽成单一事实来源、重算哈希、补主邮箱、新增生成脚本与回归测试 |
| P0 | 账号创建「先查后插」并发下 500 | 改为原子插入 + 唯一冲突分类 409 + 半成品账号回滚 |
| P1 | `/api/media/proxy` 是 SSRF 跳板与开放图片代理 | 新增 `url-guard.ts`，逐跳校验、重定向 ≤3、10MiB 硬上限、魔数嗅探 |
| P1 | 会话迁移只做一半（响应仍回传 token，前端保留死代码） | 只走 HttpOnly Cookie，删除前端 token 与 Bearer 注入 |
| P2 | `max_aliases = 0` 失效（回退成 3） | `parseSettingInt` 显式处理"未设置"，`0` 生效 |
| P2 | 入队失败留下永远 PENDING 的僵尸邮件 | 改为先入队后落库，失败则 `setReject` 让发信方重试 |
| P3 | 搜索输入未净化导致 500 | `toFtsMatch()` 引用化 + 错误转 400 |
| P3 | 前端未使用已实现的游标分页；FAILED 状态缺失 | 接入分页、统一三态状态 |

### 3.2 本地工具链修复

本地曾完全跑不起来，根因有三条（都已在脚本中绕开并注释）：

1. `wrangler` 被解析到 4.94.0，其自带 workerd 在本机 `std::terminate()` 崩溃 → 精确锁定 `4.19.0`。
2. 经 `npx` / `.bin` shim / 嵌套 `bun run` 调用 wrangler 都会让 workerd 起不来 → 统一为 `cmd /c` + 精确版本 + 相对路径。
3. 含中文的仓库绝对路径经 `cmd` 会变乱码导致 `ENOENT chdir` → 全部改用相对路径。

另修复：`db:seed:dev` 的 `--file` 路径错误；`db:reset:local` 补充清理 R2 / DO / 缓存并按三段式输出。

### 3.3 解析可靠性

- **僵尸 PENDING 自愈**：队列消费者每批次机会性清扫，把「持锁超过 TTL」与「attempt 耗尽且行已过期」的行置为 FAILED，不再永久显示"解析中"。
- **attempt 耗尽自动重投**：把每次重投视为新周期（重置 attempt、复用同一行与 `r2_raw_key`、重新入队并 ack 当前投递）；持锁的行仍静默跳过，避免重复解析；硬上限 30 次后永久 FAILED，防毒邮件循环；入队失败会回滚计数交给清扫兜底。

### 3.4 测试与文档

- 测试从 6 + 8 增至 **worker 47 / web 15**，新增覆盖：seed 哈希可验证、账号创建 409 分类、媒体代理出站白名单、Cookie 会话契约、别名配额为 0、入队顺序、认领未命中语义、重投与硬上限、僵尸清扫、FTS 查询净化、本地状态清理、游标分页合并。
- 新增文档：[quickstart.md](./quickstart.md)（启动与测试指南）。
- 修正文档：`deploy-checklist.md` 里失效的本机绝对路径、README 补充自检命令、`.gitattributes` 收敛行尾噪音。

### 3.5 验证方式

每项改动都跑过 `bun run check`（typecheck + 全部测试 + 前端构建），并对关键路径做了端到端实测：

- 收信全链路：注入测试邮件 → 11 个环节日志齐全 → AI 提取 `486213`(GitHub) / `730418`(Notion) → API 可见。
- 僵尸自愈：人工造超龄 PENDING 行 → 启动 worker 投递新邮件 → 该行自动置 FAILED，且新邮件正常解析。
- 清库：造假的 R2 附件 → `db:reset:local` → 附件被清、8 个迁移重新应用、库里只剩表结构。
- 部署配置：`wrangler deploy --dry-run` 通过（Worker 200 KiB / gzip 43.5 KiB）。

## 四、待实现（按优先级）

### P1 — 建议优先

1. **CI 只做类型检查**：`.github/workflows/deploy-worker.yml` 目前只有 `Typecheck (worker)`，**没有跑测试、也没有跑前端构建**（前端构建只在部署时由 `[build]` 触发）。回归可以在 CI 全绿的情况下溜进主分支。建议把该步骤换成 `bun run check`。
2. **媒体代理没有测试覆盖**：`/api/media/proxy` 的路由层零测试（只有 `url-guard.ts` 的单元测试）。它的参数解析、重定向上限、体积上限、内容类型判定都还没有守护，属于安全相关代码。
3. **发信未实现**：`wrangler.toml` 里有 `send_email` 绑定但没有任何发送流程。若要"主力邮箱"，这是最大缺口。

### P2 — 值得做

4. **无失败重试入口**：解析最终失败的行只能看到 FAILED，不能在界面上「重试」。后端已有重投机制，缺一个受控的手动触发接口。
5. **R2 没有生命周期管理**：原始邮件与超限 HTML 永久留在 R2，没有任何清理策略（`lifecycle`/定时删除都没有），长期运行会持续增长。
6. **搜索语法能力有限**：为安全起见把所有 token 都引用化，用户无法使用 `OR`/排除/前缀等 FTS 语法。若要高级检索需要额外设计。
7. **搜索只在当前邮箱内**：不接受 `address=*`，跨邮箱搜索需要先补权限设计。

### P3 — 打磨

8. **DOM 渲染层无自动测试**：`ShadowHtml` / `EmailViewer` 的降级路径（渲染异常时回退纯文本）只有人工清单（[email-rendering-checklist.md](./email-rendering-checklist.md)），没有自动测试。
9. **测试用例数散落在文档里**：quickstart 里的 "worker 47 / web 15" 需要手工同步，容易过期。

## 五、已知限制与陷阱

| 项 | 说明 |
| --- | --- |
| wrangler 版本被锁死 | 本机 workerd 只接受 4.19.0；升级前必须在本地重新验证 `dev` 与 `d1 execute` |
| 调用方式受限 | 必须 `cmd /c` + 精确版本 + 相对路径，见 `packages/worker/scripts/wrangler-env.ts` 顶部注释 |
| 本地状态位置 | 数据库在 `.wrangler/state`（仓库根），日志/配置在 `packages/worker/.wrangler-xdg/` |
| 本地注入测试邮件 | `.eml` 必须带 `Message-ID` 头，否则 400；用 `curl.exe` 才能看到服务端真实报错 |
| D1 无多语句事务 | 账号创建用「原子插入 + 失败回滚」补偿，而不是事务 |
| Lazy schema 是禁止的 | 数据库改动必须走 `packages/db/migrations/`，不允许在业务代码里做字段兼容（见 AGENTS.md） |
| 仓库路径含中文 | 不要把它传给 `cmd`；脚本一律用相对路径 |

## 六、快速核对

```powershell
bun run check                                       # typecheck + 测试 + 构建（当前 worker 47 / web 15 全绿）
bun run dev:worker                                  # 启动 → http://127.0.0.1:8788
bun --cwd packages/worker db:reset:local            # 清空本地数据
bunx wrangler@4.19.0 --cwd . deploy --dry-run       # 校验部署配置
```

工作区当前状态：`beta` 分支、工作区干净、已与 `origin/beta` 同步。本地数据库在最近一次 `db:reset:local` 后为空，首次打开会进入初始化向导。

> 第四节的待办同时维护在仓库根目录的 `TODO.md`（该文件被 `.gitignore` 排除，属于本地文件）：原有分级清单保留为历史记录，其下新增了「下一轮（2026-10 审查新增）」章节。


