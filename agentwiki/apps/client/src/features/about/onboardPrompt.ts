import { LOCAL_SYNC_PACKAGE_NAME, LOCAL_SYNC_VERSION } from '../../config/localSync';

export type OnboardClient = 'codex' | 'claude' | 'opencode';
export const ONBOARD_CLIENTS = [
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'opencode', label: 'OpenCode' },
] as const;

export function buildOnboardPrompt(zh: boolean, client: OnboardClient, serverUrl: string): string {
  const runner = `npx --yes ${LOCAL_SYNC_PACKAGE_NAME}@${LOCAL_SYNC_VERSION}`;
  const start = `${runner} onboard start --server ${serverUrl} --client ${client} --protocol json`;
  const status = `${runner} onboard status --session <sessionId> --protocol json`;
  const advance = `${runner} onboard continue --session <sessionId> --protocol json`;
  const reply = `${runner} onboard continue --session <sessionId> --reply-file <absolute-json-file> --protocol json`;
  return zh ? `请帮我完成 AgentWiki 接入，并在当前客户端实际读取一篇已知页面来验证。

1. 执行下面的启动命令。每条命令结束后读取一个 JSON 对象，立即保存 sessionId；后续始终使用同一个 sessionId。首次安装依赖可能需要几分钟；工具等待超时先查看原命令结果，不要并行重复启动。
${start}

2. 命令中的 <sessionId> 替换为返回的会话 ID，<absolute-json-file> 替换为实际绝对文件路径；路径作为独立 shell 参数安全引用。只读检查进度使用：
${status}
推进下一阶段使用：
${advance}
每次 continue 只推进一个阶段；configuration_pending 时继续同一会话，直到需要我的输入、确认或浏览器授权。

3. 收到 authorization_required 或 authorization_expired：把 authorizationUrl 给我，让我在浏览器登录并批准。等待 retryAfterMs 后再执行 continue，遵守新的等待时间。过期也保留同一会话和已确认计划，按 nextAction 重新在浏览器授权；不要新建会话或索取密码。

4. 收到 input_required：按 spaces 的名称让我选择已有空间（代填对应 spaceId），或创建空间；再询问 agentName 和 role（reader、editor、publisher，按需要选择最小权限）。基础接入不扫描本地目录，不导入或上传。使用当前 requestId 与 fields，写入绝对路径 JSON 文件；POSIX 权限设为 0600，Windows 限当前用户可读写。通过文件工具写 JSON，不将我的原始输入拼接进 shell。
新空间回复形状：{"requestId":"当前值","values":{"spaceMode":"create","spaceName":"我的空间","agentName":"我的 Agent","role":"reader"}}
已有空间改为 values:{"spaceMode":"existing","spaceId":"所选空间ID","agentName":"我的 Agent","role":"reader"}。
提交文件使用：
${reply}

5. 收到 confirmation_required：完整展示 plan 中的授权账号/服务器、空间、Agent、角色和即将修改的客户端配置路径。只有我明确确认后才写 {"requestId":"当前值","confirmed":true,"planHash":"当前值"}；拒绝使用 confirmed:false。requestId 和 planHash 必须逐字取自当前响应，不得代我确认。文件仍为绝对路径且权限 0600。使用上面的带 --reply-file 命令提交；replyExpiresAt 过期时重新读取当前请求，不能重用旧回复文件。

6. 网络中断或 error.retryable 为 true 时，先 status 检查，再重试同一会话的 continue；保留本地状态、原计划及配置，不重建 Agent/Space，不循环重试不可重试错误。status:error 或 error.retryable:false 时报告 code 与 nextAction，停止依赖步骤。cancelled 表示已取消。

7. completed 只表示配置流程结束。分别报告 connectionStatus、gatewayVerification、clientReloadRequired、knowledgeImport 和 hostVerification。若需要重载，明确告诉我并等待客户端重载；然后必须在当前宿主通过 agentwiki MCP 的 wiki_* 工具读取我有权限的一篇已知页面，核对标题和内容。只有这次实际工具调用成功，才能宣告宿主读取验证通过；仅握手或 tools/list 不算。读取失败如实报告并保留同一会话。

知识导入可以稍后单独开始，使用 knowledge_* 工具预览并取得我的明确确认。不要为验证连接创建伪文档或上传本地资料。`
    : `Connect this client to AgentWiki, then verify it by actually reading a known page in this host.

1. Run the start command below. Each command ends with one JSON object. Save sessionId immediately and use that same sessionId throughout. Initial dependency installation may take minutes; inspect the original command after a tool timeout instead of starting another process in parallel.
${start}

2. Replace <sessionId> with the returned session ID and <absolute-json-file> with the actual absolute file path. Quote paths safely as separate shell arguments. Inspect progress without changing it:
${status}
Advance one phase:
${advance}
Each continue advances at most one phase. For configuration_pending, continue the same session until input, confirmation, or browser authorization is needed.

3. For authorization_required or authorization_expired, give me authorizationUrl to sign in and approve in my browser. Wait retryAfterMs before the next continue and honor updated intervals. Expiry keeps the same session and confirmed plan; follow nextAction for fresh browser approval. Never create another session or ask for my password.

4. For input_required, show spaces by name and fill the chosen spaceId, or let me create a space. Ask for agentName and role (reader, editor, publisher, using the least privilege needed). Basic connection does not scan, import, or upload. Use the current requestId and fields to write an absolute-path JSON file. Set POSIX permissions to 0600; on Windows restrict access to the current user. Write JSON using a file tool rather than embedding my raw text in shell code.
New-space reply: {"requestId":"current value","values":{"spaceMode":"create","spaceName":"My space","agentName":"My Agent","role":"reader"}}
For an existing space use values:{"spaceMode":"existing","spaceId":"selected ID","agentName":"My Agent","role":"reader"}.
Submit the file:
${reply}

5. For confirmation_required, show the complete plan: authorized account/server, space, Agent, role, and client configuration path that will change. Only after my explicit approval write {"requestId":"current value","confirmed":true,"planHash":"current value"}; use confirmed:false if I decline. Copy requestId and planHash exactly from the current response; never approve for me. Keep the absolute file path and 0600 permissions. Submit with --reply-file as above. After replyExpiresAt, read the current request again rather than reusing a stale reply file.

6. After a network interruption or error.retryable:true, inspect status and retry continue for the same session. Preserve local state, the original plan and configuration; do not create another Agent/Space or loop on permanent errors. For status:error or error.retryable:false, report code and nextAction and stop dependent steps. cancelled means cancelled.

7. completed only ends configuration. Report connectionStatus, gatewayVerification, clientReloadRequired, knowledgeImport, and hostVerification separately. If reload is required, tell me and wait for the host to reload. Then use this host's agentwiki MCP wiki_* tools to read a known page I can access and verify its title and contents. Only this actual successful tool call proves host reading works; a handshake or tools/list does not. Report failed reads honestly and preserve the same session.

Knowledge import can start later through knowledge_* tools with a preview and my explicit confirmation. Do not create placeholder documents or upload local files to validate connection.`;
}
