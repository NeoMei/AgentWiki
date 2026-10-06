# 当前目标

- 已批准的OpenKnowledge知识能力借鉴已完成本地有限交付并归档：来源复核闭环完成，检索仅保留有实测依据的参数兼容修复。

# 范围 / 不做

- CodeWiki排除；没有新搜索/上下文/审批服务、自动语义影响分析或自动发布。
- ACP沿用接口定义，不新增完整本机Agent接入；未push/merge/release/deploy、生产迁移或升级日常客户端。

# 当前状态

- 工作树 `/Users/neomei/.codex/worktrees/knowledge-capabilities/AgentWiki `，分支 `codex/knowledge-capabilities`；基线165c207b，最终产品ddfaf538。最终封存提交仅文档，不改该产品树。
- 来源确认同步→关联页面待复核→人工逐项决定/发布→新Agent取得新结论的闭环已通过真实API/worker/UI与合成知识上的真实模型验收；版本代次、人工改稿、恢复/回滚、归档和失权边界均有证据。
- 服务级实际DB14/14与相关content-tree DB21/21；1280/1600/390长文/宽表交互通过，实际UI问题和补证缺口已关闭。独立整分支批准有限范围，未关闭Critical/Important为0。
- 检索冻结八题最终A事实7/8、B8/8，两者严格引用7/8，收益未证明；已按预批准fallback撤回额外检索指导，原分数和失败保留，不能宣称完整质量PASS。
- 所有自建runtime、已知schema/端口/state等资源已清理且公共库存未变。本期任务归档，旧文档自动跟进保持停止。

# 稳定约束

- 显式Space、实时授权、独立Credential/Grant；权限失效不返回来源标识、证据或上下文；独立授权的页面正文仍可读。
- Markdown单源；人审发布与事实正确性分开；Source head/generation与Page已审代次由服务器维护，旧证据不自证当前。
- 固定产品候选，实施/独立审查/真实Agent收益/UI/部署分别记录；模型requested配置不冒充server-resolved证明。
- Git显式work-tree，不改core.worktree；本工作树无CodeGraph目录，不自动索引。

# 关键索引

- .codex-memory/tasks/archive/knowledge-capabilities-20261007/brief.md
- .codex-memory/tasks/archive/knowledge-capabilities-20261007/decisions.md
- .codex-memory/tasks/archive/knowledge-capabilities-20261007/refs.md
- agentwiki/docs/verification/knowledge-capabilities-20261007/implementation-acceptance.md
- agentwiki/docs/verification/knowledge-capabilities-20261007/whole-branch-review.md
- agentwiki/docs/research/openknowledge-20261007/能力增益筛选.md
- .codex-memory/spec/agentwiki-architecture.md

# 风险 / 下一步

- 本期无继续调提示追分的任务；部署或日常客户端升级未执行，不能将本地完成当作线上生效。
- 旧基线验证checkout因app归属元数据冲突保留，没有运行进程；早期未知路径的迁移临时bundle未擅删，不宣称全文件系统无残留。
- 受控迟到worker竞态仅服务级DB验证；来源主线无关系边；gateway stdio resources/read不支持，server /api/mcp读取通过。完整证据范围见交付报告。
