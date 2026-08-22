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
- 不得恢复需要交互式初始化或独立模型配置的外部 Wiki 编译器链路。

## Space 与同步

- Space 是知识隔离、版本和同步的最小边界，同一 Space 只有一套统一 Wiki。
- AgentWiki 服务端保存权威 Revision，本地保存可编辑、可恢复的文件副本。
- 支持 Snapshot、Delta、Pull、Push 和跨机器恢复。
- Push 前必须 Pull；同字段冲突使用 base/local/remote 三方合并提案，禁止静默覆盖和 last-write-wins。
- 任何上传前必须展示预览并在当前对话取得明确确认；Agent 不能替用户审批 ChangeSet。

## 安装体验

- 用户只需要 AgentWiki 生成的一个接入指令和后续自然语言操作。
- `0.5.0` 接入时一次选择 Space 和 `reader` / `editor` / `publisher`；兑换必须原子创建同角色 Credential 与 Grant，scopes 仅由服务端派生。
- 本地 Agent 只安装一个名为 `agentwiki` 的 stdio MCP gateway；它统一提供 `wiki_*`、`local_*`、`knowledge_*`，远程 `/api/mcp` 只作为 gateway 内部桥接目标。
- 普通 Agent Credential 只用于 API、脚本或外部系统，不生成第二个 MCP 指令。已有 Agent 使用精确版本 `onboard --code` 接入；全局新 Agent 使用 Device Auth `onboard`。
- Adapter 按需安装到 `~/.agentwiki/runtime/`，优先复用兼容版本，不修改全局环境，不运行交互式 init。
- 基础组件使用 stdio MCP，不要求用户配置模型、额外 Key、MCP JSON、本地端口或 daemon。

## 版本边界

- `@neomei/agentwiki-local-sync@0.1.1` 属于旧编译器路径，不能描述为零配置方案。
- `0.3.7` 起公开入口只允许 `onboard`、`gateway`、`doctor`、`uninstall`；不得恢复 `connect`、`mcp`、`scan`、`sync`、`upgrade` 旧 CLI。
- `0.5.0` 是不兼容的角色协议；不接受 `0.4.0` 此流程请求、Agent `viewer/full`、`permissionPreset`、`approvalMode` 或自定义 scopes。
- 旧 direct/local AgentWiki MCP 只能在用户确认、配置备份和并发 hash 校验后迁移；不能仅因名称包含 `agentwiki` 就删除第三方配置。
