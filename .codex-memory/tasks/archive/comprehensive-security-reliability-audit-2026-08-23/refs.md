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
- npm 候选 tarball：148311 bytes，151 entries，SHA-256 `8e7bd2723718c17a4335e1a96b4692de230d1e4052eb42ca2756b5d02f3e2ea2`；授权超时后 registry 反查仍无 `0.5.1`。
