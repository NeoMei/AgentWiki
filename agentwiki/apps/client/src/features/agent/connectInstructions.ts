export interface AgentConnectInput {
  baseUrl: string;
  apiKey: string;
  agentName: string;
}

export const buildAgentConnectInstructions = (input: AgentConnectInput, zh: boolean): string => {
  const base = input.baseUrl.replace(/\/$/, '');
  const mcpUrl = base + '/mcp';
  const accessUrl = base + '/integrations/mcp';

  if (zh) {
    return [
      '# 接入 AgentWiki',
      '',
      '你是本地 Agent「' + input.agentName + '」。请按以下步骤接入 AgentWiki 并报告结果。',
      '',
      '## 连接',
      '- MCP 端点（Streamable HTTP）: ' + mcpUrl,
      '- 认证: 请求头携带 `Authorization: Bearer ' + input.apiKey + '`',
      '',
      '## 步骤',
      '1. 把该 MCP server 加入你的客户端配置（remote/http，url 为端点，带 Authorization 头）。只支持 stdio 的客户端用 `npx -y mcp-remote ' + mcpUrl + ' --header "Authorization: Bearer ' + input.apiKey + '"` 桥接。',
      '2. 连接后先调用 initialize 握手。',
      '3. 查询你的授权信息：GET ' + accessUrl + '（带同一 Authorization 头），返回你可用的工具、Space 授权与凭据范围。你能做什么以服务端返回为准，无需在本地猜测。',
      '4. 任选你已授权的一个工具做一次真实调用确认可用。',
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
    '- MCP endpoint (Streamable HTTP): ' + mcpUrl,
    '- Auth: send header `Authorization: Bearer ' + input.apiKey + '`',
    '',
    '## Steps',
    '1. Add this MCP server to your client config (remote/http, endpoint URL, with the Authorization header). stdio-only clients bridge via `npx -y mcp-remote ' + mcpUrl + ' --header "Authorization: Bearer ' + input.apiKey + '"`.',
    '2. Call the initialize handshake after connecting.',
    '3. Discover your access: GET ' + accessUrl + ' with the same Authorization header. It returns the tools, space grants and credential scopes you have. The server response is the source of truth for what you can do — do not guess locally.',
    '4. Call one tool you are authorized for to confirm it works.',
    '',
    '## Report',
    '- Success: tell the user "Connected to AgentWiki (' + input.agentName + ')" and list your usable tools.',
    '- Failure: report the exact error (401/403/Host allowlist/network) and stop; do not retry the credential.',
    '',
    'Authorization is decided and enforced by the AgentWiki server. Treat this credential like a password.',
  ].join('\n');
};
