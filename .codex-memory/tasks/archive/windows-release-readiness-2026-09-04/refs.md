# 参考与验证

- 验收计划：`agentwiki/docs/superpowers/plans/2026-09-03-release-readiness-audit.md`
- 既有缺陷修复记录：`agentwiki/docs/verification/agentwikiq-remediation-2026-08-19.md`
- 完整测试：`pnpm test` -> 4044 passed / 79 skipped / 0 failed
- 静态门禁：`pnpm typecheck`、`pnpm lint`、`pnpm build`
- 依赖门禁：`pnpm install --frozen-lockfile --offline`、`pnpm audit` -> no known vulnerabilities
- UI 收集：`pnpm --filter @agentwiki/client exec playwright test --list` -> 25 tests / 7 files
- 渲染验收：Browser/Chromium，桌面与 390x844；公开首页、认证入口、中英文、键盘页签、未登录 workspace 重定向、焦点、ARIA、横向溢出与控制台。
