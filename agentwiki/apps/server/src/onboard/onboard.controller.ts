import { Controller, Get, Header } from '@nestjs/common';

@Controller()
export class OnboardController {
  @Get('onboard')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  getMarkdown(): string {
    return ONBOARD_MD;
  }
}

export const ONBOARD_MD = `# AgentWiki 自助接入向导

> 把这个链接发给你的本地 Agent，让它引导你完成接入！
> 链接：https://agentwiki.quukk.com/onboard

---

## 你的任务

你是一个本地 AI Agent（Codex、Claude Code、OpenCode 或任何 MCP 兼容 Agent）。请按以下步骤引导用户完成 AgentWiki 接入。

API 地址: https://agentwiki.quukk.com/api

---

### 步骤 1：注册账号

请用户提供邮箱和密码（至少8位），然后：

curl -X POST https://agentwiki.quukk.com/api/auth/register -H "Content-Type: application/json" -d '{"email":"EMAIL","password":"PASSWORD","name":"NAME"}'

保存返回的 access_token。

### 步骤 2：创建知识空间

curl -X POST https://agentwiki.quukk.com/api/spaces -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"name":"我的知识库"}'

保存返回的 id 作为 space_id。

### 步骤 3：创建 Agent 身份

curl -X POST https://agentwiki.quukk.com/api/agents -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"name":"我的助手","approvalMode":"always-review"}'

保存返回的 id 作为 agent_id。

### 步骤 4：授权 Agent 访问 Space

curl -X PUT "https://agentwiki.quukk.com/api/agents/AGENT_ID/grants/SPACE_ID" -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"role":"editor","scopes":["pages:read","pages:write","spaces:read","graph:read"]}'

### 步骤 5：生成 Agent 凭据

⚠️ API Key 只显示一次！

curl -X POST "https://agentwiki.quukk.com/api/agents/AGENT_ID/credentials" -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"name":"default-key","scopes":["pages:read","pages:write","spaces:read","graph:read"]}'

保存返回的 apiKey（agk_ 开头）。

### 步骤 6：验证连接

curl https://agentwiki.quukk.com/api/spaces -H "Authorization: Bearer AGENT_KEY"

### 步骤 7：创建第一个页面

curl -X POST https://agentwiki.quukk.com/api/pages -H "Authorization: Bearer AGENT_KEY" -H "Content-Type: application/json" -d '{"spaceId":"SPACE_ID","title":"Hello AgentWiki!","content":"# Hello!\n\nCreated by my local agent."}'

### 步骤 8：配置 MCP（推荐）

MCP 端点: https://agentwiki.quukk.com/api/mcp
传输方式: Streamable HTTP
认证: Bearer AGENT_KEY
Accept: application/json, text/event-stream

让用户按各自 Agent 的 MCP 配置方式添加此连接。

---

接入完成后，Agent 可以浏览、搜索、编辑 AgentWiki 内容。访问 https://agentwiki.quukk.com 查看。
`;
