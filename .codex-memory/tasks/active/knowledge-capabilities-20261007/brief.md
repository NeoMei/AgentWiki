# AgentWiki 知识能力增益

用户于2026-10-07批准 `agentwiki/docs/research/openknowledge-20261007/能力增益筛选.md` 实施。

范围：真实Agent检索/正确使用现有知识、明确来源变化后的待复核/更新闭环；提案质量配套。CodeWiki排除。复用既有搜索、图谱、来源、ChangeSet与实时授权。

工作树：`/Users/neomei/.codex/worktrees/knowledge-capabilities/AgentWiki `（尾空格），分支codex/knowledge-capabilities，基线165c207bf4b644efa810ea6c9a3da11d28c4f96e。旧文档会话工作树保持原样。无push/merge/release/deploy授权。

当前：产品读参数/技能60de6602、持久验收harness04d6fc12通过独立代码审查；修正后真实前后各两场核心事实/依据8/8、MCP0错。候选严格引用7/8低于基线8/8，且一处SourceId误称版本，不能全PASS；计划随来源DTO补通用引用规则后复跑固定8题。初次限流失败和新实验均保留。来源Task1修复候选88760ac1通过服务级隔离DB14/14，DDL44fc5f97及corpus已独立批准，schema清理/公共库存核验通过；PAT等待锁时自然到期重验已补且独立复审通过。Task2权限投影/UI/技能在4423d197完成，两轮独立复审通过；root protected content-tree DB21/21通过且清理/公共库存核验通过，原两次旧观察点失败保留。Task3 harness e4bf0db8通过20项纯测试及独立复审，真实API/worker/UI/Agent尚未运行。
