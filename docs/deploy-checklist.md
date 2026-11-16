# 部署 Checklist（Cloudflare）

## 1. 部署前

- 已登录 Wrangler，且 API Token 具备 Workers、D1、R2、Queues 与所需 Secret 管理权限（使用 Cloudflare 一键部署可自动创建这些资源）。
- 已创建或确认 D1、R2 bucket、Queue；名称必须与 `wrangler.jsonc` 一致。
- 手动部署时，`wrangler.jsonc` 中的 D1 `database_id` 已替换 `REPLACE_ME`（一键部署会自动回填）。
- Email Routing、MX 记录和目标 Worker 路由已在 Cloudflare 控制台配置。
- `JWT_SECRET` 已通过 `wrangler secret put JWT_SECRET` 或 CI Secret 配置；启用 Turnstile 时同样配置 `TURNSTILE_SECRET`。不要把密钥写进 D1 设置或提交到仓库。

## 2. 验证与迁移

```bash
bun run check

# 这是生产 D1 的迁移；bun run db:migrate 只操作本地 Miniflare 数据库。
bun --cwd packages/worker db:migrate:remote
```

## 3. 部署

```bash
bun run deploy:worker
```

使用 `Deploy to Cloudflare` 一键部署时，Cloudflare Workers Builds 会自动执行 `bun run build` 与 `bun run deploy`（含远程 D1 迁移）；手动部署仍必须完成上面的远程迁移。

## 4. 部署后验证

- `/api/setup/status` 返回正常；首次部署可完成初始化向导。
- 登录、注销、改密后的会话吊销和注册开关符合预期。
- Email Routing 投递测试邮件后，邮件依次经历 `PENDING → SUCCESS`；失败时能看到 `FAILED` 并可重试。
- HTML、附件、CID 图片、外部图片代理和全文搜索可用。
- 页面已打开时收到 WebSocket 提示；断线后轮询仍能发现新邮件。
- 发送一封纯文本测试邮件，并检查每日额度和已发送记录。
- 查看 Workers 日志，确认没有持续的 Queue、R2、D1 或 AI 错误。
