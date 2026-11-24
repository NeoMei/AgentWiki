# AgentWiki v0.12.74

- 新增 AgentWiki Markdown 写作 Schema v1.0.0，提供 19 类语法、适用条件和新建、更新文章的调用示例。覆盖同空间与跨空间内链、外链、标题及块锚点、附件图片、页面嵌入、表格、公式和 Mermaid。
- MCP 接入与重连指引会提示 Agent 加载写作规则。直连客户端可调用 `get_writing_schema` 或读取 `agentwiki://writing-schema`，本地网关可调用 `wiki_get_writing_schema`。
- 新接入默认使用 Local Sync 0.13.7，网关握手会提示 Agent 获取 Schema。已安装的 0.13.6 网关在重载工具后也可调用 Schema。原有连接凭据继续有效。
