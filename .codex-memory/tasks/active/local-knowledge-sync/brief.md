<!-- codex-memory:template=task-brief:v1 -->

# local-knowledge-sync

## 目标

实现零配置 Local Knowledge Orchestrator：从 codebase-memory、MarkItDown 和未来 agent-memory 等 Adapter 获取本地整理材料，由当前本地 Agent 按稳定协议生成统一 Space Wiki，并与 AgentWiki 权威版本库进行确认门禁下的双向同步。

## 当前状态

- `@neomei/agentwiki-local-sync@0.2.2` 已发布；npm registry/latest、bin、干净临时目录 npx 均验证通过。
- 2026-08-03 单机真实 E2E 已通过：真实安装码、Codex MCP、codebase-memory 0.9.0、本地代码库扫描、preview、确认同步、Worker、自动发布、页面 provenance/evidence 以及二次 noop 均验证；测试资源已清理。
- 扫描降噪修复已随 `0.2.2` 发布：非 Git 回退排除 `dist`/`node_modules` 等目录，codebase-memory 已处理的源码不再被误报 unsupported；160 项 local-sync 测试、客户端 121、服务端 267、build 与 lint 通过。
- `@neomei/agentwiki-local-sync@0.1.1` 已发布；OKF evidence 和 OpenCode timeout 修复已完成。
- 真实验证确认 OpenWiki 过重且不稳定，旧 OpenWiki 必需链路被新设计取代。
- 用户已逐项确认本地整理、Agent 执行语义工作、确定性状态机/Recipe、Space 统一 Wiki、私有 Adapter runtime、服务端权威 Revision、双向同步与三方合并。
- 新设计已写入 `agentwiki/docs/superpowers/specs/2026-07-30-zero-config-local-knowledge-orchestrator-design.md`，并已得到用户确认。
- `0.2.0` 总路线图与四份顺序实施计划已经完成并自审。
- **P0 协议与骨架已完成**：SourceAdapter 协议、SourceArtifact/KnowledgeBundle/Recipe/JobState 协议、`core/orchestrator.ts` 骨架、`workspace/manifest.ts` 与 `workspace/layout.ts` 已落地。
- **P1 Space 本地 Workspace 与完整状态机已完成**：
  - 目录结构 `~/.agentwiki/spaces/<space-id>/{wiki/{pages,memories,relations.json},.state/{manifest.json,provenance.json,base,drafts,checkpoints,runtime}}` 已实现并持久化。
  - Orchestrator 状态机完整阶段 `idle → discover → collect → organize → validate → preview → confirm → push → pull → merge → done`，支持失败 `failed` 阶段。
  - 状态持久化到 checkpoint，支持 `persistCheckpoint`、`loadLatestCheckpoint`、`resumeFromCheckpoint` 和 `pruneCheckpoints`。
  - `workspace/space.ts` 提供 `initSpaceWorkspace`、`isWorkspaceInitialized`、`setBaseRevision` 和稳定的 `stableSpaceId`。
  - 每个 phase 可基于 Recipe 步骤生成最小工作单元（`planPhaseWorkItems`），支持 `advanceAfterWorkItem` 自动推进到下一 phase。
  - 单元测试覆盖 workspace 读写、checkpoint 恢复、space 初始化、状态机流转与 phase 推进。`local-sync` 包 typecheck 和 100 个测试全部通过。
- 下一步：继续跨机器 Snapshot/Delta Pull/Push 与冲突合并真实验收。

## 范围

- Source Adapter 协议：codebase-memory、MarkItDown、agent-memory 和未来 Adapter。
- `@neomei/agentwiki-local-sync` Agent Skill、stdio MCP、CLI、Local Knowledge Orchestrator 和 Adapter Manager。
- AgentWiki 生成固定版本接入指令和 10 分钟单次安装码。
- 本地状态机、版本化 Recipe、Schema、provenance、checkpoint、preview 和明确确认。
- 同一 Space 统一 Wiki、本地文件物化、服务端 Snapshot/Delta/Revision 和跨机器双向同步。
- base/local/remote 三方冲突合并提案。
- 代码、Markdown/TXT/PDF/DOCX 和未来可共享 Agent Memory。

## 不做

- 服务端读取本地路径。
- 上传原始代码库、原始二进制文件、原始 Agent Memory 数据库或本地凭据。
- OpenWiki、独立本地模型或全服共享模型作为必需整理引擎。
- Source Adapter 直接写 Wiki、同步、审批或发布。
- P2P/CRDT 多主同步、last-write-wins、后台 daemon 或第一阶段实时文件监听。
- 仅靠提示词约束的自由工作流。
