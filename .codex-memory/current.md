<!-- codex-memory:template=current:v1 -->

# 当前目标

- 页面模板库已完成本地实施、最终审查修复与聚焦验收；保持本地分支，等待单独的 GitHub / npm / 生产发布授权。

# 范围 / 不做

- 范围是单页 Markdown 模板、两步式创建、七个双语系统模板、Space 模板版本与 Owner/Admin 管理。
- 不做页面套装、个人或跨 Space 模板、模板自动翻译、新模板 MCP，也不修改协作工作流模板。

# 当前状态

- 2026-08-25 已确认产品范围、模板目录、两步式交互、独立快照、权限、版本、API、异常和验收标准。
- 正式设计：`agentwiki/docs/superpowers/specs/2026-08-25-page-template-library-design.md`。
- 实施计划：`agentwiki/docs/superpowers/plans/2026-08-25-page-template-library-plan.md`，全部 TDD 任务、审查项与验收项均已完成。
- 活跃任务：`.codex-memory/tasks/active/page-template-library/`。
- 本地候选分支 `codex/page-template-library`；最终代码候选 `cdcf52c`。四轮全分支审查先后修复并发、实时授权、Socket 草稿、Unicode、分页与限流边界，第四轮独立审查收敛为 0 Critical / 0 Important / 0 Minor。
- 最终全仓门禁：runtime 104 pass / 51 skip、server 1208 pass / 4 skip、client 708/708、sync-protocol 42/42、local-sync 748/748；typecheck、lint、build、diff-check 全部通过。
- 最终全新一次性 PostgreSQL 门禁 2/2，含 U+20000 Prisma 往返；真实 Chrome 8/8 且每场景 console error/warning 为 0；20 轮共 80 个有序并发对全部通过。随机 schema、孤儿记录、锁等待者和活跃测试 fixture 均为 0，临时服务及端口已清理。
- 验收记录：`agentwiki/docs/testing/page-template-library-acceptance.md`。
- 本任务仅完成本地候选；没有 push、npm publish 或生产部署。

# 稳定约束

- `AgentGrant.role` 是唯一持久化权限事实；Credential 只保存身份和生命周期，权限从当前 Grant 实时派生。
- 普通 Agent 角色仅为 `reader | editor | publisher`，任何 Agent 都没有 `review:decide`；审核权由服务端实时计算 `Review.canDecide`。
- 协作运行保存不可变模板快照；页面模板与协作模板是两个独立领域，不得混用。
- PostgreSQL 协作测试只允许专用 `COLLABORATION_TEST_DATABASE_URL` 与随机 `collaboration_test_*` schema，禁止迁移或清理 `public`。
- PostgreSQL 页面模板测试只允许专用 `PAGE_TEMPLATE_TEST_DATABASE_URL` 与随机 `page_template_test_*` schema，禁止迁移或清理 `public`。
- Markdown 编辑继续使用互斥的 Edit / Preview 工作区；所有新增界面文案必须支持简体中文和英文。

# 关键索引

- 页面模板设计：`agentwiki/docs/superpowers/specs/2026-08-25-page-template-library-design.md`
- 页面模板实施计划：`agentwiki/docs/superpowers/plans/2026-08-25-page-template-library-plan.md`
- 页面模板任务：`.codex-memory/tasks/active/page-template-library/`
- 上一发布记录：`agentwiki/docs/verification/collaboration-agent-preparation-2026-08-25.md`

# 风险 / 下一步

- 生产构建仍有既有的 Vite `>500 kB` chunk 警告，本次构建成功。
- 若进入发布，需要单独核对 GitHub 推送、生产数据库备份/迁移、部署与公网登录态验收；包版本未变，不需要因本功能发布 npm。当前生产健康，但页面模板路由仍为 404，符合尚未部署本功能的状态。
- 未经单独授权，不推送 GitHub、不发布 npm、不部署生产。
