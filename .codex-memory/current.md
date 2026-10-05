# 当前目标

- 按已确认的 OpenKnowledge 借鉴方案优化 AgentWiki 文档工作区、目录树、手工和 Agent 编辑体验。

# 范围 / 不做

- 已获实施授权；单栏工作区、候选审阅、草稿恢复、精确修改及个人批注队列，可视编辑器独立试点。
- 不直接复制 OpenKnowledge 源码，不引入 CRDT 或数据库迁移，不修改生产文档。发布与部署不作为本地实施完成的隐含结果。

# 当前状态

- 隔离工作区 /Users/neomei/.codex/worktrees/document-workspace/AgentWiki （末尾空格），分支 codex/document-workspace，起点 c7b89567。
- 实施计划已写；依赖安装完成，基线测试与可视编辑试点进行中。
- 既有线上版本 0.12.12 / Local Sync 0.11.0 的发布证据仍保留；本任务尚无产品候选。

# 稳定约束

- Git 必须显式 work-tree，勿改 core.worktree。
- 读写互斥、同一 Markdown 源；保留 Space 权限、版本和附件/同步语义，所有新文案双语。
- 测试、独立审查、集成、浏览器验收、发布和生产部署分别记证据。

# 关键索引

- .codex-memory/tasks/active/document-workspace-20261006/brief.md
- agentwiki/docs/superpowers/plans/2026-10-06-document-workspace.md
- agentwiki/docs/research/openknowledge-20261006/借鉴分析与改造建议.md
- agentwiki/docs/verification/multi-space-v01212/release-receipt.json

# 风险 / 下一步

- 先修 Assist 流式结果直接替换人工草稿，再新增草稿恢复。
- 可视编辑器需通过真实 Markdown 语料，不能假定换库无损。
