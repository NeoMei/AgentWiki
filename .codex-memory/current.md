# 当前目标

- 实施已批准的知识能力增益：真实Agent正确复用知识、来源变化后的复核更新闭环，提案质量作为配套。

# 范围 / 不做

- CodeWiki排除；不新建搜索系统或审批系统；不自动发布。
- 本地实施、独立审查和隔离验收；不push/merge/release/deploy。

# 当前状态

- 自有工作树 `/Users/neomei/.codex/worktrees/knowledge-capabilities/AgentWiki `，分支codex/knowledge-capabilities，基线165c207bf4b644efa810ea6c9a3da11d28c4f96e。
- 旧文档会话在f4325942已独立验收，边界与记录保留；本期为新任务。
- 检索产品60de6602与持久验收harness04d6fc12已独立审查；修正后前后各两场真实Agent均事实/依据8/8、MCP零错，但候选严格引用7/8且一处SourceId误标版本，质量gate未关闭。原实验与新结果均保存；来源Task1修复候选88760ac1已完成服务级隔离DB14/14、公共库存未变；PAT锁等待期间到期重验已补，独立复审中。DDL44fc5f97已独立批准；Task3 harness e4bf0db8通过独立复审、仅纯测试，未启动产品验收。

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

- 关闭来源Task1审查修复，再实现Task2权限投影/UI/通用引用精度（含个人sources:read边界），Task3做实际API/worker/UI/Agent验收并复跑固定8题。
- 来源有效性先覆盖一种可证明关联的场景；不承诺任意代码变化的精确影响分析。
