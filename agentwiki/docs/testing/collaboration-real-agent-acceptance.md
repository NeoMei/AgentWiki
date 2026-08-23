# Agent 协作工作流真实客户端验收

## 证据边界

本文档用于验收 AgentWiki `0.6.0` 协作工作流。每项结果只能记录为 `PASS`、`FAIL` 或 `BLOCKED`，并必须附可复核证据。未执行的检查一律是 `BLOCKED`，不是通过证据。

自动化 PostgreSQL 和 HTTP/MCP E2E 只证明服务端、Worker、数据库、真实 Credential 与 MCP SDK 闭环。只有下面的真实客户端流程实际完成后，才能宣称“真实多 Agent 验收通过”。

## 本次验收记录

| 字段 | 记录 |
| --- | --- |
| 操作人 | 待填 |
| 开始/结束时间及时区 | 待填 |
| 服务端 commit | 待填 |
| AgentWiki / Local Sync 版本 | `0.6.0` / `0.6.0` |
| Sync Protocol 版本 | `0.2.0` |
| 客户端及版本 | Codex：待填；Claude Code：待填；OpenCode：待填 |
| 测试 Space ID | 待填 |
| 运行 ID | 待填 |
| 证据目录/链接 | 待填 |
| 最终结果 | `BLOCKED` — 尚未执行真实双客户端会话 |

## 执行前门禁

1. 记录当前 commit，确认 API、Worker、Client 和 Local Sync 都来自同一 `0.6.0` 候选版。
2. 创建专用私有测试 Space；所有 Agent、模板、运行、外部文件和分支都使用唯一前缀。
3. 至少准备两种真实客户端（Codex、Claude Code、OpenCode 中任意两种），分别用自己的 Agent Credential 接入唯一 `agentwiki` 网关。
4. 保存客户端版本、Space/Agent 角色页、运行看板、任务产物、事件时间线及命令输出；不保存 Credential 明文。
5. 若使用生产服务，必须另行获得授权；本文档不授权 push、npm 发布或生产部署。

## A. 自动化先决证据

| 检查 | 命令 | 结果 | 证据 |
| --- | --- | --- | --- |
| 21 个真实 PostgreSQL 场景 | `COLLABORATION_TEST_DATABASE_URL=... pnpm test:e2e:collaboration-db` | 待填 | 命令输出；必须显示非 `public` 的 `collaboration_test_*` schema |
| 真实 API + Worker + Credential + 远程 MCP | `COLLABORATION_TEST_DATABASE_URL=... pnpm test:e2e:collaboration` | 待填 | JSON `status: PASS`，包含六个工具和完整 flow |
| 完整本地发行门禁 | 项目计划 Task 13 命令集 | 待填 | 新鲜输出或 CI 链接 |

## B. 编码模板：真实多 Agent 闭环

必须同时满足：

- 至少两种真实连接客户端分别加入同一运行。
- 两个实现任务在依赖解锁后并行领取；每个 Agent 按顺序完成 Todo，心跳和租约时间可见。
- 产物包含 commit/patch 与测试证据，不以文字声称代替真实可复核引用。
- 人类审核员至少执行一次 `reject_for_revision`，受影响因果子图 generation 递增，旧产物保留但不再释放依赖。
- 驳回后指定 Agent 用合并恢复指令继续，再通过审核、汇总和终态完成。

| 检查 | 结果 | 证据/备注 |
| --- | --- | --- |
| 双客户端、并行任务、Todo、心跳 | `BLOCKED` | 待执行 |
| commit/patch 和测试证据 | `BLOCKED` | 待执行 |
| 人工驳回、generation 失效、恢复 | `BLOCKED` | 待执行 |
| 通过、汇总、完成 | `BLOCKED` | 待执行 |

## C. 租约超时/撤权与人工改派

1. 让一个正在执行的 Agent 租约超时，或立即撤销 Agent/Grant。
2. 确认旧租约不能心跳或提交，任务按重试预算确定性释放，或以 `agent_authorization_changed` / `retry_exhausted` 暂停。
3. 人类手工改派给之前未绑定的有效 Agent；新 Agent 凭当前 assignment 加入并完成。

| 检查 | 结果 | 证据/备注 |
| --- | --- | --- |
| 超时或撤权后的确定性结果 | `BLOCKED` | 待执行 |
| 旧租约被拒绝 | `BLOCKED` | 待执行 |
| 手工改派及新 Agent 完成 | `BLOCKED` | 待执行 |

## D. 标书模板

启动一个代表性运行，必须保留三个人工门：

- `bid-consensus-review`
- `missing-material-review`
- `final-bid-review`

覆盖矩阵、大纲映射、图文映射、引用/材料缺口检查和合并稿检查必须仍由 Agent 任务执行，不得改成人工检查或绕过。

| 检查 | 结果 | 证据/备注 |
| --- | --- | --- |
| 三个人工门 | `BLOCKED` | 待执行 |
| 覆盖、大纲、图文、合并稿机器任务 | `BLOCKED` | 待执行 |
| 缺失材料不被虚构 | `BLOCKED` | 待执行 |

## E. 论文、视频脚本和小说模板

| 模板 | 必查约束 | 结果 | 证据/备注 |
| --- | --- | --- | --- |
| 论文 | 内置 schema 有效；真实来源标识、引文/主张支持和不可验证主张均被显式核验 | `BLOCKED` | 待执行 |
| 视频脚本 | 内置 schema 有效；事实来源、时长预算、品牌约束和旁白/分镜对齐被检查 | `BLOCKED` | 待执行 |
| 小说 | 内置 schema 有效；世界规则、角色知识边界、时间线、状态和未解线索的连续性依赖被检查 | `BLOCKED` | 待执行 |

## F. 清理与最终判定

1. 删除或归档本次唯一前缀的测试 Space、Agent、模板、运行、Artifact 及外部文件。
2. 核对非测试 Space、Agent、模板、运行、Artifact、Git 分支和外部文件未被改动。
3. 附清理前后的资源列表或查询证据。

| 检查 | 结果 | 证据/备注 |
| --- | --- | --- |
| 唯一前缀测试资源已清理 | `BLOCKED` | 待执行 |
| 非测试资源无变更 | `BLOCKED` | 待执行 |

最终结论只能在 A–F 所有必需项都是 `PASS` 后填写为 `PASS`。任一必需项是 `FAIL` 或 `BLOCKED`，整体必须保持对应状态。
