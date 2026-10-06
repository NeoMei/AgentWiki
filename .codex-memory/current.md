# 当前目标

- 实施已批准的知识能力增益：真实Agent正确复用知识、来源变化后的复核更新闭环，提案质量作为配套。

# 范围 / 不做

- CodeWiki排除；不新建搜索系统或审批系统；不自动发布。
- 本地实施、独立审查和隔离验收；不push/merge/release/deploy。

# 当前状态

- 自有工作树 `/Users/neomei/.codex/worktrees/knowledge-capabilities/AgentWiki `，分支codex/knowledge-capabilities，基线165c207bf4b644efa810ea6c9a3da11d28c4f96e。
- 旧文档会话在f4325942已独立验收，边界与记录保留；本期为新任务。
- 检索harness659a6ee2经独立审查及实际runtime通过。两场真实gpt-6-astra/high基线均事实8/8，一场发生命名参数失败后重试成功；baseline已清理，证据在/tmp/agentwiki-knowledge-20261007。Task2参数/技能改进已提交60de6602，构建成功、独立审查中；生命周期尚未改产品。

# 稳定约束

- 显式Space、实时授权、独立Credential/Grant；权限失效不返回来源或上下文。
- Markdown单源；提案/人审/发布与知识有效性分开。
- fresh任务实施与独立审查；真实Agent收益、结构测试、UI、部署分别记录。
- Git显式work-tree，不改core.worktree；CodeGraph目录不存在，不自动索引。

# 关键索引

- .codex-memory/tasks/active/knowledge-capabilities-20261007/brief.md
- .codex-memory/tasks/active/knowledge-capabilities-20261007/decisions.md
- .codex-memory/tasks/active/knowledge-capabilities-20261007/refs.md
- agentwiki/docs/research/openknowledge-20261007/能力增益筛选.md
- agentwiki/docs/superpowers/plans/2026-10-07-knowledge-retrieval.md
- agentwiki/docs/superpowers/plans/2026-10-07-source-freshness.md
- .superpowers/sdd/ 对应plan的ignored进度与审查回执

# 风险 / 下一步

- Task2完成后独立review与同语料两场新消费者对照；不把基线满分宣传成正确率提升。
- 来源有效性先覆盖一种可证明关联的场景；不承诺任意代码变化的精确影响分析。
