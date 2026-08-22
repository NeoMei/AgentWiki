<!-- codex-memory:template=current:v1 -->

# 当前目标

- 主目标：完成 Agent 协作模板与组件的书面 Spec 审阅，然后形成实施计划。
- 前置活跃任务：先实现并验证 Agent 统一访问角色 0.5.0，再实施协作模板。

# 范围 / 不做

- 协作模板首期包括编码、标书、论文、视频脚本和小说五类内置模板。
- 组件包括 Agent 任务、顺序 Todo、依赖/并行、人工审核和结果交接/汇总。
- 外部 Agent 通过统一 MCP 主动领取和回传；AgentWiki 只做协作控制面，不托管模型。
- 不做远程自动唤醒、自由拖拽、条件/循环/Webhook/子流程、动态竞领、自动改派或通用文件仓库。
- 未经单独授权不 push、不发布 npm、不部署生产。

# 当前状态

- `unified-agent-access-roles`：设计和 TDD 实施计划已完成，尚未开始生产代码实现；新协议目标版本为 0.5.0。
- `agent-collaboration-templates`：需求、架构、领域模型、组件、内置模板、UI、MCP、错误恢复和测试设计均已由用户确认。
- 协作模板正式设计已写入 `agentwiki/docs/superpowers/specs/2026-08-22-agent-collaboration-templates-design.md`，当前等待用户审阅书面 Spec。
- 生产代码尚未修改，协作模板实施计划尚未创建。

# 稳定约束

- Agent 有效权限为 Credential 角色/scopes、Space Grant 角色/scopes、Agent 状态、Space Policy 和领域授权的交集。
- 普通产品入口只使用 `reader | editor | publisher`，底层 scopes 由唯一共享策略派生；任何 Agent 都没有 `review:decide`。
- “Agent 访问角色”与协作模板中的“角色槽位”是两个不同概念。
- 协作运行保存不可变模板快照；Todo 属于任务内部，依赖属于节点之间，并行由多个 ready 节点自然产生。
- 人工审核只能由人类完成；Agent 审校任务只能提交建议。
- 现有 Local Knowledge Orchestrator 保持专用，不与通用协作模板合并。
- Wiki 发布继续通过 ChangeSet、Space Policy 和现有审核治理。

# 关键索引

- 协作模板设计：`agentwiki/docs/superpowers/specs/2026-08-22-agent-collaboration-templates-design.md`
- 协作模板任务：`.codex-memory/tasks/active/agent-collaboration-templates/`
- 统一访问角色设计：`agentwiki/docs/superpowers/specs/2026-08-22-unified-agent-access-roles-design.md`
- 统一访问角色计划：`agentwiki/docs/superpowers/plans/2026-08-22-unified-agent-access-roles-plan.md`
- 统一访问角色任务：`.codex-memory/tasks/active/unified-agent-access-roles/`
- 领域词汇：`agentwiki/CONTEXT.md`

# 风险 / 下一步

- 用户需要先审阅协作模板书面 Spec；若批准，再使用 `writing-plans` 形成实施计划。
- 协作模板必须在统一访问角色完成后实施，否则会重新制造角色与 scope 两套配置。
- 真实多 Agent 执行无法由服务端远程唤醒；人工审核后需要 UI 生成恢复指令。
- 外部文件只保存受控引用；跨机器不可解析的本地相对路径不能冒充可共享产物。
