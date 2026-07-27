export interface AgentConnectInput {
  baseUrl: string;
  apiKey: string;
  agentName: string;
  scopes: string[];
}

const SCOPE_TOOL_HINTS: Record<string, string> = {
  'pages:read': 'list_pages / get_page / search_pages',
  'pages:write': 'propose_page',
  'graph:read': 'list_graph',
  'graph:write': 'propose_relation',
  'sources:read': 'list_sources',
  'runs:write': 'start_source_run',
  'memory:read': 'recall_memory',
  'review:read': 'list_reviews',
};

export const buildAgentConnectInstructions = (input: AgentConnectInput, zh: boolean): string => {
  const base = input.baseUrl.replace(/\/$/, '');
  const mcpUrl = base + '/mcp';
  const tools = input.scopes
    .map((scope) => SCOPE_TOOL_HINTS[scope])
    .filter(Boolean)
    .join(', ');
  const scopes = input.scopes.join(', ');

  if (zh) {
    return [
      '# 接入 AgentWiki',
      '',
      '你已被授权接入一个 AgentWiki 知识库，Agent 名称为「' + input.agentName + '」。请按以下步骤自助完成接入，并向用户报告结果。',
      '',
      '## 连接信息',
      '- MCP 端点（Streamable HTTP）: ' + mcpUrl,
      '- 认证方式: 在请求头携带 `Authorization: Bearer ' + input.apiKey + '`（也可用 `x-api-key: ' + input.apiKey + '`）',
      '- 授权范围 (scopes): ' + scopes,
      '',
      '## 接入步骤',
      '1. 把上面这个 MCP server 加入你的 MCP 客户端配置，type 为 remote/http，url 为上面的端点，headers 带上 Authorization。',
      '2. 若你的客户端只支持 stdio，请使用官方 HTTP↔stdio 代理（如 `npx -y mcp-remote ' + mcpUrl + ' --header "Authorization: Bearer ' + input.apiKey + '"`）桥接。',
      '3. 连接后调用 MCP 的 initialize 握手，再任选你已授权的一个工具做一次真实调用（例如 search_pages 或 get_page）确认可用。',
      '',
      '## 你可用的工具',
      tools ? '- 根据授权范围，你至少可以调用: ' + tools + '。' : '- 根据授权范围调用相应工具。',
      '- 写入类工具（propose_page 等）会生成 ChangeSet 进入人工审批，不会直接落库；你无权批准自己的变更。',
      '',
      '## 报告',
      '- 成功后请告诉用户「已成功接入 AgentWiki（' + input.agentName + '）」，并列出你实际可用的工具。',
      '- 若失败（如 401/403、Host 不在白名单、网络不可达），请把具体错误告诉用户并停下，不要重试爆破凭据。',
      '',
      '注意：凭据等同于密码，不要打印到公开日志、提交进仓库或分享给他人。',
    ].join('\n');
  }

  return [
    '# Connect to AgentWiki',
    '',
    'You have been granted access to an AgentWiki knowledge base as the agent "' + input.agentName + '". Follow these steps to connect yourself, then report the result to the user.',
    '',
    '## Connection',
    '- MCP endpoint (Streamable HTTP): ' + mcpUrl,
    '- Auth: send header `Authorization: Bearer ' + input.apiKey + '` (or `x-api-key: ' + input.apiKey + '`)',
    '- Granted scopes: ' + scopes,
    '',
    '## Steps',
    '1. Add the MCP server above to your MCP client configuration as a remote/http server, using the endpoint URL and the Authorization header.',
    '2. If your client only supports stdio, bridge via the official HTTP↔stdio proxy (e.g. `npx -y mcp-remote ' + mcpUrl + ' --header "Authorization: Bearer ' + input.apiKey + '"`).',
    '3. After connecting, perform the MCP initialize handshake, then call one tool you are authorized for (e.g. search_pages or get_page) to confirm it works.',
    '',
    '## Tools you can use',
    tools ? '- Based on your scopes you can call at least: ' + tools + '.' : '- Call the tools allowed by your scopes.',
    '- Write tools (propose_page, etc.) create a ChangeSet that needs human approval; they do not write directly, and you cannot approve your own changes.',
    '',
    '## Report',
    '- On success, tell the user "Connected to AgentWiki (' + input.agentName + ')" and list the tools you can actually use.',
    '- On failure (401/403, Host not allowlisted, network unreachable), report the exact error to the user and stop — do not retry-guess the credential.',
    '',
    'Treat this credential like a password: do not log it publicly, commit it, or share it.',
  ].join('\n');
};
