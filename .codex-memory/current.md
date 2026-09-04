<!-- codex-memory:template=current:v1 -->

# 当前目标

- 以最终代码候选 `e94fa7b` 完成 Mac 本机多轮任务、代码、全栈和 UI 终审，并把同代码 Windows 原生复验交接清楚。

# 范围 / 不做

- Mac 本地审查、修复、测试、精确清理与证据已完成。
- 未获授权，不 push、不发布 npm、不部署生产。
- 不把缺少 OpenRouter API key 的 Assist 真实成功路径或尚未执行的 Windows 11 x64 native 验证写成 PASS。

# 当前状态

- 最终不可变代码提交：`e94fa7ba0b2a49f39a19be8405b582e213ec4c88`。
- 多轮任务完整性、整分支代码、前后端/UI 和测试真实性审查已完成；所有有效 finding 均已修复并复审，当前没有值得继续修复的已知 bug。
- 工作树与全新 `--no-local` clean clone 的 `pnpm test:full` 均为 4265 total / 4262 pass / 0 fail / 3 skip；三项 skip 是显式 opt-in CodeGraph acceptance 和两个 macOS 上的 Windows-only 边界。
- 两个环境的 typecheck、lint、build、真实 CodeGraph、`git diff --check` 均通过；工作树裸 audit 为零已知漏洞。
- 最终 Chrome Playwright：8 files / 26 tests，单 worker、无 retry，26 pass / 0 fail / 0 skip；增强后的协作事件因果与 390px 布局测试另重复 2/2。
- protected inventory 在完整测试中反复满足 before == after；最终测试前缀 schema 和临时数据库为 0。
- 精确 E2E schema 已 DROP，应用进程已结束；本轮 PostgreSQL/Redis `--rm` 容器按完整 ID停止并消失，停止后四端口即时复核均为空。随后另一并行任务新建 `agentwiki-sync-v3-task4-postgres` 占用 55432；它不是本轮残留，未越界停止。
- clean clone、陈旧临时目录、测试附件和 runtime env 已可恢复地移动至 `/Users/neomei/.Trash/agentwiki-final-review-temp-20260904/`。
- `final-release-candidate-audit-2026-09-04` 已完成并归档。

# 稳定约束

- `AgentGrant.role` 是唯一持久化权限事实；Credential 只保存身份和生命周期，权限从当前 Grant 实时派生。
- 普通 Agent 角色仅为 `reader | editor | publisher`，任何 Agent 都没有 `review:decide`；审核权由服务端实时计算 `Review.canDecide`。
- PostgreSQL 测试只能使用对应的专用测试数据库变量和随机测试 schema，禁止迁移或清理 shared `public`。
- 全栈 E2E 的限流与临时附件例外必须由同一个 fail-closed isolation predicate 约束：test、loopback API、loopback PostgreSQL、test 数据库和精确 `mac_e2e_*` schema 缺一不可。
- protected inventory 必须显式提供绝对 `PG_DUMP_BIN`，预检 client/server major，并只通过环境传递数据库密码。
- Markdown 编辑继续使用互斥的 Edit / Preview 工作区；所有新增界面文案必须支持简体中文和英文。
- Windows 子进程不得依赖 PATHEXT 对无扩展 shim 的解析；仓库 Node 工具优先解析包管理器 JS 入口并由 `process.execPath` 启动。

# 关键索引

- 最终正式验证记录：`agentwiki/docs/verification/macos-release-validation-2026-09-04.md`
- Windows 最终 SHA 交接：`agentwiki/docs/verification/windows-final-sha-handoff-2026-09-04.md`
- 本轮执行计划：`agentwiki/docs/superpowers/plans/2026-09-04-final-release-candidate-audit.md`
- 本轮归档任务：`.codex-memory/tasks/archive/final-release-candidate-audit-2026-09-04/`
- 上一轮 macOS 归档：`.codex-memory/tasks/archive/macos-release-verification-2026-09-04/`
- Windows 原验证归档：`.codex-memory/tasks/archive/windows-release-readiness-2026-09-04/`

# 风险 / 下一步

- 在真实 Windows 11 x64 上取得相同代码候选，完成 launcher、migration timeout、OpenCode executable、ACL/junction、全仓和 Chrome UI native 复验。
- Assist 真实成功路径仍需有效 OpenRouter API key；付费 fallback 继续默认关闭。
- GitHub push、npm 发布与生产部署均未执行，需独立授权并分别保留远端、包、部署和公网证据。
