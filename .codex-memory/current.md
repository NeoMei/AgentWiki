<!-- codex-memory:template=current:v1 -->

# 当前目标

- 主目标：按完整性修订后的 Spec 和 TDD 实施计划落地 Agent 协作模板与组件。
- 前置活跃任务：先实现并验证 Agent 统一访问角色 0.5.0 本地门禁，再实施协作模板；二者合并为 local-sync/onboarding 0.6.0 发布，不单独发布中间版。

# 范围 / 不做

- 协作模板首期包括编码、标书、论文、视频脚本和小说五类内置模板。
- 组件包括 Agent 任务、顺序 Todo、依赖/并行、人工审核和结果交接/汇总。
- 外部 Agent 通过统一 MCP 主动领取和回传；AgentWiki 只做协作控制面，不托管模型。
- 不做远程自动唤醒、自由拖拽、条件/循环/Webhook/子流程、动态竞领、自动改派或通用文件仓库。
- 未经单独授权不 push、不发布 npm、不部署生产。

# 当前状态

- `unified-agent-access-roles`：设计和 TDD 实施计划已完成，尚未开始生产代码实现；新协议目标版本为 0.5.0。
- `agent-collaboration-templates`：书面 Spec 和 13 个任务的 TDD 实施计划已完成完整性修订，补齐 generation 修订失效、改派加入资格、运行状态优先级、隔离数据库测试、复合外键、完整 API、受限 JSON Schema、幂等作用域、`any` 语义、外部引用和 0.6.0 合并发布边界。
- 协作模板正式设计位于 `agentwiki/docs/superpowers/specs/2026-08-22-agent-collaboration-templates-design.md`，实施计划位于 `agentwiki/docs/superpowers/plans/2026-08-22-agent-collaboration-templates-plan.md`。
- 生产代码尚未修改；下一步需选择分任务子 Agent 执行或当前会话内联执行，并先完成统一访问角色前置计划。

# 稳定约束

- Agent 有效权限为 Credential 角色/scopes、Space Grant 角色/scopes、Agent 状态、Space Policy 和领域授权的交集。
- 普通产品入口只使用 `reader | editor | publisher`，底层 scopes 由唯一共享策略派生；任何 Agent 都没有 `review:decide`。
- “Agent 访问角色”与协作模板中的“角色槽位”是两个不同概念。
- 协作运行保存不可变模板快照；Todo 属于任务内部，依赖属于节点之间，并行由多个 ready 节点自然产生。
- 驳回修改按任务 generation 失效因果子图；旧 Todo/Attempt/Artifact/Review 保留审计但不参与新代依赖和完成判定。
- `any` 仅提前释放下游，不跳过其余上游；运行完成仍要求所有未跳过的必需上游完成。
- 人工审核只能由人类完成；Agent 审校任务只能提交建议。
- 现有 Local Knowledge Orchestrator 保持专用，不与通用协作模板合并。
- Wiki 发布继续通过 ChangeSet、Space Policy 和现有审核治理。

# 关键索引

- 协作模板设计：`agentwiki/docs/superpowers/specs/2026-08-22-agent-collaboration-templates-design.md`
- 协作模板计划：`agentwiki/docs/superpowers/plans/2026-08-22-agent-collaboration-templates-plan.md`
- 协作模板任务：`.codex-memory/tasks/active/agent-collaboration-templates/`
- 统一访问角色设计：`agentwiki/docs/superpowers/specs/2026-08-22-unified-agent-access-roles-design.md`
- 统一访问角色计划：`agentwiki/docs/superpowers/plans/2026-08-22-unified-agent-access-roles-plan.md`
- 统一访问角色任务：`.codex-memory/tasks/active/unified-agent-access-roles/`
- 领域词汇：`agentwiki/CONTEXT.md`

# 风险 / 下一步

- 协作模板必须在统一访问角色完成后实施，否则会重新制造角色与 scope 两套配置。
- 真实多 Agent 执行无法由服务端远程唤醒；人工审核后需要 UI 生成恢复指令。
- 外部文件只保存受控引用；跨机器不可解析的本地相对路径不能冒充可共享产物。
- 所有数据库集成测试必须使用 `COLLABORATION_TEST_DATABASE_URL` 和随机 `collaboration_test_*` schema，禁止直接迁移任意 `DATABASE_URL`。
