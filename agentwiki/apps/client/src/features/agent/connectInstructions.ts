export interface AgentConnectInput {
  baseUrl: string;
  apiKey: string;
  agentName: string;
}

export const buildAgentConnectInstructions = (input: AgentConnectInput, zh: boolean): string => {
  const base = input.baseUrl.replace(/\/$/, '');
  const mcpUrl = base + '/mcp';
  const accessUrl = base + '/integrations/mcp';
  const credentialId = input.apiKey.replace(/^agk_/, '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 8).toLowerCase() || 'agent';
  const serverName = 'agentwiki-' + credentialId;

  if (zh) {
    return [
      '# 接入 AgentWiki',
      '',
      '你是本地 Agent「' + input.agentName + '」。请按以下步骤接入 AgentWiki 并报告结果。',
      '',
      '## 连接',
      '- MCP 连接名: ' + serverName,
      '- MCP 端点（Streamable HTTP）: ' + mcpUrl,
      '- 认证: 请求头携带 `Authorization: Bearer ' + input.apiKey + '`',
      '',
      '## 步骤',
      '1. 为当前凭据创建独立 MCP 连接 `' + serverName + '`。OpenCode 可执行 `opencode mcp add ' + serverName + ' --url ' + mcpUrl + ' --header "Authorization=Bearer ' + input.apiKey + '"`；其他客户端使用相同连接名、端点和请求头。不得复用已有的 AgentWiki 连接；若同名连接已存在，先更新或替换它。只支持 stdio 的客户端用 `npx -y mcp-remote ' + mcpUrl + ' --header "Authorization: Bearer ' + input.apiKey + '"` 桥接。',
      '2. 连接后先调用 initialize 握手。',
      '3. 先调用 list_spaces 工具，拿到你可访问的 Space 及其内部 id。spaceId 参数要的是内部 id（CUID），不是显示名。',
      '4. 你的授权以服务端为准：访问 GET ' + accessUrl + '（带同一 Authorization 头），确认返回的 Agent 名称是「' + input.agentName + '」。若身份不匹配，停止并报告连接错误。',
      '5. 使用 `' + serverName + '` 下的已授权工具做一次真实调用确认可用。',
      '',
      '## 报告',
      '- 成功: 告诉用户「已接入 AgentWiki（' + input.agentName + '）」并列出可用工具。',
      '- 失败: 把确切错误（401/403/Host 白名单/网络）告诉用户并停止，不要重试凭据。',
      '',
      '授权由 AgentWiki 服务端统一判定与执行；凭据等同密码，请勿泄露。',
    ].join('\n');
  }

  return [
    '# Connect to AgentWiki',
    '',
    'You are the local agent "' + input.agentName + '". Connect to AgentWiki with these steps, then report the result.',
    '',
    '## Connection',
    '- MCP connection name: ' + serverName,
    '- MCP endpoint (Streamable HTTP): ' + mcpUrl,
    '- Auth: send header `Authorization: Bearer ' + input.apiKey + '`',
    '',
    '## Steps',
    '1. Create a credential-specific MCP connection named `' + serverName + '`. OpenCode can run `opencode mcp add ' + serverName + ' --url ' + mcpUrl + ' --header "Authorization=Bearer ' + input.apiKey + '"`; other clients use the same connection name, endpoint, and header. Do not reuse an existing AgentWiki connection; update or replace it if the same name already exists. stdio-only clients bridge via `npx -y mcp-remote ' + mcpUrl + ' --header "Authorization: Bearer ' + input.apiKey + '"`.',
    '2. Call the initialize handshake after connecting.',
    '3. Call the list_spaces tool first to get the spaces you can access and their internal ids. The spaceId parameter expects the internal id (CUID), not the display name.',
    '4. Your access is decided by the server: call GET ' + accessUrl + ' with the same Authorization header and confirm the returned Agent name is "' + input.agentName + '". Stop and report a connection error if the identity does not match.',
    '5. Call one authorized tool through `' + serverName + '` to confirm it works.',
    '',
    '## Report',
    '- Success: tell the user "Connected to AgentWiki (' + input.agentName + ')" and list your usable tools.',
    '- Failure: report the exact error (401/403/Host allowlist/network) and stop; do not retry the credential.',
    '',
    'Authorization is decided and enforced by the AgentWiki server. Treat this credential like a password.',
  ].join('\n');
};
