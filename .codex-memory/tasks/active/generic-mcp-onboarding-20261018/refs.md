# 参考

- 用户本轮4项反馈及 WorkBuddy doctor 5条细项。
- WorkBuddy官方MCP文档：https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide
- 基线：9851195ecdbdcb9d2fbcddb74bdd950b3d4454a5。
- 隔离路径：/Users/neomei/.codex/worktrees/generic-mcp-onboarding/AgentWiki （尾空格）。Git显式--work-tree。
- agentwiki/docs/verification/generic-mcp-onboarding-20261018/ 保存修复/审查/浏览器证据。

- 冻结发布候选：0a299231667f03e68f6b97a0501c632602a75ae5；Web/API 0.12.48、Local Sync 0.13.2、protocol 0.6.1。用户已明确批准发布及后续真实验收，授权持续有效。
- 真实旧连接与新流程边界：agentwiki/docs/verification/generic-mcp-onboarding-20261018/workbuddy-real-acceptance.md。
- 发布包与执行计划：同目录 release-candidate.{md,json}、release-execution-plan.md；tarball 位于 /tmp/agentwiki-0132-release-candidate/，准备脚本和清单位于 /tmp/agentwiki-release-20261019-plan/。
- 当前认证前检（2026-10-19）：npm whoami E401；SSH BatchMode Permission denied；控制 socket /tmp/agentwiki-release-ssh/control 尚不存在。npm 真实 Chrome 安全密钥登录与用户终端 SSH ControlPath 登录待完成；未执行发布、部署或远端写入。无需重新申请同一发布许可。
