<!-- codex-memory:template=current:v1 -->

# 当前目标

- 将 GitHub `origin/master` 新增的 Agent 自助接入热修复与 Mac 最终审计分支安全整合，再对合并后的候选重复任务、代码、全栈和 UI 审查，直至没有值得修复的问题。

# 范围 / 不做

- 在当前隔离工作区完成整合、审查、修复、测试、精确清理和本地证据提交。
- 不触碰原始 Mac 脏工作区，不停止其他并行任务资源。
- 未获授权，不 push、不发布 npm、不部署生产；不把缺少外部凭据或真实 Windows 11 x64 的验证写成 PASS。

# 当前状态

- 2026-09-04 重新 fetch 后发现本地 `4866c90` 与 GitHub `origin/master@36e70c5` 分叉：本地领先 34、落后 4；已开始合并远端 Agent 自助接入提示词热修复。
- 远端热修复已把首页默认交付物从裸 NDJSON 命令改为可复制给 Agent 的完整任务提示词，并新增真实协议消费者 fixture；远端记录显示应用提交 `f02f8c4` 已部署生产并完成真实 Chrome 验证。
- 合并前 Mac 最终代码候选为 `e94fa7b`：工作树与 clean clone 均 4265 total / 4262 pass / 0 fail / 3 skip，Chrome 26/26；这些只作为合并前基线，不替代合并后新鲜验证。
- 当前活跃任务：`post-sync-final-audit-2026-09-04`。

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

- 活跃任务：`.codex-memory/tasks/active/post-sync-final-audit-2026-09-04/`
- 合并前最终验证：`agentwiki/docs/verification/macos-release-validation-2026-09-04.md`
- 远端热修复记录：`agentwiki/docs/verification/onboard-agent-prompt-hotfix-2026-09-04.md`
- Windows 最终 SHA 交接：`agentwiki/docs/verification/windows-final-sha-handoff-2026-09-04.md`
- 上一轮归档：`.codex-memory/tasks/archive/final-release-candidate-audit-2026-09-04/`

# 风险 / 下一步

- 完成合并冲突裁决，先运行远端 onboarding focused 测试并审查合并语义，再建立隔离数据服务重跑全仓、静态、CodeGraph 和真实 Chrome UI。
- 当前 55432 被另一个并行 AgentWiki-Obsidian 任务使用；本轮必须选择新的 loopback 端口并保持资源所有权隔离。
- 合并后候选需要重新交给真实 Windows 11 x64 验证；Assist 真实成功仍需要有效 OpenRouter API key。
- 最终 GitHub push、npm 发布与生产部署均需独立授权。
