# 参考

- 用户本轮4项反馈及 WorkBuddy doctor 5条细项。
- WorkBuddy官方MCP文档：https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide
- 基线：9851195ecdbdcb9d2fbcddb74bdd950b3d4454a5。
- 隔离路径：/Users/neomei/.codex/worktrees/generic-mcp-onboarding/AgentWiki （尾空格）。Git显式--work-tree。
- agentwiki/docs/verification/generic-mcp-onboarding-20261018/ 保存修复/审查/浏览器证据。

- 冻结发布候选：0a299231667f03e68f6b97a0501c632602a75ae5；Web/API 0.12.48、Local Sync 0.13.2、protocol 0.6.1。用户已明确批准发布及后续真实验收，授权持续有效。
- 真实旧连接与新流程边界：agentwiki/docs/verification/generic-mcp-onboarding-20261018/workbuddy-real-acceptance.md。
- 发布包与执行计划：同目录 release-candidate.{md,json}、release-execution-plan.md；tarball 位于 /tmp/agentwiki-0132-release-candidate/，准备脚本和清单位于 /tmp/agentwiki-release-20261019-plan/。
- 2026-10-19正式发布回执：同目录release.json与release-progress.json，npm0.13.2正式可用、Web/API0.12.48生产部署及公网资源通过；真实新WorkBuddy验收进行中。
- 原始本地证据：/tmp/agentwiki-release-20261019-plan/{registry-verified.json,production-source-check.json,public-release.json,backup-receipt.json}；仅脱敏元数据进入仓库。
- 远端协调备份：/var/backups/agentwiki/generic-mcp-v01248.f0el29jz，154blob匹配、writers已恢复；旧应用/root/agentwiki-previous-20261019004923。未执行恢复演练。
