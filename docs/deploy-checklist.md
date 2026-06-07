# 部署 Checklist（Cloudflare）

## 1. 资源创建与绑定

- D1：创建数据库并把 `database_id` 回填到 [wrangler.toml](file:///c:/Users/ChaBi/Desktop/Bingmail/wrangler.toml)
- R2：创建 bucket（与 `wrangler.toml` 名称一致）
- Queue：创建队列（与 `wrangler.toml` 名称一致）
- Email Routing：Cloudflare 控制台启用 Email Routing，并配置转发到 Worker

## 2. Secrets（敏感）

- `JWT_SECRET`（必须）
- `TURNSTILE_SECRET`（可选）

## 3. 数据库迁移

- 本地或 CI 执行：

```bash
bun run db:migrate
```

## 4. 构建与自检

```bash
bun run check
```

## 5. 部署

```bash
bun run deploy:worker
```

## 6. 部署后验证

- `/api/setup/status` 返回正常
- 登录/注册流程可用（Cookie 会话正常）
- 收信后队列解析正常、页面红点/通知正常（WS 或轮询）
