<!-- codex-memory:template=current:v1 -->

# 当前目标

- 修复 Agent 自助接入提示词的真实协议驱动缺口并重新发布；继续由 Mac 使用隔离服务补齐 Windows 修复候选的数据库、CodeGraph 和 25 个 Playwright 验证。

# 范围 / 不做

- 本次补救范围仅包括 Agent 自助接入提示词、消费者行为回归、长期规则和验证记录；不修改 Device Auth、NDJSON 协议、npm 包或数据库。
- Windows 候选范围包括本地同步与进程启动、服务端授权/锁、客户端异步状态与可访问性、根脚本可移植性，以及公开页面的桌面/移动浏览器交互。
- 不修改或提交用户已有的 `测试报告/` 内容。
- 本机没有 PostgreSQL、Redis、Docker 或 CodeGraph 运行时，因此不伪报数据库型 E2E、已登录全栈 UI 或外部运行时集成已执行。

# 当前状态

- 2026-09-04 已复现已发布提示词的真实失败：新 Agent 把 `confirmation_required` 错写为 `{"requestId":"plan-1","approved":true}`，因缺少 `confirmed` 和 `planHash` 收到 `BAD_DRIVER_REPLY`。修订提示词补齐持久进程、冷启动等待和精确 stdin JSON 形状；新的 Agent 消费者已在受控 fixture 中完成两次确认并到达 `completed`。
- 2026-09-04 Agent 自助接入提示词纠正发布已完成：应用提交 `f02f8c4` 已推送 GitHub `master` 并部署生产。提示词现已明确持久进程、冷启动等待、字段类型、授权等待、preview、`requestId + confirmed + planHash` 精确确认和失败恢复字段；新 Agent 已在受控协议 fixture 中完成整条流程。
- 纠正发布前新增 PostgreSQL dump、应用归档和 checksum；49 个 migration 无 pending，三服务 active/running，公网健康五项全 ok。线上 `OnboardPage.tsx` SHA-256 与 `f02f8c4` 候选一致。
- 真实 Chrome 已验证中文提示词与复制成功状态，英文提示词也含冷启动、`values`、`confirmed`、`planHash` 协议。发布记录：`agentwiki/docs/verification/onboard-agent-prompt-hotfix-2026-09-04.md`。
- 2026-09-04 完成多轮任务审查、分域代码审查、回归修复和最终全仓门禁。
- 最终 `pnpm test`：4044 passed、79 skipped、0 failed；skip 均为需要外部数据库/Redis/CodeGraph 等明确环境前提的门禁。
- `pnpm typecheck`、`pnpm lint`、`pnpm build` 全部通过；构建仅保留既有 Vite 大 chunk 提示。
- `pnpm audit` 无已知漏洞；移除没有安全修复版本的 `image-size`，改用有界 PNG/JPEG/WebP/GIF 尺寸解析，并固定 `fast-uri@4.1.4`、`qs@6.16.0`、`browserslist@4.28.8`。
- Playwright 可收集 7 个文件、25 个测试；因缺少真实数据库栈未执行。
- 浏览器已验证公开首页/登录注册/指南、中英文切换、未登录 workspace 重定向，以及 390x844 移动布局；最终用真实 Chromium 补测登录/注册页签的 Home/End 键盘切换、焦点与 ARIA 关联，控制台无 warning/error、页面无横向溢出。
- 验收计划与证据：`agentwiki/docs/superpowers/plans/2026-09-03-release-readiness-audit.md`。
- 已归档任务：`.codex-memory/tasks/archive/windows-release-readiness-2026-09-04/`。
- Mac 交接任务已建立：`agentwiki/docs/superpowers/plans/2026-09-04-macos-release-verification.md` 与 `.codex-memory/tasks/active/macos-release-verification-2026-09-04/`。
- Windows 修复代码候选已提交并推送到 GitHub `master`：`7db186b fix(windows): complete release-readiness remediation`。

# 稳定约束

- `AgentGrant.role` 是唯一持久化权限事实；Credential 只保存身份和生命周期，权限从当前 Grant 实时派生。
- 普通 Agent 角色仅为 `reader | editor | publisher`，任何 Agent 都没有 `review:decide`；审核权由服务端实时计算 `Review.canDecide`。
- PostgreSQL 测试只能使用对应的专用测试数据库变量和随机测试 schema，禁止迁移或清理 `public`。
- Markdown 编辑继续使用互斥的 Edit / Preview 工作区；所有新增界面文案必须支持简体中文和英文。
- Windows 子进程不得依赖 PATHEXT 对无扩展 shim 的解析；仓库 Node 工具优先解析包管理器 JS 入口并由 `process.execPath` 启动。

# 关键索引

- 本轮验收计划：`agentwiki/docs/superpowers/plans/2026-09-03-release-readiness-audit.md`
- 本轮归档任务：`.codex-memory/tasks/archive/windows-release-readiness-2026-09-04/`
- Mac 验证清单：`agentwiki/docs/superpowers/plans/2026-09-04-macos-release-verification.md`
- Mac 活跃任务：`.codex-memory/tasks/active/macos-release-verification-2026-09-04/`
- 既有 AgentWikiQ 修复记录：`agentwiki/docs/verification/agentwikiq-remediation-2026-08-19.md`
- 上一发布记录：`agentwiki/docs/verification/page-template-library-2026-08-26.md`
- Agent 自助接入热修复记录：`agentwiki/docs/verification/onboard-agent-prompt-hotfix-2026-09-04.md`

# 风险 / 下一步

- Agent 提示词纠正发布已经完成；后续修改此提示词必须以新 Agent 驱动受控 NDJSON fixture 到 `completed` 作为发布门禁，不能只验证页面渲染或复制按钮。
- Mac 需要从 `origin/master` 拉取包含 `7db186b` 的候选，按交接清单提供隔离 PostgreSQL/pgvector、Redis AOF 和真实 CodeGraph，再消除数据库/真实运行时 skip 并执行 25 个 Playwright 测试。
- Agent 自助接入热修复不涉及 npm 包，registry 继续为 `@neomei/agentwiki-local-sync@0.7.0`；不得把 Web 发布误报为 npm 新版本。
