# 部署 Checklist（Cloudflare）

## 1. 部署前

- 已登录 Wrangler（或使用 Cloudflare 一键部署 / Workers Builds 导入仓库自动创建 D1、R2、Queue）。
- 若绑定的不是自动新建的已有资源，确认 D1、R2 bucket、Queue 名称与 `wrangler.jsonc` 一致。
- Email Routing、MX 记录和目标 Worker 路由已在 Cloudflare 控制台配置。
- `JWT_SECRET` 已通过 Cloudflare Worker Secrets 或 `wrangler secret put JWT_SECRET` 配置；使用 Resend 发信或启用 Turnstile 时同步配置 `RESEND_API_KEY` / `TURNSTILE_SECRET`。不要把密钥写进 D1 设置或提交到仓库。

## 2. 验证与迁移

```bash
bun run check
bun run build
bun run deploy
```

使用 `Deploy to Cloudflare` 或 Cloudflare 控制台导入仓库时，将 Build command 设为 `bun run build`，Deploy command 设为 `bun run deploy`（会先执行 `npx wrangler deploy` 自动创建资源并部署 Worker，再执行 `npx wrangler d1 migrations apply DB --remote` 创建数据表）。

## 4. 部署后验证

- `/api/setup/status` 返回正常；首次部署可完成初始化向导。
- 登录、注销、改密后的会话吊销和注册开关符合预期。
- Email Routing 投递测试邮件后，邮件依次经历 `PENDING → SUCCESS`；失败时能看到 `FAILED` 并可重试。
- HTML、附件、CID 图片、外部图片代理和全文搜索可用。
- 页面已打开时收到 WebSocket 提示；断线后轮询仍能发现新邮件。
- 发送一封纯文本测试邮件，并检查每日额度和已发送记录。
- 查看 Workers 日志，确认没有持续的 Queue、R2、D1 或 AI 错误。
