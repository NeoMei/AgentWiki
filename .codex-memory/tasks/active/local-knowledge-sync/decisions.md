<!-- codex-memory:template=task-decisions:v1 -->

# 决策

## 数据边界

- 所有采集、转换、语义整理、冲突合并和敏感信息检查均在本地完成。
- 原始代码仓库、原始二进制文档、原始 Agent Memory 数据库和本地凭据永不上传。
- 可以上传完整的可迁移知识产物；边界由“是否已整理为共享知识”决定，而不是由摘录长度决定。
- AgentWiki 服务端只接收页面、共享记忆、关系、provenance、必要证据、删除提案和版本信息。

## 整理引擎

- OpenWiki 不再是必需组件；零配置方案不要求 OpenWiki init、独立 Provider 或额外模型 Key。
- 当前本地 Agent 负责需要语义判断的整理和写作；Orchestrator 不内嵌第二套模型。
- 采用确定性状态机、版本化 Recipe、Schema、稳定 ID、checkpoint 和有界修复循环约束 Agent，不能只依赖提示词。
- Agent 只填写语义字段；路径、ID、排序、hash、版本、幂等和同步状态由 Orchestrator 管理。

## Adapter

- codebase-memory、MarkItDown 和未来 agent-memory 是同等地位的 Source Adapter。
- Adapter 只产生标准化 SourceArtifact，不能直接写统一 Wiki、同步、审批或发布。
- Adapter 使用 manifest 声明版本、输入、输出、权限、增量能力和私有运行时依赖。
- Adapter 按需安装到 `~/.agentwiki/runtime/`，优先复用兼容安装，不修改全局环境，不运行交互式 init。
- Adapter 升级先验证再原子切换，失败回滚；超时或取消必须回收整个进程组。

## Space 与本地 Workspace

- Space 是知识隔离、版本和同步的最小边界。
- 同一 Space 只有一套统一 Wiki，多种 Adapter 只作为来源和证据。
- 本地以 `~/.agentwiki/spaces/<space-id>/wiki/` 物化 Markdown/JSON，供 Agent 高频直接读取。
- `.state/` 保存 manifest、provenance、base、draft 和 checkpoint，不作为知识内容展示。

## 双向同步

- AgentWiki 服务端是权威 Revision，本地是可编辑缓存和工作副本。
- 首次 Pull 获取 Snapshot，后续按 Revision 获取 Delta；物化必须临时写入并原子替换。
- Push 前强制 Pull，并计算 base/local/remote 三方差异。
- 非冲突项确定性合并；同字段冲突由本地 Agent 按 Recipe 生成合并提案。
- 合并提案必须预览确认，禁止静默覆盖和 last-write-wins。
- 删除使用 tombstone，防止离线节点复活旧知识。
- 服务端发布新 Revision 后，其他 Agent 通过 Pull 获得同一结果。

## 安装与权限

- 正常用户体验保持一个 AgentWiki 接入指令和自然语言调用，不要求手写 MCP、Space ID、preview ID、端口或 CLI 内部命令。
- 基础组件使用 stdio MCP，不开放本地端口，不增加后台 daemon。
- 一次性安装码仍绑定 Agent、Scope 和精确版本；长期 Credential 不进入命令、项目目录、Skill、MCP 配置或日志。
- 有效权限仍为 Credential Scope、Space Grant 和 Space Policy 的交集。
- 任何上传前都必须在当前对话展示预览并取得明确确认；Agent 不能代替用户审批 ChangeSet。

## 版本与迁移

- `@neomei/agentwiki-local-sync@0.1.1` 已发布，但仍属于旧 OpenWiki 路径，不能宣传为零配置方案。
- 新架构使用 `0.2.0`，并定义新的 Adapter、Artifact、KnowledgeBundle、Recipe、Job State、Revision 和 Delta 协议。
- `0.1.x` 不自动切换到 `0.2.0`；升级先迁移本地配置和 Space Workspace，再切换 MCP。
- 旧 OpenWiki preview 不能直接作为新 Bundle 上传，需要通过迁移 Recipe 重新整理。
- `0.2.0` 完成跨 Agent、跨机器真实 E2E 前，使用指南不能声称新方案可用。
