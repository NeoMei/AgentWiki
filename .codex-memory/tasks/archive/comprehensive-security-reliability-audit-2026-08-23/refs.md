# 引用与验证

## 主要代码

- `agentwiki/apps/server/src/core/collaboration/collaboration.gateway.ts`
- `agentwiki/apps/server/src/core/security/rate-limit.guard.ts`
- `agentwiki/apps/server/src/knowledge-pipeline/source.service.ts`
- `agentwiki/apps/server/src/memory/memory.service.ts`
- `agentwiki/apps/server/src/assist/opencode.runner.ts`
- `agentwiki/packages/local-sync/src/workspace/layout.ts`
- `agentwiki/apps/client/src/features/guide/ObsidianGuide.tsx`
- `agentwiki/apps/client/src/features/guide/ObsidianConnectionPanel.tsx`

## 最终验证

- `pnpm test`：Runtime 90 pass / 47 env-gated skip；Server 797 pass / 3 env-gated skip；Client 235 pass；Protocol 25 pass；Local Sync 743 pass。
- `pnpm lint && pnpm typecheck && pnpm build`：通过。
- `pnpm audit --prod`：0 known vulnerabilities。
- `pnpm peers check`：0 peer dependency issues。
- `bash -n deploy.sh && git diff --check`：通过。
- `pnpm test:package:local-sync-clean-install`：通过，候选组合为 Local Sync `0.5.1` + Sync Protocol `0.2.0`。
- GitHub 代码发行：`2700baccbf9ba9fda9539c2d1bd2404c683bb248`。
- npm 候选 tarball：148311 bytes，151 entries，SHA-256 `8e7bd2723718c17a4335e1a96b4692de230d1e4052eb42ca2756b5d02f3e2ea2`。
- npm 已发布 `@neomei/agentwiki-local-sync@0.5.1`，`latest=0.5.1`，registry shasum `26cac22f6b156f6c53e5763d212d7e2072956bd1`，公开 CLI 版本探测返回 `{"version":"0.5.1"}`；Sync Protocol 保持 `0.2.0`。
- 发布前数据库备份：`/root/backups/agentwiki/pre-local-sync-0.5.1-20260823-223643.dump`，SHA-256 `644207455d12f8191b5c51b5a871e6b8dfd5ad29a6f045c6a079507c23adc222`；`pg_restore --list` 验证通过。
- 发布前应用备份：`/root/backups/agentwiki/pre-local-sync-0.5.1-20260823-223643-app.tar.gz`，SHA-256 `046fbff3c2628a4272713d1d988ac4e5f92efbcbaa9f79194bcdcf0d85e9d26b`；归档读取验证通过。
- 生产切换保留旧树 `/root/agentwiki-previous-20260823223846`；应用与 Local Sync 为 `0.5.1`，40 条迁移无待执行项，API/Worker/Frontend 均 active/running、`NRestarts=0`、切换后 error 日志为 0。
- 公网与本机 `/api/health` 均返回 database/redis/auditPersistence 全 `ok`；登录态浏览器验证 `/guide/obsidian` 专页和主导航入口，Agent 访问页仅一个统一接入动作且角色恰为 Reader、Editor、Publisher。
