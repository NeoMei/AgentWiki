# Q3 人工回归修复

- 授权：2026-09-14 用户“那修吧”，按 20 项评估实施；不含发布、生产数据写入、日常 Vault 安装。
- 主仓工作树：`/Users/neomei/项目/codexprojects/AgentWiki /.worktrees/q3-fixes-20260914`，分支 `codex/q3-fixes-20260914`，基线 `166383e3`。
- 插件工作树：`/Users/neomei/项目/codexprojects/AgentWiki-Obsidian-q3-fixes`，基线 `5751424`。
- 计划：`docs/superpowers/plans/2026-09-14-q3-fixes.md`。
- 当前执行：发布/搜索、网页交互、图谱、插件分别由子代理处理；协调者处理来源诊断、授权边界与集成测试。进度与代理报告在工作树 `.superpowers/q3/`。
- 先回归复现再修；重点是提交后的人改保护、强制改密、回滚、插件控制/校验完整性。不得绕过保护以使测试通过。
- 独立本地 pgvector 容器 `agentwiki-q3-test-20260914` 用于验收，未连接生产数据库。

