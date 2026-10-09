# AgentWiki 知识能力增益：本地交付完成

用户于2026-10-07批准 `agentwiki/docs/research/openknowledge-20261007/能力增益筛选.md` 实施。已按预先批准的收益不足收缩规则完成有限交付，独立整分支审查批准，未关闭Critical/Important为0；未将检索质量失败改写为通过。

工作树：`/Users/neomei/.codex/worktrees/knowledge-capabilities/AgentWiki `（尾空格），分支 `codex/knowledge-capabilities`。基线 `165c207bf4b644efa810ea6c9a3da11d28c4f96e`，最终产品 `ddfaf538678f95b56724d3f4b79d328e7b24adc2`。后续仅交付文档封存。旧文档工作树保持原样。

## 完成范围

- 来源变化复核：确认同步同一OKF sourceKey推进head/generation，直接关联页面待复核但正文不变；既有人审逐项接受/拒绝和正式发布后对齐。历史依据、A→B→A、旧候选、人工改稿、恢复/精确回滚、归档与实时授权边界完成。
- 读取与UI：按实际Page快照返回有权限的最小来源/版本/证据；unknown不冒充current；无来源权限保留独立授权正文并隐藏来源。实际长文/宽表与侧栏/目录在1280/1600/390验收通过。两处实际UI问题与一次回滚截图等待缺口已修并补证，原失败保留。
- Agent工具：六个只读工具支持命名参数与legacy兼容。冻结八题最终A事实7/8、B8/8，两者严格引用7/8，收益未证明；撤回五步检索coaching及双引用提示，仅保留参数兼容和客观来源语义。

## 验证与边界

服务级真实PostgreSQL14/14、相关content-tree DB21/21；实际确认OKF/worker/UI审阅发布与两位新native Codex消费者验证来源更新前后结论。检索另有完整基线/候选/整合/收缩实验，题目、旧评分和失败保留。合成知识输入、真实模型/API、独立审查与UI分别记录。

所有自建运行环境、已知schema/端口/凭据state及临时资源完成清理，公共库存未变；旧基线checkout因app归属元数据冲突保留，无运行进程。早期未知路径的迁移临时bundle未擅删，不宣称全文件系统无残留。受控迟到worker竞态只有服务级DB证据；主来源场景无graph边；gateway stdio不支持resources/read，但server /api/mcp资源读取实际通过。具体限制见交付报告。

CodeWiki排除，没有新搜索/上下文/审批服务或自动发布。ACP保留既有接口定义，无完整新增本机Agent接入；没有push/merge/release/deploy、生产迁移或日常客户端升级。本期归档，不继续通过调提示或追加模型轮次追求基准分数。

交付入口：`agentwiki/docs/verification/knowledge-capabilities-20261007/implementation-acceptance.md`。
