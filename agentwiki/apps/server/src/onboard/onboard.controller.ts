import { Controller, Get, Header } from '@nestjs/common';

@Controller()
export class OnboardController {
  @Get('onboard')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  getMarkdown(): string {
    return ONBOARD_MD;
  }

  @Get('onboard.json')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  getJson(): OnboardPlan {
    return ONBOARD_JSON;
  }
}

type SavedField = {
  field: string;
  as: string;
  description: string;
};

type Step = {
  step: number;
  name: string;
  note?: string;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  action?: string;
  config?: Record<string, unknown>;
  save: SavedField[];
};

type OnboardPlan = {
  title: string;
  description: string;
  apiBaseUrl: string;
  agentInstruction: string;
  conventions: Record<string, string>;
  steps: Step[];
  mcpEndpoint: {
    url: string;
    transport: string;
    authHeader: string;
    requiredAccept: string;
    note: string;
  };
};

const BASE_URL = 'https://agentwiki.quukk.com';
const API_BASE = `${BASE_URL}/api`;

const ONBOARD_JSON: OnboardPlan = {
  title: 'AgentWiki 自助接入计划',
  description: '本地 Agent 通过调用 AgentWiki 公开 API，完成注册、建空间、建 Agent 身份、授权、生成 API Key、创建第一页，并自动注册 MCP server 让本地 Agent 可以持续使用 AgentWiki 工具。',
  apiBaseUrl: API_BASE,
  agentInstruction:
    '你是一个本地 AI Agent。请按 steps 顺序执行每一步操作。\n\n规则：\n1. 对 HTTP 请求步骤，实际调用 method/url/headers/body，并把 save 声明的字段保存为变量，供后续步骤替换占位符（如 {{TOKEN}}、{{AGENT_KEY}}）。\n2. 对 action 为 register_mcp_server 的步骤，根据 config 在本地 Agent 环境中配置 MCP server。如果当前环境不支持自动配置，则输出 config 文本，告诉用户如何手动粘贴到配置文件中。\n3. 若用户未提供邮箱/密码/名称，请先询问。\n4. 执行前告知用户你要做什么，执行后把关键结果告知用户确认。',
  conventions: {
    TOKEN: '步骤 1 注册后返回的 access_token',
    SPACE_ID: '步骤 2 创建空间后返回的 id',
    AGENT_ID: '步骤 3 创建 Agent 身份后返回的 id',
    AGENT_KEY: '步骤 5 生成的 apiKey（agk_ 开头），只显示一次，必须立即保存',
  },
  steps: [
    {
      step: 1,
      name: '注册账号',
      note: '请用户提供邮箱、密码（至少8位）和昵称，然后调用注册接口。',
      method: 'POST',
      url: `${API_BASE}/auth/register`,
      headers: { 'Content-Type': 'application/json' },
      body: { email: '{{EMAIL}}', password: '{{PASSWORD}}', name: '{{NAME}}' },
      save: [{ field: 'access_token', as: 'TOKEN', description: '后续步骤的认证令牌' }],
    },
    {
      step: 2,
      name: '创建知识空间',
      method: 'POST',
      url: `${API_BASE}/spaces`,
      headers: { Authorization: 'Bearer {{TOKEN}}', 'Content-Type': 'application/json' },
      body: { name: '我的知识库' },
      save: [{ field: 'id', as: 'SPACE_ID', description: 'Agent 专属知识库 ID' }],
    },
    {
      step: 3,
      name: '创建 Agent 身份',
      method: 'POST',
      url: `${API_BASE}/agents`,
      headers: { Authorization: 'Bearer {{TOKEN}}', 'Content-Type': 'application/json' },
      body: { name: '我的助手', approvalMode: 'always-review' },
      save: [{ field: 'id', as: 'AGENT_ID', description: 'Agent 身份 ID' }],
    },
    {
      step: 4,
      name: '授权 Agent 访问 Space',
      method: 'PUT',
      url: `${API_BASE}/agents/{{AGENT_ID}}/grants/{{SPACE_ID}}`,
      headers: { Authorization: 'Bearer {{TOKEN}}', 'Content-Type': 'application/json' },
      body: {
        role: 'editor',
        scopes: ['pages:read', 'pages:write', 'spaces:read', 'graph:read'],
      },
      save: [],
    },
    {
      step: 5,
      name: '生成 Agent 凭据',
      note: 'API Key 只显示一次，必须立即保存返回的 apiKey。',
      method: 'POST',
      url: `${API_BASE}/agents/{{AGENT_ID}}/credentials`,
      headers: { Authorization: 'Bearer {{TOKEN}}', 'Content-Type': 'application/json' },
      body: {
        name: 'default-key',
        scopes: ['pages:read', 'pages:write', 'spaces:read', 'graph:read'],
      },
      save: [{ field: 'apiKey', as: 'AGENT_KEY', description: 'Agent 专属 API Key，agk_ 开头' }],
    },
    {
      step: 6,
      name: '验证连接',
      method: 'GET',
      url: `${API_BASE}/spaces`,
      headers: { Authorization: 'Bearer {{AGENT_KEY}}' },
      save: [],
    },
    {
      step: 7,
      name: '创建第一个页面',
      method: 'POST',
      url: `${API_BASE}/pages`,
      headers: { Authorization: 'Bearer {{AGENT_KEY}}', 'Content-Type': 'application/json' },
      body: {
        spaceId: '{{SPACE_ID}}',
        title: 'Hello AgentWiki!',
        content: '# Hello!\n\nCreated by my local agent.',
      },
      save: [],
    },
    {
      step: 8,
      name: '注册 AgentWiki MCP Server',
      note: '让本地 Agent 可以直接调用 AgentWiki 工具（列出空间、搜索页面、创建页面等）。如果当前环境无法自动配置，请把 config 输出给用户手动粘贴。',
      action: 'register_mcp_server',
      config: {
        name: 'agentwiki',
        transport: 'streamableHttp',
        url: `${API_BASE}/mcp`,
        headers: { Authorization: 'Bearer {{AGENT_KEY}}', Accept: 'application/json, text/event-stream' },
      },
      save: [],
    },
  ],
  mcpEndpoint: {
    url: `${API_BASE}/mcp`,
    transport: 'Streamable HTTP',
    authHeader: 'Bearer {{AGENT_KEY}}',
    requiredAccept: 'application/json, text/event-stream',
    note: '已在步骤 8 中作为 MCP server 注册到本地 Agent。',
  },
};

const ONBOARD_MD = `# AgentWiki 自助接入向导

> 本 Markdown 是面向人类的说明。如果你是本地 AI Agent，请优先访问 JSON 版本：${BASE_URL}/api/onboard.json

---

## 给 Agent 的提示词

把下面这段话直接发给你的本地 Agent（Codex、Claude Code、OpenCode 等）：

\`\`\`
请访问 ${BASE_URL}/api/onboard.json 获取 AgentWiki 结构化接入计划，然后按 steps 顺序执行。每一步中，把 save 声明的字段保存为变量，用于替换后续步骤 URL、headers、body 中的占位符（如 {{TOKEN}}）。若我没有提供邮箱、密码或昵称，请先问我。每一步执行前告知我你要做什么，执行后把关键结果告诉我。
\`\`\`

---

## 手动接入步骤

如果你希望自己手动完成，也可以按以下顺序调用 API：

API 地址: ${API_BASE}

### 步骤 1：注册账号

\`\`\`bash
curl -X POST ${API_BASE}/auth/register \\
  -H "Content-Type: application/json" \\
  -d '{"email":"EMAIL","password":"PASSWORD","name":"NAME"}'
\`\`\`

保存返回的 \`access_token\`。

### 步骤 2：创建知识空间

\`\`\`bash
curl -X POST ${API_BASE}/spaces \\
  -H "Authorization: Bearer TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"我的知识库"}'
\`\`\`

保存返回的 \`id\` 作为 \`SPACE_ID\`。

### 步骤 3：创建 Agent 身份

\`\`\`bash
curl -X POST ${API_BASE}/agents \\
  -H "Authorization: Bearer TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"我的助手","approvalMode":"always-review"}'
\`\`\`

保存返回的 \`id\` 作为 \`AGENT_ID\`。

### 步骤 4：授权 Agent 访问 Space

\`\`\`bash
curl -X PUT "${API_BASE}/agents/AGENT_ID/grants/SPACE_ID" \\
  -H "Authorization: Bearer TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"role":"editor","scopes":["pages:read","pages:write","spaces:read","graph:read"]}'
\`\`\`

### 步骤 5：生成 Agent 凭据

⚠️ API Key 只显示一次！

\`\`\`bash
curl -X POST "${API_BASE}/agents/AGENT_ID/credentials" \\
  -H "Authorization: Bearer TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"default-key","scopes":["pages:read","pages:write","spaces:read","graph:read"]}'
\`\`\`

保存返回的 \`apiKey\`（\`agk_\` 开头）作为 \`AGENT_KEY\`。

### 步骤 6：验证连接

\`\`\`bash
curl ${API_BASE}/spaces -H "Authorization: Bearer AGENT_KEY"
\`\`\`

### 步骤 7：创建第一个页面

\`\`\`bash
curl -X POST ${API_BASE}/pages \\
  -H "Authorization: Bearer AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"spaceId":"SPACE_ID","title":"Hello AgentWiki!","content":"# Hello!\\n\\nCreated by my local agent."}'
\`\`\`

### 步骤 8：配置 MCP（推荐）

- MCP 端点: \`${API_BASE}/mcp\`
- 传输方式: Streamable HTTP
- 认证: \`Bearer AGENT_KEY\`
- Accept: \`application/json, text/event-stream\`

---

接入完成后，Agent 可以浏览、搜索、编辑 AgentWiki 内容。访问 ${BASE_URL} 查看。
`;
