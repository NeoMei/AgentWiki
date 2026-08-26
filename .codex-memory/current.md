<!-- codex-memory:template=current:v1 -->

# 当前目标

- 页面模板库已完成本地实施、多轮任务/代码审查、缺陷修复、GitHub 发布、备份优先的生产部署与公网/UI 验收。

# 范围 / 不做

- 范围是单页 Markdown 模板、两步式创建、七个双语系统模板、Space 模板版本与 Owner/Admin 管理。
- 不做页面套装、个人或跨 Space 模板、模板自动翻译、新模板 MCP，也不修改协作工作流模板。

# 当前状态

- 2026-08-25 已确认产品范围、模板目录、两步式交互、独立快照、权限、版本、API、异常和验收标准。
- 正式设计：`agentwiki/docs/superpowers/specs/2026-08-25-page-template-library-design.md`。
- 实施计划：`agentwiki/docs/superpowers/plans/2026-08-25-page-template-library-plan.md`，全部 TDD 任务、审查项与验收项均已完成。
- 已归档任务：`.codex-memory/tasks/archive/page-template-library/`。
- 应用发布提交：`574f25402e83abcaf66a2d5d490ec67269b0b962`；已推送 `origin/master` 并部署生产。旧的 `codex/page-template-library` 分支已不存在。
- 2026-08-26 重复审查累计修复了 9 类值得修复的问题：成员新增的撤权/删除竞态、分页参数越界、模板冲突无法原位恢复、Load more 零进展、设置/来源页加载无重试且错误文案不准确、陈旧的分支/验收记录、图谱刷新状态 P2002 并发竞态、来源页翻页失败后重试偏移错误，以及目录运行时分页/版本字段校验过宽。修复后最终复查为 0 个未解决的值得修复问题。
- 最终全仓门禁：runtime 104 pass / 51 skip、server 1213 pass / 4 skip、client 732/732、sync-protocol 42/42、local-sync 748/748；typecheck、lint、build 全部通过。
- 最终全新一次性 PostgreSQL 16 门禁 2/2，含 U+20000 Prisma 往返；真实 Chrome 10/10，覆盖真实版本冲突恢复、首页与失败翻页偏移的故障注入原位重试、逐次消费的预期控制台错误、权限、双语、空白页来源、390px 与焦点；20 轮共 160 个明确有序并发对全部通过。随机 schema、孤儿记录、锁等待者和活跃测试 fixture 均为 0，临时服务及端口已清理。
- 验收记录：`agentwiki/docs/testing/page-template-library-acceptance.md`。
- 2026-08-26 发布授权后的精确候选再次通过完整测试、typecheck、lint 与 build；两个 npm 包目录无差异且本地/registry 版本一致，因此本次未发布 npm。
- 生产发布已应用第 43 个迁移 `20260825150000_add_page_templates`；762 个部署文件与发布提交 SHA-256 一致，API/Worker/Frontend 均 active 且 `NRestarts=0`，公网/本机健康为 `ok`，部署窗口 5xx/Fatal 均为 0。
- 公网业务 smoke 31/31、页面模板真实 Chrome 10/10、通用 UI 路由桌面/移动 5+15+6 全部通过；活跃测试用户/Space/Agent、可见测试 Space 模板和测试 schema 均为 0。
- 发布验证：`agentwiki/docs/verification/page-template-library-2026-08-26.md`。

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
- 页面模板任务：`.codex-memory/tasks/archive/page-template-library/`
- 上一发布记录：`agentwiki/docs/verification/collaboration-agent-preparation-2026-08-25.md`

# 风险 / 下一步

- 生产构建仍有既有的 Vite `>500 kB` chunk 警告，本次构建和部署成功。
- 后续发布继续分别核对本地、GitHub、npm 与生产状态，不把任一状态误报为其他状态。
