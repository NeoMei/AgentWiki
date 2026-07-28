<!-- codex-memory:template=task-decisions:v1 -->

# 决策

- 本地 Agent 是扫描和同步编排者；AgentWiki 服务端只接收已确认的派生知识。
- OpenWiki 的 OKF v0.1 是交换格式；OpenWiki 不在 AgentWiki 服务端运行。
- codebase-memory 只增强代码来源；MarkItDown 只转换本地文档。
- 同步确认发生在任何本地知识上传之前，差异通过服务端只读哈希状态在本地计算。
- OpenWiki 使用非本地模型时，必须在模型调用前进行独立的数据边界确认；这不能被 AgentWiki 同步确认替代。
- 第一版使用不超过 10 MiB 的 OKF JSON Envelope，通过 Agent Credential 认证的 multipart HTTP 接口上传。
- 复用 Source、SourceVersion、IngestRun、Evidence、ChangeSet 和既有发布策略。
