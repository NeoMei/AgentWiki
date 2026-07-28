<!-- codex-memory:template=task-decisions:v1 -->

# 决策

- 本地 Agent 是扫描和同步编排者；AgentWiki 服务端只接收已确认的派生知识。
- OpenWiki 的 OKF v0.1 是交换格式；OpenWiki 不在 AgentWiki 服务端运行。
- codebase-memory 只增强代码来源；MarkItDown 只转换本地文档。
- 同步确认发生在任何本地知识上传之前，差异通过服务端只读哈希状态在本地计算。
- OpenWiki 使用非本地模型时，必须在模型调用前进行独立的数据边界确认；这不能被 AgentWiki 同步确认替代。
- 第一版使用不超过 10 MiB 的 OKF JSON Envelope，通过 Agent Credential 认证的 multipart HTTP 接口上传。
- 复用 Source、SourceVersion、IngestRun、Evidence、ChangeSet 和既有发布策略。
- 本地能力发布为公开 npm 包 `@agentwiki/local-sync`，由 Agent Skill、stdio MCP、CLI、工具适配器和薄客户端配置适配器组成；不绑定 OpenCode 或其他单一 Agent。
- OpenWiki、codebase-memory 和 MarkItDown 不捆绑进插件；缺失时报告并询问，不静默安装。
- AgentWiki 由有权人类生成绑定 Agent/Scope/版本的 10 分钟单次安装码；Redis 保存哈希并原子消费，兑换后只返回一次长期 Credential。
- 固定版本接入指令由本地 Agent 执行，自动安装 Skill、注册 MCP、安全保存 Credential 并运行 doctor；安装过程不扫描或同步。
- 长期 Credential 不进入命令参数、项目目录、Skill 或 MCP 明文配置；本地凭据文件仅当前用户可读。
- npm 是第一版分发渠道，GitHub Release 提供源码与审计信息；安装、升级和卸载均固定明确版本，不使用 `latest`。
- 卸载默认保留 `sync-state.json`，防止重装后同一本地来源被识别成新来源；删除同步历史和本地 Credential 都需要用户明确选择。
- 实施拆为服务端、本地插件、产品接入三份连续计划，每份都有独立测试和提交门禁。
- OpenWiki 始终在临时 staging 仓库运行，避免扫描时改写用户仓库中的 `AGENTS.md`、`CLAUDE.md` 或 `openwiki/`；代码文件由 `git ls-files -co --exclude-standard` 复制当前工作树内容。
- 一次性安装记录以完整 `sha256(code)` 作为可撤销的 installationId 和 Redis key，不保存明文码，也不引入反向索引。
- CLI 的 `scan` 复用 MCP prepare-and-diff 核心，`preview` 只展示已保存预览；保持公开命令清晰而不复制扫描逻辑。
