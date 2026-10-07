# 当前目标

- 按用户要求完成 AgentWiki 任务、代码、前后端与UI的多轮全面复审，修复范围内已知值得修复的问题。

# 范围 / 不做

- CodeWiki排除；ACP仅接口定义。不push、merge、release、deploy，不做生产迁移或升级日常客户端。
- 原检索八题收益NOT MET，已按预批准fallback撤回额外检索指导；不改评分、不继续调提示追分。

# 当前状态

- 本轮已完成。产品候选8104a239新增F7已独立42项批准，完整client2170通过，最终typecheck/build/lint通过；最终构建上的模板10/10、Local Sync1/1、F5 REST/MCP8项及资源清理均已核验。
- F1幂等metadata回放、F2 Run异常归属读取、F3 Review失权缓存、F4全量测试门禁/输出、F5同步状态异常归属读取、F6 Admin模板能力投影均已修复。F6修复后server2994通过，6dd46114实际F5 REST/MCP8项GREEN；F7修复后最终模板10/10和Local Sync1/1通过。
- 文档会话/真实选文/批注/双候选/人改/UndoRedo/Save/跨文档续问/冲突/Stop/失权历史、来源审批回滚、graph失权与1280/1600/390长文宽表已实际验证；文档provider为fixture，Q2为source-dev mock UI，边界见验收报告。
- 旧document runtime、6dd46114 runtime和8104a239最终runtime均已CLEANED并外部核验；API55361/web55362、Agent IPC、随机schema及自有临时目录均清零，两个专用测试库已删除，共享PostgreSQL未停止。
- 工作树 `/Users/neomei/.codex/worktrees/knowledge-capabilities/AgentWiki `（尾空格）；分支codex/knowledge-capabilities。基线e0f2d12a，原能力交付ddfaf538已归档，本轮复审为新任务。

# 稳定约束

- 显式Space、实时授权、独立Credential/Grant；权限失效不得返回来源标识、证据或上下文；独立授权页面正文仍可读。
- Markdown单源；人审发布与事实正确性分开；Source head/generation与Page已审代次由服务器维护。
- 固定候选；实现、独立审查、UI、真实Agent质量、部署分别报告。保留失败原件，不能把fixture或测试数量当产品收益。
- Git显式--work-tree；不改core.worktree。本工作树无.codegraph，不自动索引。只清自建资源。

# 关键索引

- .codex-memory/tasks/active/knowledge-comprehensive-audit-20261007/brief.md
- agentwiki/docs/verification/comprehensive-audit-20261007/acceptance.md
- .codex-memory/tasks/archive/knowledge-capabilities-20261007/brief.md
- agentwiki/docs/verification/knowledge-capabilities-20261007/implementation-acceptance.md
- agentwiki/docs/research/openknowledge-20261007/能力增益筛选.md
- .codex-memory/spec/agentwiki-architecture.md

# 风险 / 下一步

- 本轮范围已通过最终任务审查；后续若再改动需新候选重新验证。
- CodeGraph独立安装opt-in、Windows OpenCode启动及Windows ACL三项环境/平台测试未执行，需如实列明。
- 原始证据/tmp/agentwiki-comprehensive-audit-20261007，private state/trace不入repo；结束新runtime后验证PID/端口/schema/IPC，再只drop两自建数据库并归档。
