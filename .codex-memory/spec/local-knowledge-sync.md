<!-- codex-memory:template=project-spec:v1 -->

# 本地知识编排与同步长期规则

## 权威设计

- `agentwiki/docs/superpowers/specs/2026-07-30-zero-config-local-knowledge-orchestrator-design.md`

## 数据边界

- 原始代码、原始文件、原始 Agent Memory 数据库和本地凭据永不上传。
- 所有采集、转换、整理、冲突合并和敏感信息检查在本地完成。
- 服务端只保存可迁移、可共享的知识产物及其 provenance、证据、删除提案和版本。

## 组件边界

- codebase-memory、MarkItDown、agent-memory 和未来来源都是 Source Adapter。
- Adapter 只能输出版本化 SourceArtifact，不能直接修改 Wiki、同步、审批或发布。
- 当前本地 Agent 负责语义整理；Orchestrator 通过状态机、Recipe、Schema、稳定 ID、checkpoint 和有界修复控制行为。
- OpenWiki 不再是必需组件，不得恢复为默认整理链路。

## Space 与同步

- Space 是知识隔离、版本和同步的最小边界，同一 Space 只有一套统一 Wiki。
- AgentWiki 服务端保存权威 Revision，本地保存可编辑、可恢复的文件副本。
- 支持 Snapshot、Delta、Pull、Push 和跨机器恢复。
- Push 前必须 Pull；同字段冲突使用 base/local/remote 三方合并提案，禁止静默覆盖和 last-write-wins。
- 任何上传前必须展示预览并在当前对话取得明确确认；Agent 不能替用户审批 ChangeSet。

## 安装体验

- 用户只需要 AgentWiki 生成的一个接入指令和后续自然语言操作。
- Adapter 按需安装到 `~/.agentwiki/runtime/`，优先复用兼容版本，不修改全局环境，不运行交互式 init。
- 基础组件使用 stdio MCP，不要求用户配置模型、额外 Key、MCP JSON、本地端口或 daemon。

## 版本边界

- `@neomei/agentwiki-local-sync@0.1.1` 属于旧 OpenWiki 路径，不能描述为零配置方案。
- 新架构目标版本为 `0.2.0`；完成真实跨 Agent、跨机器 E2E 前不得在使用指南中宣称可用。
- 旧 `0.1.x` 连接不能静默升级到 `0.2.0`，必须先生成本地 Workspace 迁移预览。
