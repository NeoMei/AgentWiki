<!-- codex-memory:template=current:v1 -->

# 当前目标

- 对 `origin/master..HEAD` 发布候选执行多轮任务、代码、全栈和 UI 终审；修复所有经证实且值得修复的问题，并以最终不可变提交的新鲜证据收口。

# 范围 / 不做

- 本阶段只做本地审查、修复、测试、精确清理与证据提交；不 push、不发布 npm、不部署生产。
- 不把原始诊断失败、npm audit POST 超时或 63 张 disposable 数据库污染表掩盖为从未发生。

# 当前状态

- 2026-09-04 已启动 `final-release-candidate-audit-2026-09-04` 活跃任务；执行计划提交为 `686ba4f`，首轮任务完整性、整分支代码、全栈/UI 覆盖三视角审查和新鲜测试进行中。
- 下述 macOS PASS 是上一个已归档任务的基线，不替代本轮最终验证。
- 2026-09-04 macOS 验证完成并判定 PASS；正式记录为 `agentwiki/docs/verification/macos-release-validation-2026-09-04.md`。
- `4a9ac92` 真实 clean clone：4209 pass / 0 fail / 3 个非数据库、非 Redis 的平台或显式 opt-in skip（4212 total）；typecheck、lint、build 通过。同 lockfile 的实现工作树裸 audit 为零已知漏洞，clean clone 三次审计仅因 npm bulk API POST 超时退出。
- 最后一个 Windows DB gate 已使用跨平台 pnpm JS 入口和最大 90 秒 migration timeout；独立复审为零 finding、Ready to merge。
- 真实 CodeGraph standard scan：1 pass / 0 fail / 0 skip。
- 最终 Chrome Playwright：7 files / 25 tests，25 pass / 0 fail / 0 skip，单 worker、无 retry。
- protected public inventory digest `79642c9fc9d560bdbadd4828bcb75b6796a0a56ec1c45638d1e6d9ddd2b0e2e3` 前后一致；最终全库测试前缀 schema 为 0。
- 最终 8 成员 PGID 49952 已在 command/UID/CWD/listener guard 后整体 TERM；3000/5173 无监听。
- 精确 E2E schema 已 DROP；附件目录已可恢复地移动到 `/Users/neomei/.Trash/agentwiki-macos-finalfix.pG4uH2/`。
- PostgreSQL/Redis `--rm` 容器已停止并消失；3000/5173/55432/56379 均无监听。
- macOS 验证任务已归档至 `.codex-memory/tasks/archive/macos-release-verification-2026-09-04/`。

# 稳定约束

- `AgentGrant.role` 是唯一持久化权限事实；Credential 只保存身份和生命周期，权限从当前 Grant 实时派生。
- 普通 Agent 角色仅为 `reader | editor | publisher`，任何 Agent 都没有 `review:decide`；审核权由服务端实时计算 `Review.canDecide`。
- PostgreSQL 测试只能使用对应的专用测试数据库变量和随机测试 schema，禁止迁移或清理 `public`。
- 全栈 E2E 的测试限流覆盖只有在 test、loopback、test 数据库和精确 `mac_e2e_*` schema 四类隔离条件同时成立时才能生效。
- 测试附件的 `/tmp/agentwiki-mac-attachments.*` 例外必须复用与 E2E 限流相同的完整隔离 predicate。
- protected inventory 必须显式提供绝对 `PG_DUMP_BIN`，预检 client/server major，并只通过环境传递数据库密码。
- Markdown 编辑继续使用互斥的 Edit / Preview 工作区；所有新增界面文案必须支持简体中文和英文。
- Windows 子进程不得依赖 PATHEXT 对无扩展 shim 的解析；仓库 Node 工具优先解析包管理器 JS 入口并由 `process.execPath` 启动。

# 关键索引

- 当前活跃任务：`.codex-memory/tasks/active/final-release-candidate-audit-2026-09-04/`
- 本轮执行计划：`agentwiki/docs/superpowers/plans/2026-09-04-final-release-candidate-audit.md`
- macOS 正式验证记录：`agentwiki/docs/verification/macos-release-validation-2026-09-04.md`
- macOS 验证清单：`agentwiki/docs/superpowers/plans/2026-09-04-macos-release-verification.md`
- macOS 归档任务：`.codex-memory/tasks/archive/macos-release-verification-2026-09-04/`
- Windows 验收计划：`agentwiki/docs/superpowers/plans/2026-09-03-release-readiness-audit.md`
- Windows 归档任务：`.codex-memory/tasks/archive/windows-release-readiness-2026-09-04/`
- 既有 AgentWikiQ 修复记录：`agentwiki/docs/verification/agentwikiq-remediation-2026-08-19.md`
- 上一发布记录：`agentwiki/docs/verification/page-template-library-2026-08-26.md`

# 风险 / 下一步

- 必须完成首轮发现裁决、必要修复及 scoped re-review，再运行最终整分支复审、clean clone、真实 CodeGraph 和 Chrome Playwright。
- 最终证据还必须证明随机 schema、临时附件、精确进程/容器和 3000/5173/55432/56379 端口均已清理。
- npm 发布与生产部署均未执行，仍需独立授权与对应发布验证。
