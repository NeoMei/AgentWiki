# 当前目标

- 实施已批准的知识能力增益：真实Agent正确复用知识、来源变化后的复核更新闭环，提案质量作为配套。

# 范围 / 不做

- CodeWiki排除；不新建搜索系统或审批系统；不自动发布。
- 本地实施、独立审查和隔离验收；不push/merge/release/deploy。

# 当前状态

- 自有工作树 `/Users/neomei/.codex/worktrees/knowledge-capabilities/AgentWiki `，分支codex/knowledge-capabilities，基线165c207bf4b644efa810ea6c9a3da11d28c4f96e。
- 旧文档会话在f4325942已独立验收，边界与记录保留；本期为新任务。
- 依赖与定向基线完成；检索harness候选b42ce1ef已构建，独立审查中，真实Agent基线待运行。来源复核spec/plan已完成并修正独立设计审查发现。

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

- 固定可复现的知识语料与真实Agent基线；据证据选择最小检索改进。
- 来源有效性先覆盖一种可证明关联的场景；不承诺任意代码变化的精确影响分析。
