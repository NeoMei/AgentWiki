# 统一 Agent 会话侧栏

用户已确认推进 OpenKnowledge ACP 调研后的第一阶段：阅读/编辑共用持久会话、跨文档上下文、显式引用/私人笔记、候选审阅；本轮只定义 ACP adapter 边界，不连接本机 Agent。

- 工作树：`/Users/neomei/.codex/worktrees/document-workspace/AgentWiki `（尾空格），分支 codex/document-workspace；基线 ee9348839924fd7566ff3b67fa72beb6090a77ea。
- 设计/计划：agentwiki/docs/superpowers/{specs,plans}/2026-10-06-agent-sessions.md。
- 当前：只读前后端/运行环境调研完成，设计和计划已固定，即将派发 Task 1 后端实现。
- 约束：p5c07ff、fresh 实施/独立审查、单 Markdown/候选→草稿→Save、权限与版本校验、550000 JS 预算、不部署。
- 验收：Task 1 后端+迁移审查，Task 2 统一 UI，Task 3 隔离 DB/实际构建浏览器/最终审查与清理。

尚无新功能代码或运行验收。上一轮全页布局已完成，见 archive/document-fullpage-layout-20261006。
