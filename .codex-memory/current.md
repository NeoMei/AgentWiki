<!-- codex-memory:template=current:v1 -->

# 当前目标

- 审查并推送已经完成 macOS 全栈验证的 AgentWiki 发布候选；已测试代码固定为 `e8c16e92822758a75350e50d9abb7865cc970f54`。

# 范围 / 不做

- 本阶段只记录已完成的 macOS 验证、精确清理与本地证据提交；不发布 npm、不部署生产。
- 当前任务不推送；由控制器在任务审查和整分支终审后决定 push。
- 不把原始诊断失败、npm audit POST 超时或 63 张 disposable 数据库污染表掩盖为从未发生。

# 当前状态

- 2026-09-04 macOS 验证完成并判定 PASS；正式记录为 `agentwiki/docs/verification/macos-release-validation-2026-09-04.md`。
- 最终真实 clean clone：4170 pass / 0 fail / 3 个非数据库、非 Redis 的平台或显式 opt-in skip；typecheck、lint、build、裸 audit 和缺失前提 gate 均通过。
- 真实 CodeGraph standard scan：1 pass / 0 fail / 0 skip。
- 最终 Chrome Playwright：7 files / 25 tests，25 pass / 0 fail / 0 skip，单 worker、无 retry。
- protected public inventory digest 前后一致；最终所有测试前缀 schema 为 0。
- Task 5 的 8 成员进程组已在命令/CWD/listener guard 后整体 TERM；3000/5173 无监听。
- 精确 E2E schema 已 DROP；附件目录已可恢复地移动到 `/Users/neomei/.Trash/agentwiki-macos-release-task6.EP25nx/`。
- PostgreSQL/Redis `--rm` 容器已停止并消失；3000/5173/55432/56379 均无监听。
- macOS 验证任务已归档至 `.codex-memory/tasks/archive/macos-release-verification-2026-09-04/`。

# 稳定约束

- `AgentGrant.role` 是唯一持久化权限事实；Credential 只保存身份和生命周期，权限从当前 Grant 实时派生。
- 普通 Agent 角色仅为 `reader | editor | publisher`，任何 Agent 都没有 `review:decide`；审核权由服务端实时计算 `Review.canDecide`。
- PostgreSQL 测试只能使用对应的专用测试数据库变量和随机测试 schema，禁止迁移或清理 `public`。
- 全栈 E2E 的测试限流覆盖只有在 test、loopback、test 数据库和精确 `mac_e2e_*` schema 四类隔离条件同时成立时才能生效。
- Markdown 编辑继续使用互斥的 Edit / Preview 工作区；所有新增界面文案必须支持简体中文和英文。
- Windows 子进程不得依赖 PATHEXT 对无扩展 shim 的解析；仓库 Node 工具优先解析包管理器 JS 入口并由 `process.execPath` 启动。

# 关键索引

- macOS 正式验证记录：`agentwiki/docs/verification/macos-release-validation-2026-09-04.md`
- macOS 验证清单：`agentwiki/docs/superpowers/plans/2026-09-04-macos-release-verification.md`
- macOS 归档任务：`.codex-memory/tasks/archive/macos-release-verification-2026-09-04/`
- Windows 验收计划：`agentwiki/docs/superpowers/plans/2026-09-03-release-readiness-audit.md`
- Windows 归档任务：`.codex-memory/tasks/archive/windows-release-readiness-2026-09-04/`
- 既有 AgentWikiQ 修复记录：`agentwiki/docs/verification/agentwikiq-remediation-2026-08-19.md`
- 上一发布记录：`agentwiki/docs/verification/page-template-library-2026-08-26.md`

# 风险 / 下一步

- 控制器仍需审查本地证据提交和完整分支，再决定是否 push；本任务未 push。
- 原始 `agentwiki_test.public` 的 63 张诊断污染表只存在于已销毁的 disposable PostgreSQL 容器，不是持久生产或共享数据库污染。
- npm 发布与生产部署均未执行，仍需独立授权与对应发布验证。
