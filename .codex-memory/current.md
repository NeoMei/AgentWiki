<!-- codex-memory:template=current:v1 -->

# 当前目标

- Agent `reader`、`editor`、`publisher` 统一访问角色已完成本地实现、多轮缺陷审查与本地 `master` 合并；外部发布门禁仍未执行。
- 下一阶段按已修订 Spec 和 TDD 计划实施 Agent 协作模板与组件；统一访问角色作为其已完成前置基础，二者在外部发布时合并为 local-sync/onboarding 0.6.0，不单独发布中间版。

# 范围 / 不做

- 统一访问角色覆盖共享角色策略、Grant/Credential、连接授权包、原子兑换、Agent 管理 UI、本地同步 0.5.0 协议、MCP 与审核边界。
- 协作模板首期包括编码、标书、论文、视频脚本和小说五类内置模板，以及 Agent 任务、Todo、依赖/并行、人工审核和结果交接/汇总。
- 不兼容旧 Agent `viewer` / `full` / 自定义 scopes 客户端或旧版本权限数据；人类 Space 成员角色属于独立领域。
- 未经单独授权不 push、不发布 npm、不部署生产，也不执行真实 OpenCode 验收。

# 当前状态

- `unified-agent-access-roles`：在原 FINAL CLEAN 后又完成多轮独立缺陷审查，修复授权写入原子性、删除 Space 的兑换回放、Reader 空 pull、token/checkpoint 顺序、bootstrap 名称绑定、前端旧接入码状态和手工 Grant/Credential 撤权竞态；收敛轮未再发现值得修复的问题。
- 最新全量候选测试为 runtime 84 通过 / 47 环境跳过、server 768、client 226、sync-protocol 25、local-sync 736；三客户端 onboarding、双包干净安装、类型、lint、Prisma 与格式门禁均通过。
- Reader onboarding 已改为只读 pull 路径；Agent Grant 变更同时要求 Agent owner 与 Space owner/admin；auto-publish 在发布事务临界点锁定并重验 Credential、Agent/owner、Grant、Space 与领域门槛。
- sync-protocol 0.2.0 与 local-sync 0.5.0 候选包已通过联合打包、空目录安装和 CLI 启动验证；尚未推送、发布或部署。
- `agent-collaboration-templates`：正式设计和 13 个任务的 TDD 实施计划已完成完整性修订，尚未开始生产代码实现。
- 外部 GitHub、npm 和生产仍保持旧基线，尚未与本地对齐。

# 稳定约束

- Agent 有效权限始终为 Credential 角色/scopes、Space Grant 角色/scopes、Agent/owner 状态、Space Policy 和领域授权的交集。
- 普通产品入口只使用 `reader | editor | publisher`；scopes 由共享策略派生，任何 Agent 都没有 `review:decide` 或成员管理权限。
- Publisher 不修改 Space Policy；自动发布必须在发布临界点满足 Credential、Grant、Agent 开关、Space Policy 与领域门槛。
- “Agent 访问角色”与协作模板中的“角色槽位”是两个不同概念。
- 协作运行保存不可变模板快照；Todo 属于任务内部，依赖属于节点之间，并行由多个 ready 节点自然产生。
- 人工审核只能由人类完成；Agent 审校任务只能提交建议。
- 现有 Local Knowledge Orchestrator 保持专用，不与通用协作模板合并。

# 关键索引

- 统一访问角色设计：`agentwiki/docs/superpowers/specs/2026-08-22-unified-agent-access-roles-design.md`
- 统一访问角色计划：`agentwiki/docs/superpowers/plans/2026-08-22-unified-agent-access-roles-plan.md`
- 统一访问角色验证：`agentwiki/docs/verification/unified-agent-access-roles-0.5.0.md`
- 统一访问角色部署门禁：`agentwiki/docs/operations/unified-agent-access-roles-0.5.0-deployment.md`
- 统一访问角色任务：`.codex-memory/tasks/active/unified-agent-access-roles/`
- 协作模板设计：`agentwiki/docs/superpowers/specs/2026-08-22-agent-collaboration-templates-design.md`
- 协作模板计划：`agentwiki/docs/superpowers/plans/2026-08-22-agent-collaboration-templates-plan.md`
- 协作模板任务：`.codex-memory/tasks/active/agent-collaboration-templates/`

# 风险 / 下一步

- 仍需单独授权并先完成 PostgreSQL custom-format 与应用回滚备份，才能 push、依次发布 sync-protocol/local-sync、部署破坏性迁移及执行真实 OpenCode 验收。
- 0.5.0 无 schema-only 回滚；回退必须成对恢复数据库与应用备份。
- 协作模板实施不得重新引入角色与 scopes 两套配置，也不得把 Agent 角色槽位混同为访问权限。
- 所有协作数据库集成测试必须使用 `COLLABORATION_TEST_DATABASE_URL` 和随机 `collaboration_test_*` schema。
