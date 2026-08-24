# Agent 协作工作流真实客户端验收

## 证据边界

本文档验收 AgentWiki `0.6` 协作工作流；发布修订版为 `0.6.1`，相对真实客户端验收候选只修复 npm 依赖清单和版本联动。自动化 PostgreSQL 与 HTTP/MCP E2E 证明服务端、Worker、数据库、Credential 与 MCP SDK 闭环；B–E 另由真实 Codex CLI 与 Claude Code 通过隔离 Local Sync 网关执行。所有测试资源只进入随机 `collaboration_test_*` schema，不连接生产。

## 本次验收记录

| 字段 | 记录 |
| --- | --- |
| 操作人 | Codex 本地验收 |
| 开始/结束时间及时区 | 2026-08-24 01:56–12:16 CST |
| 服务端基线 | `3eab1eb17425d8d4bc0993be0fb0cb20f63dc3fb` + 本验收文档所在发行候选提交的加固 |
| AgentWiki / Local Sync / Sync Protocol | `0.6.0` / `0.6.0` / `0.2.0`（真实客户端运行时）；最终发布候选为 `0.6.1` / `0.6.1` / `0.3.0` |
| 真实客户端 | Codex CLI `0.147.0`；Claude Code `2.1.211` |
| 隔离 Space | `cmt6m7cun000ctaw2qn0dq0a1`、`cmt6ngb6d000cjmo6yyq2tekx`，均随 schema 清理 |
| 证据保存 | 本文中的运行、审核、Artifact 与事件标识；完整命令输出保留在本次 Codex 任务 |
| 最终结果 | `PASS` — A–F 全部通过；未执行 push、npm 发布或生产部署 |

这组 Run ID 与真实客户端结果属于上表时段和 Sync Protocol `0.2.0` 候选，不能通过修改版本单元格转记为后续发行证据。

## 当前发行候选增量门禁

2026-08-24 13:22–14:50 CST 在 `4289b31dad97949968104f46c54427787a57a852` 基线及本文所在的最终审查提交上，将 Sync Protocol 提升到 `0.3.0`，当时的 Local Sync `0.6.0` 候选精确依赖该版本。所有数据库证据均在最终源码重新构建 `dist` 之后执行：本地双 tarball 空目录安装与 CLI 启动 `PASS`（protocol 42/42、local-sync 748/748）；隔离 schema 2/2、真实事务 10/10、API/Worker/Credential/MCP E2E `PASS`，随机 schema 清理后残留为 0。

Sync Protocol `0.3.0` 已发布并完成 registry 哈希反验。首次发布的 Local Sync `0.6.0` 经公开 registry 空目录安装发现 npm tarball 仍保留 `workspace:0.3.0`，因此不得部署；`0.6.1` 候选改为在源清单中精确依赖 `0.3.0`，并把安装门禁从会自动改写 workspace 依赖的 `pnpm pack` 改为与发布产物一致的 `npm pack`。修复后的 `pnpm test:package:local-sync-registry-protocol` 已独立解析 registry 协议包并通过 748/748 测试及空目录安装，`0.6.1` 发布完成前仍不允许生产部署。

## A. 自动化先决证据

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 隔离 PostgreSQL 场景 | `PASS` | `collaboration-workflows-db.test.mjs` 10/10；新增双 Agent 并发 heartbeat、Todo、submit 的 `40001` 重试场景 |
| 真实 API + Worker + Credential + MCP | `PASS` | `collaboration-workflows-e2e.mjs` 返回 `status: PASS`；六个执行工具、审核、恢复、改派、终态闭环 |
| 可重复真实客户端 Harness | `PASS` | `collaboration-real-agent-harness.test.mjs` 4/4；无专用测试 URL 时 fail closed，状态文件 mode `0600`，SIGTERM 删除状态、临时仓库和随机 schema |
| 完整本地发行门禁 | `PASS` | Runtime 95 通过/50 环境跳过，Server 1003 通过/3 跳过，Client 314/314，Sync Protocol 42/42，Local Sync 748/748；lint、typecheck、build、`git diff --check` 全部通过 |
| 真实浏览器 UI | `PASS` | 真实注册、Space 创建、Publisher Agent 接入、五模板、三步启动、权威角色映射、自审风险确认、8 个任务/Todo/审核/Artifact/活动看板通过；390px 视口 `scrollWidth=390`，语义区块顺序正确，控制台无 error/warn |

真实客户端运行中曾观察到 Prisma `P2010` / PostgreSQL `40001` 从并行 heartbeat/submit 泄漏。根因是同一 Run 的幂等事件写入使用 Serializable 事务，而只有 `next_action` 有重试。修复后 heartbeat、Todo、submit 均最多重试三次；连续冲突转换为受控 `COLLABORATION_PROGRESS_INVARIANT`，并由单元测试与真实 PostgreSQL 并发测试覆盖。新运行时的 D–E 并行验收未再泄漏原始 Prisma 错误。

## B. 编码模板：真实多 Agent 闭环

运行 `cmt6m7cwh001etaw2bklnqqx7`，结果 `PASS`：

- Codex 与 Claude 加入同一运行；模块 A 与 B 同时持有独立租约，Todo 均按 ordinal 执行 `doing → done`，heartbeat 可见。
- 隔离证据仓库的真实提交为 A `56a3dd144c6168f7e73dfbb4ab698ce65a82a262`、B `d01d8e0f51fba971aa721d7cccfbc0d14bca3dbc`；`npm test` 为 2/2。
- 人工审核 `cmt6mpolf0159taw2uxqhnhk7` 执行 `reject_for_revision`，要求区分“当前测试已验证”与“历史 RED 阶段未证明”。只有 `release-summary` 进入 generation 2；上游 generation 1 完成记录保留且未被错误重跑。
- Claude 使用新 attempt 恢复 generation 2，修订产物后，审核 `cmt6mueul018ttaw2yg2vl5bo` 批准；运行终态 `completed`。
- 事件包含 `review_reject_for_revision`、generation 递增和 `review_approve`；错误 Artifact kind 与错误 evidence kind 均先被校验拒绝，再以新幂等键修复提交。

## C. 租约超时与人工改派

运行 `cmt6n1a96019ataw2a6mlj7cp`，结果 `PASS`：

- Codex 领取 30 秒租约并停止续期；过期后的 heartbeat 与 submit 均被拒绝。
- Worker 事件 `recover_expired_lease` 将任务经重试预算确定性释放回 `ready`。
- 人工执行 `reassign_task`，把同一任务交给此前未绑定的备用 Agent。
- 备用 Claude 通过当前 assignment 加入，获得新 attempt 与新 lease，完成 Todo 和 Markdown Artifact；运行终态 `completed`。
- 事件顺序为 `start_run → next_action → heartbeat → recover_expired_lease → reassign_task → next_action → heartbeat → update_todo ×2 → submit_result`。

## D. 标书模板

运行 `cmt6ngba7002ijmo64o5m34ty`，8/8 任务完成、3/3 审核批准，结果 `PASS`：

- 三个人工门 `bid-consensus-review`、`missing-material-review`、`final-bid-review` 均真实生成并由人工按产物内容批准。
- 覆盖矩阵、大纲与证据/图文映射、技术与服务章节、覆盖检查、终稿合并均由 Agent 任务执行。
- 可用材料只登记“架构说明”“测试报告”；客户证书和具名人员简历始终是“缺失/待提供”。没有虚构评分权重、资格条款、SLA、人员、证书或图片资产。
- 覆盖检查发现并交给合并节点处理 F1–F4，其中证据矩阵列口径差异为中风险；终稿统一为六列矩阵并闭环。
- `export-reference` 使用真实 Git 基线 `ce5ba96974de42650d986692cb5a792682198451`，明确不把该提交冒充标书正文；运行终态 `completed`。

## E. 论文、视频脚本和小说模板

| 模板 | 结果 | 关键证据 |
| --- | --- | --- |
| 论文 `cmt6ngbbm003qjmo6nhuipl7b` | `PASS` | 7/7 任务、2/2 审核；`source-identifiers` 与 `source-verification` 通过；机制、已观察、未观察、未验证四级声明分离；实验设计明确未执行；外部引用不冒充正文 |
| 视频 `cmt6ngbd9004rjmo6rrvshasp` | `PASS` | 7/7 任务、1/1 审核；事实卡和发布检查使用 `source-verification`；逐镜时码 `6+8+9+9+10+7+5+6=60` 秒；画面、旁白、字幕对齐；超时恢复只标为协议机制示意 |
| 小说 `cmt6ngbeu005rjmo6oltrkdxw` | `PASS` | 6/6 任务、2/2 审核；大纲裁决基础设定冲突；连续性审校提出 6 项实质问题；终稿修复专名、结算日历、登记盲区和知识链，红章授权人、裁页者、动机与失踪仍保持开放 |

## F. 清理与最终判定

清理前，第二隔离 schema 内共有 5 个 Run、36 个 Task、28 个 Attempt、28 个 Artifact、8 个 Review、279 个 Event；业务矩阵的 28/28 Task 全部完成，8/8 Review 全部批准。状态文件权限为 `0600`，隔离证据仓库 `git status --porcelain` 为空。

Harness 收到 SIGINT 后返回 `{"status":"CLEANED"}`。清理后：

- `/private/tmp/agentwiki-release-business-20260824/state.json` 不存在；
- 临时资源根目录与隔离 Git 仓库不存在；
- schema `collaboration_test_5e5e1f764a15453792d0fb4d66148cfb` 数量为 0；
- 测试数据库全部 `collaboration_test_*` schema 数量为 0；
- 专用测试数据库的 `public` 中没有 AgentWiki 业务表，因此测试资源没有落入非测试 schema；
- 正式项目工作树只保留本任务代码/文档和既有 Obsidian 引导改动，没有测试 Artifact、Credential 或临时客户端配置。

## 结论

A–F 全部为 `PASS`，本地代码、自动化门禁、真实浏览器既有证据和真实 Codex/Claude 业务验收共同达到“可进入发布操作”的标准。该结论不等于已经发布：push、npm 发布和生产部署仍需独立授权与发布前备份/预检。
