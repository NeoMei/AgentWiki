import { LOCAL_SYNC_PACKAGE_NAME, LOCAL_SYNC_VERSION } from '../../config/localSync';

export type OnboardClient = 'generic' | 'codex' | 'claude' | 'opencode' | 'workbuddy';
export const ONBOARD_CLIENTS = [
  { id: 'generic', label: 'Generic MCP (recommended)', labelZh: '通用 MCP（推荐）' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'workbuddy', label: 'WorkBuddy' },
] as const;

export function buildOnboardPrompt(zh: boolean, client: OnboardClient, serverUrl: string): string {
  const runner = `npx --yes ${LOCAL_SYNC_PACKAGE_NAME}@${LOCAL_SYNC_VERSION}`;
  const serverArgument = `'${serverUrl.replace(/'/g, "'\\''")}'`;
  const start = `${runner} onboard start --server ${serverArgument} --client ${client} --protocol json`;
  const status = `${runner} onboard status --session <sessionId> --protocol json`;
  const advance = `${runner} onboard continue --session <sessionId> --protocol json`;
  const reply = `${runner} onboard continue --session <sessionId> --reply-file <absolute-json-file> --protocol json`;
  return zh ? `请帮我完成 AgentWiki 接入，并在当前客户端实际读取一篇已知页面来验证。

1. 当前客户端需支持本地 stdio MCP；本机需要 Node.js 24 或 26。每条命令结束后读取一个 JSON 对象，立即保存 sessionId；后续始终使用同一个 sessionId。先执行下面的启动命令；环境预检失败时，按返回的修复指引处理后再继续。首次安装依赖可能需要几分钟；工具等待超时先查看原命令结果，不要并行重复启动。
${start}

2. 命令中的 <sessionId> 替换为返回的会话 ID，<absolute-json-file> 替换为实际绝对文件路径；路径作为独立 shell 参数安全引用。只读查看本地保存的检查点使用（不会联系服务器领取浏览器批准结果）：
${status}
推进下一阶段使用：
${advance}
每次 continue 只推进一个阶段；configuration_pending 时继续同一会话，直到需要我的输入、确认或浏览器授权。

3. 收到 authorization_expired：该响应没有授权链接；保留同一 sessionId、计划和配置，按 nextAction 执行不带 --reply-file 的 continue 续授权。收到新的 authorization_required 后，脚本会尝试自动打开浏览器，让我在 expiresAt 前登录并批准。检查 browserOpened（仅表示已交给系统打开，不等于用户已批准）；browserOpened:false 或用户确认页面未出现时，使用当前客户端的浏览器或系统打开能力打开 authorizationUrl，仍不可用再给我可点击的链接作为回退。CLI onboard status 只读取本地检查点，不会联系服务器；它不会领取浏览器批准结果或重新打开浏览器，不能靠反复 status 等待授权。打开页面不代表已授权，等待 retryAfterMs 后必须执行不带 --reply-file 的 continue，从服务器领取浏览器批准结果并推进；仍为 authorization_required 时按新的 retryAfterMs 再 continue。首次收到 authorization_required 也按此方式处理，遵守新的等待时间；不要重复打开同一链接、新建会话或索取密码。

4. 收到 input_required：按 spaces 的名称让我选择已有空间（代填对应 spaceId），或创建空间；再询问 agentName 和 role（reader、editor、publisher，按需要选择最小权限）。基础接入不扫描本地目录，不导入或上传。使用当前 requestId 与 fields，写入绝对路径 JSON 文件；POSIX 权限设为 0600，Windows 限当前用户可读写。通过文件工具写 JSON，不将我的原始输入拼接进 shell。
新空间回复形状：{"requestId":"当前值","values":{"spaceMode":"create","spaceName":"我的空间","agentName":"我的 Agent","role":"reader"}}
已有空间改为 values:{"spaceMode":"existing","spaceId":"所选空间ID","agentName":"我的 Agent","role":"reader"}。
提交文件使用：
${reply}

5. 收到 confirmation_required：完整展示 plan 中的授权账号/服务器、空间、Agent、角色和即将修改的客户端配置路径。只有我明确确认后才写 {"requestId":"当前值","confirmed":true,"planHash":"当前值"}；拒绝使用 confirmed:false。requestId 和 planHash 必须逐字取自当前响应，不得代我确认。文件仍为绝对路径且权限 0600。使用上面的带 --reply-file 命令提交；replyExpiresAt 过期时，先执行不带 --reply-file 的 continue 获取新请求，不能仅查询 status 或重用旧回复文件。

6. 网络中断或 error.retryable 为 true 时，先 status 检查，再重试同一会话的 continue；保留本地状态、原计划及配置，不重建 Agent/Space，不循环重试不可重试错误。status:error 或 error.retryable:false 时报告 code 与 nextAction，停止依赖步骤。cancelled 表示已取消。

7. completed 只表示配置流程结束。分别报告 connectionStatus、gatewayVerification、clientReloadRequired、knowledgeImport 和 hostVerification，并按响应中的 configurationMode、configPath 与 hostActivationSteps 继续。generic 的 manual-import 只导出标准 stdio MCP 配置：将其中 agentwiki 的 command 和 args 导入当前客户端的 MCP 设置，按该客户端要求适配外层格式，保留已有配置；未知宿主不得改写 Codex 或其他客户端的配置。无法操作设置时展示导出文件位置和当前客户端的导入步骤，等我完成，不得声称已注册。明确提醒我在客户端允许 MCP 和工具调用；这与浏览器里的账号授权是两步。配置后需要重载或重启客户端并新建对话时，说明操作并等待完成，保留同一 sessionId；随后在当前宿主调用 agentwiki MCP 的 onboard_status（空参数）检查 gateway.status、gateway.clientReloadRequired 和 gateway.recovery；顶层字段是历史安装记录，不用于验证当前身份或连接。再用 wiki_list_spaces 确认当前空间权限，并调用 wiki_get_page 读取我有权限的一篇已知页面，核对标题和内容。只有这次实际工具调用成功，才能宣告宿主读取验证通过；仅握手或 tools/list 不算。读取失败如实报告并保留同一会话。

知识导入可以稍后单独开始，使用 knowledge_* 工具预览并取得我的明确确认。不要为验证连接创建伪文档或上传本地资料。`
    : `Connect this client to AgentWiki, then verify it by actually reading a known page in this host.

1. This client needs local stdio MCP support and Node.js 24 or 26. Each command ends with one JSON object. Save sessionId immediately and use that same sessionId throughout. Run the start command below; if environment preflight fails, follow its repair instructions before continuing. Initial dependency installation may take minutes; inspect the original command after a tool timeout instead of starting another process in parallel.
${start}

2. Replace <sessionId> with the returned session ID and <absolute-json-file> with the actual absolute file path. Quote paths safely as separate shell arguments. Inspect the saved local checkpoint without changing it (this does not retrieve browser approval from the server):
${status}
Advance one phase:
${advance}
Each continue advances at most one phase. For configuration_pending, continue the same session until input, confirmation, or browser authorization is needed.

3. For authorization_expired, the response has no authorization link. Preserve sessionId, the plan, and configuration; follow nextAction by running continue without --reply-file to renew. Only after the new authorization_required response, the script automatically opens the browser when possible so I can sign in and approve before expiresAt. Check browserOpened (the system accepted opening, not user approval); if browserOpened:false or the user confirms no page appeared, use this client's browser or system opener with authorizationUrl, then provide a clickable link only as a fallback if opening is unavailable. CLI onboard status only reads the local checkpoint and does not contact the server; it neither retrieves browser approval nor reopens the browser. Repeated status calls cannot observe approval. An open page is not approval; after retryAfterMs, run continue without --reply-file to retrieve browser approval from the server and advance. If authorization_required remains, wait the updated retryAfterMs and run continue again. Handle an initial authorization_required the same way and honor updated intervals. Never repeatedly open the same link, create another session, or ask for my password.

4. For input_required, show spaces by name and fill the chosen spaceId, or let me create a space. Ask for agentName and role (reader, editor, publisher, using the least privilege needed). Basic connection does not scan, import, or upload. Use the current requestId and fields to write an absolute-path JSON file. Set POSIX permissions to 0600; on Windows restrict access to the current user. Write JSON using a file tool rather than embedding my raw text in shell code.
New-space reply: {"requestId":"current value","values":{"spaceMode":"create","spaceName":"My space","agentName":"My Agent","role":"reader"}}
For an existing space use values:{"spaceMode":"existing","spaceId":"selected ID","agentName":"My Agent","role":"reader"}.
Submit the file:
${reply}

5. For confirmation_required, show the complete plan: authorized account/server, space, Agent, role, and client configuration path that will change. Only after my explicit approval write {"requestId":"current value","confirmed":true,"planHash":"current value"}; use confirmed:false if I decline. Copy requestId and planHash exactly from the current response; never approve for me. Keep the absolute file path and 0600 permissions. Submit with --reply-file as above. After replyExpiresAt, run continue without --reply-file to obtain a fresh request; status alone cannot refresh it and a stale reply file must not be reused.

6. After a network interruption or error.retryable:true, inspect status and retry continue for the same session. Preserve local state, the original plan and configuration; do not create another Agent/Space or loop on permanent errors. For status:error or error.retryable:false, report code and nextAction and stop dependent steps. cancelled means cancelled.

7. completed only ends configuration. Report connectionStatus, gatewayVerification, clientReloadRequired, knowledgeImport, and hostVerification separately, then follow configurationMode, configPath, and hostActivationSteps in the response. For generic, manual-import only exports standard stdio MCP configuration: import the agentwiki command and args into this client's MCP settings, adapting the outer format as required by the client and preserving existing configuration. Never write Codex or another client's configuration for an unknown host. If you cannot operate settings, show the export path and this client's import steps and wait for me; do not claim the host is registered. Explicitly remind me to allow MCP and tool calls in this client; that is separate from browser account authorization. If activation needs it, explain how to reload or restart the client and start a new conversation, then wait while preserving sessionId. Then call this host's agentwiki MCP onboard_status with empty arguments and inspect gateway.status, gateway.clientReloadRequired, and gateway.recovery. Top-level fields describe historical installation, not the current identity or connection. Use wiki_list_spaces to check current Space access, then wiki_get_page to read a known page I can access and verify its title and contents. Only this actual successful tool call proves host reading works; a handshake or tools/list does not. Report failed reads honestly and preserve the same session.

Knowledge import can start later through knowledge_* tools with a preview and my explicit confirmation. Do not create placeholder documents or upload local files to validate connection.`;
}
