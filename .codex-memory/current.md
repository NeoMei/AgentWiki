<!-- codex-memory:template=current:v1 -->

# 当前目标

- Mac 已完成 GitHub onboarding 热修复整合与多轮任务、代码、全栈和真实 UI 审查；当前候选为 `206d285`，等待独立授权的 GitHub push 和同 SHA Windows 复验。

# 范围 / 不做

- 在当前隔离工作区完成整合、审查、修复、测试、精确清理和本地证据提交。
- 不触碰原始 Mac 脏工作区，不停止其他并行任务资源。
- 未获授权，不 push、不发布 npm、不部署生产；不把缺少外部凭据或真实 Windows 11 x64 的验证写成 PASS。

# 当前状态

- 远端 `origin/master@36e70c5` 通过 `79ac85c` 完成整合；本轮修复提交为 `375d4a4` 和 `206d285`。
- 最终 detached clean worktree 全仓为 4269 total / 4266 pass / 0 fail / 3 skip，其中数据库 146/146 且零跳过；真实 Chrome Playwright 28/28。
- typecheck、lint、build、裸 audit、真实 CodeGraph 1/1 和 diff check 全部通过；audit 为零已知漏洞。
- 已修复提前确认 fixture 放行、390px 指南侧栏挤压、Prisma 事件断言竞争和 5000 页 legacy writer 二次方写入问题；最终重复审查无新 finding。
- 本轮 schema/测试数据库/Redis/容器/进程/端口/临时 worktree 已精确清理；原始脏工作区和 55432 其他任务容器未触碰。
- 当前无活跃任务；Mac 本地候选 PASS。

# 稳定约束

- `AgentGrant.role` 是唯一持久化权限事实；Credential 只保存身份和生命周期，权限从当前 Grant 实时派生。
- 普通 Agent 角色仅为 `reader | editor | publisher`，任何 Agent 都没有 `review:decide`；审核权由服务端实时计算 `Review.canDecide`。
- PostgreSQL 测试只能使用对应的专用测试数据库变量和随机测试 schema，禁止迁移或清理 shared `public`。
- 全栈 E2E 的限流与临时附件例外必须由同一个 fail-closed isolation predicate 约束：test、loopback API、loopback PostgreSQL、test 数据库和精确 `mac_e2e_*` schema 缺一不可。
- protected inventory 必须显式提供绝对 `PG_DUMP_BIN`，预检 client/server major，并只通过环境传递数据库密码。
- 首页 Agent 自助接入默认复制完整 Agent 任务提示词；`--protocol ndjson` 由 Agent 在可轮询 stdout、可写 stdin 的持久会话驱动，不能当成人类普通终端命令。
- 提示词必须保留 `input_required` 的 `requestId + values` 和 `confirmation_required` 的 `requestId + confirmed + planHash` 精确形状；发布前必须由真实 Agent 消费者 fixture 到达 `completed`。
- Markdown 编辑继续使用互斥的 Edit / Preview 工作区；所有新增界面文案必须支持简体中文和英文。
- Windows 子进程不得依赖 PATHEXT 对无扩展 shim 的解析；仓库 Node 工具优先解析包管理器 JS 入口并由 `process.execPath` 启动。

# 关键索引

- 最终验收：`agentwiki/docs/verification/post-sync-final-audit-2026-09-05.md`
- 任务归档：`.codex-memory/tasks/archive/post-sync-final-audit-2026-09-04/`
- 合并前最终验证：`agentwiki/docs/verification/macos-release-validation-2026-09-04.md`
- 远端热修复记录：`agentwiki/docs/verification/onboard-agent-prompt-hotfix-2026-09-04.md`
- Windows 最终 SHA 交接：`agentwiki/docs/verification/windows-final-sha-handoff-2026-09-04.md`
- 上一轮归档：`.codex-memory/tasks/archive/final-release-candidate-audit-2026-09-04/`

# 风险 / 下一步

- 若要继续发布，先将 `206d285` 交给真实 Windows 11 x64 完成同 SHA 复验。
- GitHub push、npm 发布、生产备份/迁移/部署/公网验收需独立授权。
- Assist 真实成功仍需要有效外部模型凭据。
