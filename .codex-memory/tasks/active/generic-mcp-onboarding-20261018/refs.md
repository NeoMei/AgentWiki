# 参考

- 用户本轮反馈、真实 WorkBuddy 验收要求及明确“发布”授权。
- WorkBuddy 官方 MCP 文档：https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide
- 隔离路径：`/Users/neomei/.codex/worktrees/generic-mcp-onboarding/AgentWiki `（尾空格）；Git 在根显式 `--work-tree="$PWD"`。

## 当前发布

- `release-candidate.json` 与 `review.json` 是发布前阶段快照，其 prepared/not-yet 文字仅表示当时状态；当前正式执行结果以 `release.json` 为准。旧快照只补冻结关联和最终 cause 保留检查，不重写历史。

- 冻结提交：`1e3fb14001ec33f1c77be1dbfe86f9b02406d382`；Web/API/client/root 0.12.49、Local Sync 0.13.3、protocol 0.6.1。
- `agentwiki/docs/verification/workbuddy-guidance-20261019/{release-candidate.json,review.json,release.json}`：候选门禁、独立审查与执行回执；npm、生产源码/资源/健康、真实 Chrome/API 指南、既有宿主部署后 MCP 读页兼容均通过；0.13.3 新接入和默认 npx 路径未验收。
- `agentwiki/docs/releases-v0.12.49.md`：指引和跨版本推进保护的发行范围及默认路径边界。
- `/tmp/agentwiki-0133-release-candidate/`：最终175文件tarball、package-files.json、npm-pack.json、fixed-pack-verified.json与门禁日志。
- `/tmp/agentwiki-release-0133-plan/`：registry-verified.json、backup-receipt.json、冻结源码清单、部署/线上验证，含 production-source-check.json、public-release.json、guide-verification.json、workbuddy-postdeploy-read.json；仅脱敏回执提交。
- 远端协调备份：`/var/backups/agentwiki/generic-mcp-v01249.gzemy54b`；154 blob、约7.001秒 writer暂停、恢复完成，未演练恢复。

- 本轮保留旧应用：`/root/agentwiki-previous-20261019015824`。真实 Chrome 截图仅存 `/tmp/agentwiki-release-0133-plan/production-guide.png`，原生 WorkBuddy 结果截图为同目录 `workbuddy-postdeploy-read.png`，均不提交。

## 历史证据

- 0.13.2 / Web0.12.48 冻结提交：`0a299231667f03e68f6b97a0501c632602a75ae5`；其发布和真实本机验收在 `agentwiki/docs/verification/generic-mcp-onboarding-20261018/`。
- 真实原始证据：`/tmp/agentwiki-workbuddy-acceptance-20261018/{0132-node24-host-read-proof.json,0132-host-read-proof.json,0132-final-doctor.json}`；前者证明本机 Node24 修正后真实读页，第二个保留旧 Node22 边界。
- 私有最终界面：同目录 `0132-node24-final-read.png` 和 `0132-node24-client-trusted.png`；图片、正文和凭据不提交。
- 0.13.2 发布原始元数据：`/tmp/agentwiki-release-20261019-plan/{registry-verified.json,production-source-check.json,public-release.json,backup-receipt.json}`；其备份 `/var/backups/agentwiki/generic-mcp-v01248.f0el29jz` 与旧应用 `/root/agentwiki-previous-20261019004923` 保留。
- `browser-isolation-correction.md`：wiki.test错误开窗和先前验收结论撤回；不能由本轮自动化门禁覆盖真实验收边界。

- `agentwiki/docs/verification/workbuddy-npx-20261019/`：本轮npx修复/真实客户端/候选门禁及审查回执。
- `/tmp/agentwiki-npx-fix-20261019/`：原生冷/热npx对照、原配置备份、失败与可信重启独立证据、私有截图。
- `/tmp/agentwiki-0134-release-candidate/`：固定0.13.4候选tarball与门禁。
- `/tmp/agentwiki-release-0134-plan/`：仅准备的新发布/备份/验证脚本；本轮尚未生产写入。
