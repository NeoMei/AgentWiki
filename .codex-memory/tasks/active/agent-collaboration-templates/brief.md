# Agent 协作模板与组件

## 目标

在 AgentWiki Space 中提供编码、标书、论文、视频脚本和小说五类内置协作模板，让用户通过角色槽位映射外部 Agent，配置任务、顺序 Todo、依赖/并行、人工审核与结果汇总，并通过 MCP 完成可观察、可恢复的协作运行。

## 当前阶段

- 需求、架构、领域模型、五个组件、五类模板、页面交互、MCP 协议、失败恢复和验收设计均已由用户确认。
- 正式设计文档已确认，13 个任务的 TDD 实施计划已完成完整性修订和跨文档一致性检查。
- 修订已把驳回后的因果子图 generation 失效、改派后的加入授权、`waiting_review` 优先级、隔离 PostgreSQL schema 测试、复合外键/约束、完整 REST API、严格共享契约、受限 Ajv、幂等作用域、`any` 提前释放、外部引用规范化、seed 非降级和 0.6.0 合并发布写成可验收规则。
- 统一访问角色前置能力已经随 `0.5.1` 发布并完成生产验证；协作实现已在隔离分支 `codex/agent-collaboration-workflows` 启动。
- 任务 1-13 的代码与自动化验收已完成：包括后端协作控制面、五类模板、Space 工作台、编辑/启动向导、运行看板、六个 MCP 工具、Local Sync 0.6.0、真实 PostgreSQL 并发场景与 API/Worker/MCP E2E。
- PostgreSQL 门禁覆盖计划列出的 21 个场景；HTTP/MCP E2E 用产品 API 创建人类成员、Agent 与 Credential，完成审核与改派闭环。
- 执行链路在事务内重验 `AgentGrant.role`、Agent/空间状态与当前 generation；租约明文不落库/不进事件，修复预算与基础设施重试预算独立。
- API/Worker 模块图已证明隔离；Worker 只注册恢复所需 provider，Socket 运行房间使用轻量只读鉴权服务，不把 HTTP Guard/Controller 拖入 Worker。
- 隔离 PostgreSQL 门禁验证了复合跨运行外键、CHECK、部分唯一活跃租约索引和测试 schema 精确清理；Prisma 漂移仍只允许既有 HNSW 索引一项窄例外。

## 依赖

- 直接复用已经发布的 `0.5.1` 统一角色模型和实时授权门禁。
- 协作能力在统一角色策略中派生 `collaboration:read` 与 `collaboration:execute`，普通界面仍只选择 `reader | editor | publisher`。
- 协作完成后 local-sync、server/client、网关和 onboarding 兼容面统一进入 0.6.0；sync-protocol 保持独立包 semver。

## 范围

- AgentWiki 服务端协作控制面；
- 外部 Agent MCP 领取、心跳、Todo、提交与等待循环；
- 五个核心组件和五个内置模板；
- Space 协作入口、模板配置、启动向导和运行看板；
- 租约、重试、改派、人工审核、产物版本与审计；
- 自动化和真实多 Agent E2E。

## 不做

- 服务端托管模型或远程自动唤醒；
- 自由拖拽、条件表达式、循环、Webhook、子流程或任意脚本；
- 动态竞领、自动改派或通用文件仓库；
- Agent 人工审核或绕过现有 Wiki 发布治理。

## 下一步

1. 跑完整本地发行门禁，复核迁移、安全边界、版本面与工作树。
2. 真实 Codex/Claude Code/OpenCode 至少两种客户端仍须按 `docs/testing/collaboration-real-agent-acceptance.md` 执行；当前结果是 `BLOCKED`。
3. 全部本地门禁与真实客户端验收通过后，再单独请求 push/npm/生产授权。
