# 参考

- 用户本轮默认 npx 缓存删除拦截反馈、真实 WorkBuddy 验收要求及对 0.13.4 / 0.12.50 的明确“发布”授权。
- WorkBuddy 官方 MCP 文档：https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide
- 隔离路径：`/Users/neomei/.codex/worktrees/generic-mcp-onboarding/AgentWiki `（尾空格）；Git 在根显式 `--work-tree="$PWD"`。

## 当前正式发布：0.13.4 / 0.12.50

- 冻结提交：`99b247c7e21a3322398c7c8a2e7bda4995151e03`；Web/API/client/root 0.12.50、Local Sync 0.13.4、protocol 0.6.1。
- `agentwiki/docs/releases-v0.12.50.md` 与 `agentwiki/docs/verification/workbuddy-npx-20261019/acceptance.md`：修复范围、正式发布与真实宿主验收边界。
- 同目录 `release-candidate.json`、`review.json`、`real-workbuddy.json` 是候选门禁、审查和先行 0.13.3 客户端阶段快照；其中尚未发布的措辞描述当时状态，不改写为正式执行结果。正式执行结果另存 `release.json`、`real-workbuddy-0134.json`。
- `/tmp/agentwiki-0134-release-candidate/`：固定 179 文件 tarball 与最终门禁；SHA256 `d8dc68a986ff9716055a1731a8ee48aabdbff6ce31525f50aaca38e019b3dde0`。
- `/tmp/agentwiki-release-0134-plan/`：`authorization.json`、`npm-publish-result.json`、`registry-verified.json`、`backup-receipt.json`、`deploy-execution.json`、`production-host-verified.json`、`production-public-verified.json`、`guide-verification.json`，分别记录已授权发布、正式包、备份、冻结源码部署与线上检查。
- 同私有目录 `workbuddy-generated-config-0134.json`、`workbuddy-quit-before-update.json`、`workbuddy-start-after-update.json`、`workbuddy-quit-after-trust.json`、`workbuddy-0134-real-mcp-final-evidence.json`：新配置备份与哈希、退出/启动、正式 0.13.4 客户端新会话三次真实 MCP 结果、179 文件匹配和 Node24/npm11 日志。实际 WorkBuddy → npm exec → gateway 进程链及其 NODE_OPTIONS 边界见正式 `real-workbuddy-0134.json`，不以 MCP 进程代替 Bash safe-delete 环境验收。
- 同私有目录 `production-guide.png`、`workbuddy-0134-cold-connected.png`、`workbuddy-0134-page-read.png`：真实 Chrome 和原生客户端界面；不提交。
- 远端协调备份 `/var/backups/agentwiki/generic-mcp-v01250.koa2dsst` 已核验、154 blob 一致、writers 恢复；未做恢复演练。保留旧应用 `/root/agentwiki-previous-20261019031732`。
- 当前 WorkBuddy 配置 SHA256 `7a7a6b6eea4d5f3754e7c572cae6f069f02b1e1485e2bb30d0e825b7acbe1180`；修改前备份 `/Users/neomei/.agentwiki-archive/workbuddy-2026-10-18T191645294Z`。正式读页会话 `9bedded8-9cae-4585-9b8d-20f911996854`，正文 8156B / SHA256 `34e06f9db48b768de26609aa4962c5ec168fd206f670a32a036c44b17032436b`。

## 历史：修复前对照与先行生成配置

- `/tmp/agentwiki-npx-fix-20261019/`：原生默认缓存失败、私有缓存冷/热 npx 对照、原配置备份、先行 0.13.3 首次未信任失败与成功重启的独立证据、私有截图。
- `workbuddy-generated-0133-trusted-restart-evidence.json`：0.13.4 发布前使用官方 0.13.3 的真实配置验收，不能代替正式 0.13.4 证据。

## 历史：0.13.3 / Web0.12.49

- 冻结提交 `1e3fb14001ec33f1c77be1dbfe86f9b02406d382`。
- `agentwiki/docs/verification/workbuddy-guidance-20261019/{release-candidate.json,review.json,release.json}` 与 `agentwiki/docs/releases-v0.12.49.md`：当时 npm/生产/指南及旧连接兼容读页通过，默认 npx 未修复。
- `/tmp/agentwiki-0133-release-candidate/`：175 文件正式包与门禁；`/tmp/agentwiki-release-0133-plan/`：正式 registry、备份、1357 源码、公网资源、指南及旧客户端兼容读页回执。
- 备份 `/var/backups/agentwiki/generic-mcp-v01249.gzemy54b`、旧应用 `/root/agentwiki-previous-20261019015824`；未做恢复演练。

## 历史：0.13.2 / Web0.12.48

- 冻结提交 `0a299231667f03e68f6b97a0501c632602a75ae5`；发布与真实本机账号授权、信任、重启和读页在 `agentwiki/docs/verification/generic-mcp-onboarding-20261018/`。
- `/tmp/agentwiki-workbuddy-acceptance-20261018/{0132-node24-host-read-proof.json,0132-host-read-proof.json,0132-final-doctor.json}`：Node24 修正后的实际读页与旧 Node22 边界；截图、正文和凭据不提交。
- `/tmp/agentwiki-release-20261019-plan/{registry-verified.json,production-source-check.json,public-release.json,backup-receipt.json}`；备份 `/var/backups/agentwiki/generic-mcp-v01248.f0el29jz`、旧应用 `/root/agentwiki-previous-20261019004923`。
- `browser-isolation-correction.md`：wiki.test 错误开窗及原验收结论撤回；后续自动化门禁不覆盖该历史纠正。
