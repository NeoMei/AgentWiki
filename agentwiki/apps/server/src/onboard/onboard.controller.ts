import { Body, Controller, Get, Header, Headers, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import { JwtAuthGuard } from '../core/auth/jwt-auth.guard';
import { BootstrapDto, DeviceDecisionDto, PollDeviceDto, StartDeviceDto } from './onboard.dto';
import { OnboardBootstrapService } from './onboard-bootstrap.service';
import { OnboardDeviceService } from './onboard-device.service';
import { OnboardingTokenGuard, type OnboardingPrincipal } from './onboarding-token.guard';

@Controller()
export class OnboardController {
  constructor(
    private readonly devices: OnboardDeviceService,
    private readonly bootstrapService: OnboardBootstrapService,
  ) {}

  @Post('onboard/bootstrap')
  @UseGuards(OnboardingTokenGuard)
  bootstrap(
    @Body() dto: BootstrapDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ) {
    const onboarding = (req as Request & { onboarding: OnboardingPrincipal }).onboarding;
    return this.bootstrapService.bootstrap(
      onboarding,
      idempotencyKey,
      dto.serverPlan,
      dto.serverPlanHash,
    );
  }

  @Get('onboard/spaces')
  @UseGuards(OnboardingTokenGuard)
  @Header('Cache-Control', 'no-store')
  spaces(@Req() req: Request & {onboarding: OnboardingPrincipal}) {
    return this.bootstrapService.listSpaces(req.onboarding);
  }

  @Post('onboard/device/renew')
  @Header('Cache-Control', 'no-store')
  renewDevice(@Body() dto: PollDeviceDto, @Req() req: Request) {
    return this.devices.renew(dto, this.clientIp(req));
  }

  @Post('onboard/device/start')
  startDevice(@Body() dto: StartDeviceDto, @Req() req: Request) {
    return this.devices.start(dto, this.clientIp(req));
  }

  @Get('onboard/device/session')
  getDeviceSession(@Query('userCode') userCode: string, @Req() req: Request) {
    return this.devices.getPublicSession(userCode, this.clientIp(req));
  }

  @Post('onboard/device/decision')
  @UseGuards(JwtAuthGuard, HumanOnlyGuard)
  decideDevice(@Body() dto: DeviceDecisionDto, @Req() req: Request) {
    const user = req.user as { userId: string };
    return this.devices.decide(
      dto,
      user.userId,
      this.clientIp(req),
      req.headers['user-agent'],
    );
  }

  @Post('onboard/device/poll')
  pollDevice(@Body() dto: PollDeviceDto, @Req() req: Request) {
    return this.devices.poll(dto, this.clientIp(req));
  }

  @Get('onboard')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  getMarkdown(): string {
    return ONBOARD_MD;
  }

  @Get('onboard.json')
  @HttpCode(HttpStatus.GONE)
  getJsonRedirect(): { statusCode: number; error: string; replacement: string } {
    return {
      statusCode: 410,
      error: 'Gone',
      replacement: `Use the pinned ${PACKAGE_VERSION} onboarding command: ${PUBLIC_COMMAND}`,
    };
  }

  private clientIp(req: Request): string {
    const address = String(req.ip || req.socket.remoteAddress || 'unknown').toLowerCase();
    if (address === '::1') return '127.0.0.1';
    return address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  }
}

const BASE_URL = 'https://agentwiki.quukk.com';
const API_BASE = `${BASE_URL}/api`;
const PACKAGE_VERSION = '0.13.4';
const PUBLIC_COMMAND = `npx --yes @neomei/agentwiki-local-sync@${PACKAGE_VERSION} onboard start --server '${API_BASE}' --client generic --protocol json`;
const WORKBUDDY_RUNNER = `npx --cache '<absolute-npm-cache>' --yes @neomei/agentwiki-local-sync@${PACKAGE_VERSION}`;
const WORKBUDDY_CACHE_BOOTSTRAP = `node -e "const fs=require('node:fs'),os=require('node:os'),path=require('node:path');if(![24,26].includes(Number(process.versions.node.split('.')[0])))throw new Error('Use Node.js 24 or 26 in this host');const cache=fs.mkdtempSync(path.join(os.tmpdir(),'agentwiki-npx-'));if(process.platform!=='win32')fs.chmodSync(cache,0o700);console.log(JSON.stringify({node:process.execPath,nodeVersion:process.version,npmCache:cache}));"`;

const ONBOARD_MD = `# AgentWiki Agent 接入 / Connect your Agent

将本页完整交给支持本地 stdio MCP 的 Agent。默认 --client generic 导出通用 MCP 配置，供当前宿主导入；不会替未知宿主写入 Codex 配置。先识别当前宿主：WorkBuddy 必须先完成下面的启动准备并使用 --client workbuddy，其他快捷配置为 --client codex、--client claude、--client opencode。
Give this complete guide to any Agent supporting local stdio MCP. The default --client generic exports MCP configuration for your current host to import; it does not write Codex configuration for unknown hosts. Identify the current host first: WorkBuddy must complete the preparation below and use --client workbuddy; codex, claude and opencode presets are available for those clients.

1. 本机需要 Node.js 24 或 26。完成适用的准备后执行启动命令；环境预检失败时按返回的修复指引处理后再继续。每条接入命令结束后读取一个 JSON 对象并保存 sessionId。后续使用同一会话，不并行重复启动。
Node.js 24 or 26 is required locally. Complete the applicable preparation before the start command; if environment preflight fails, follow its repair instructions before continuing. Read each onboarding command's single JSON response and preserve sessionId. Continue that same session throughout.

WorkBuddy 启动准备：包括选择 generic 但实际宿主是 WorkBuddy 的情况，必须在首次 npx 前完成；其他宿主跳过本准备。先在当前宿主的工具执行环境定位或安装 Node.js 24 或 26 及配套 npm/npx；单独终端的版本不能证明 WorkBuddy 的版本，托管 Node.js 22 不受支持。将下方 node 安全替换为该 Node 的绝对路径，执行后核对返回的 node 与 nodeVersion。
WorkBuddy preparation: this also applies when generic is selected but the actual host is WorkBuddy, and must happen before the first npx invocation. Other hosts skip this preparation. In the current host's tool execution environment, locate or install Node.js 24 or 26 and its accompanying npm/npx. A version in a separate terminal does not establish WorkBuddy's runtime; managed Node.js 22 is unsupported. Safely replace node below with that Node executable's absolute path, execute it, and verify the returned node and nodeVersion.

\`\`\`sh
${WORKBUDDY_CACHE_BOOTSTRAP}
\`\`\`

此命令在系统 os.tmpdir() 下随机创建私有 npm 缓存，POSIX 权限0700，Windows 使用当前用户系统 Temp ACL。持久保存绝对 npmCache 路径、Node/npx 绝对路径及精确包版本。每次调用都在当前宿主将该 Node 所在目录放在子进程 PATH 首位，并把命令开头的 npx 换成同一安装的绝对 npx 路径，防止包的子进程回到托管 Node.js 22；使用参数数组或当前 shell 的安全引用（PowerShell 调用带引号的可执行路径需要 &）。将 <absolute-npm-cache> 替换为保存的 npmCache，所有 start/status/continue/--reply-file 命令都复用下方同一个 runner，--cache 必须在包名之前。
This creates a random private npm cache under the system os.tmpdir(), with POSIX mode 0700 and the current user's system Temp ACL on Windows. Persist the absolute npmCache path, absolute Node/npx paths, and exact package version. For every invocation in this host, prepend that Node directory to the child process PATH and replace the leading npx with the absolute npx from the same installation so package subprocesses cannot fall back to managed Node.js 22. Use an argument array or safe native-shell quoting (PowerShell needs & before a quoted executable path). Replace <absolute-npm-cache> with the saved npmCache. Reuse the following runner for every start/status/continue/--reply-file command; --cache must precede the package name.

\`\`\`sh
${WORKBUDDY_RUNNER}
\`\`\`

缓存只存放可丢弃的 npm 文件；session、回复文件与凭据仍在各自正常持久目录，绝不放进缓存。每次复用（包括长期恢复会话）前确认缓存仍位于系统 os.tmpdir() 下、属于当前用户且是真实目录而非符号链接，POSIX 权限0700，Windows 仍受当前用户 Temp ACL 保护。缓存缺失、被替换或权限变化时，不 chmod、不接管不明旧缓存；按同一规则新建私有缓存、更新保存的路径并重新下载同一精确版本，保留原 sessionId 和会话文件。不要修改 NODE_OPTIONS、关闭安全保护或删除旧 npm 缓存。
The cache holds disposable npm files only. Keep sessions, reply files, and credentials in their normal persistent locations, never inside this cache. Before every reuse, including a later session resume, verify that it is still under the system os.tmpdir() and is a real directory owned by the current user, not a symlink, with POSIX mode 0700 or the current user's Temp ACL on Windows. If it is missing, replaced, or has changed permissions, do not chmod or take over an unknown old cache: create a new private cache by the same rule, update the saved path, and reinstall the same exact version while preserving sessionId and session files. Do not change NODE_OPTIONS, disable security protections, or delete the old npm cache.

WorkBuddy：先按上述规则替换全部路径和执行环境，然后启动 / WorkBuddy: resolve all paths and the execution environment above, then start:
\`\`\`sh
${WORKBUDDY_RUNNER} onboard start --server '${API_BASE}' --client workbuddy --protocol json
\`\`\`

其他宿主 / Other hosts:

\`\`\`sh
${PUBLIC_COMMAND}
\`\`\`

2. 将 <sessionId> 替换为返回的会话 ID；<absolute-json-file> 替换为实际绝对文件路径，并安全引用 shell 参数。
Replace placeholders with the returned session ID or actual absolute file path, quoting shell arguments safely.
WorkBuddy 的后续命令始终将下方 npx --yes 包名替换为步骤1保存的带 --cache runner（同一运行时、缓存、精确包版本）；其余参数保持一致。
For WorkBuddy, always replace npx --yes and the package below with the saved --cache runner from step 1 (same runtime, cache, and exact package version); keep the remaining arguments unchanged.
只读查看本地检查点（不会联系服务器领取浏览器批准结果） / Inspect the saved local checkpoint (does not retrieve browser approval from the server):
\`\`\`sh
npx --yes @neomei/agentwiki-local-sync@${PACKAGE_VERSION} onboard status --session <sessionId> --protocol json
\`\`\`
推进一个阶段 / Advance one phase:
\`\`\`sh
npx --yes @neomei/agentwiki-local-sync@${PACKAGE_VERSION} onboard continue --session <sessionId> --protocol json
\`\`\`

3. authorization_expired：该响应没有授权链接；保留原 sessionId、计划和配置，按 nextAction 执行不带 --reply-file 的 continue 续授权。收到新的 authorization_required 后，脚本会尝试自动打开浏览器；browserOpened 仅表示系统接受打开请求，不表示用户已授权。browserOpened:false 或用户确认页面未出现时，使用当前客户端的浏览器或系统打开能力打开 authorizationUrl，仍不可用再展示可点击链接。用户须在 expiresAt 前登录并批准。CLI onboard status 只读取本地检查点，不会联系服务器；它不会领取浏览器批准结果或重新打开浏览器，不能靠反复 status 等待授权。打开页面不代表已授权，等待 retryAfterMs 后必须执行不带 --reply-file 的 continue，从服务器领取浏览器批准结果并推进；仍为 authorization_required 时按新的 retryAfterMs 再 continue。首次收到 authorization_required 也按此方式处理；不要重复打开同一链接、新建会话或索取密码。
For authorization_expired, the response has no authorization link. Preserve sessionId, the plan, and configuration; follow nextAction by running continue without --reply-file to renew. Only after the new authorization_required response, the script attempts to open the browser. browserOpened means the system accepted opening, not user approval. If browserOpened:false or the user confirms no page appeared, open authorizationUrl using this client's browser or system opener; show a clickable link if opening is unavailable. The user must sign in and approve before expiresAt. CLI onboard status only reads the local checkpoint and does not contact the server; it neither retrieves browser approval nor reopens the browser. Repeated status calls cannot observe approval. An open page is not approval; after retryAfterMs, run continue without --reply-file to retrieve browser approval from the server and advance. If authorization_required remains, wait the updated retryAfterMs and run continue again. Handle an initial authorization_required the same way; never repeatedly open the same link, start another session, or ask for passwords.

4. input_required：按 spaces 的名称让用户选择空间，填入对应 spaceId，或创建空间；询问 agentName 与最小必要 role（reader/editor/publisher）。使用当前 requestId/fields 写绝对路径 JSON 回复文件，POSIX 权限0600，Windows仅当前用户可读写。不要把用户输入拼接到shell中。
Show spaces by name, fill the selected spaceId or create a space, and ask for agentName and the least privilege role. Write the current requestId and values to an absolute JSON file, restricted to its owner (POSIX 0600). Do not interpolate user text into shell commands.

新空间 / New space: {"requestId":"current","values":{"spaceMode":"create","spaceName":"My space","agentName":"My Agent","role":"reader"}}
已有空间 / Existing space: {"requestId":"current","values":{"spaceMode":"existing","spaceId":"selected ID","agentName":"My Agent","role":"reader"}}

5. confirmation_required：向用户展示完整 plan（授权账号/服务器、空间、Agent、角色、配置路径），取得明确确认后写 {"requestId":"current","confirmed":true,"planHash":"current"}；拒绝用 false。精确使用当前 requestId/planHash；replyExpiresAt 过期时，先执行不带 --reply-file 的 continue 获取新请求，不能仅查询 status 或重用旧回复文件。不得代用户批准。
Show the complete plan, including account/server, space, Agent, role and configuration path. Only after explicit approval submit the current requestId, confirmed boolean and exact planHash. After replyExpiresAt, run continue without --reply-file to obtain a fresh request; status alone cannot refresh it and a stale reply file must not be reused. Never approve for the user.

提交回复文件 / Submit the reply file:
\`\`\`sh
npx --yes @neomei/agentwiki-local-sync@${PACKAGE_VERSION} onboard continue --session <sessionId> --reply-file <absolute-json-file> --protocol json
\`\`\`

6. configuration_pending 时继续同一会话。网络中断或 error.retryable:true 时先 status 后重试 continue；不可重试错误报告 code/nextAction。保留原计划和配置，不重复创建 Agent/Space。
For configuration_pending, continue the same session. After interruptions or retryable errors, inspect status and retry continue. Report code/nextAction for permanent errors. Preserve the original plan and configuration; do not recreate resources.

7. completed 只表示配置结束，分别报告 connectionStatus、gatewayVerification、clientReloadRequired、knowledgeImport、hostVerification，并按返回的顶层 configurationMode、configPath、hostActivationSteps 继续。generic 的 manual-import 只导出配置：将 configPath 文件中的 mcpServers.agentwiki 导入当前客户端；若不支持导入 JSON，则按该客户端的格式创建 stdio MCP 服务，原样填写 command 和 args，保留其他设置。无法操作设置时展示导出路径和导入步骤，等待用户完成，不得声称已注册。明确提示客户端授权：在宿主启用 agentwiki 并允许本地 MCP 服务与工具调用，网站账号授权不能替代这一步。重载 MCP；没有重载入口或仍看不到工具时，完全退出并重启客户端，再新建对话，保留同一 sessionId。随后在当前宿主调用 agentwiki MCP 的 onboard_status（空参数）检查 gateway.status、gateway.clientReloadRequired 和 gateway.recovery；顶层字段是历史安装记录，不用于验证当前身份或连接。再用 wiki_list_spaces 确认当前空间权限，并调用 wiki_get_page 读取有权限的一篇已知页面，核对标题和内容。只有这次实际工具调用成功，才能报告宿主读取成功。仅工具列表或握手不算实际读取。
completed only ends configuration. Report connectionStatus, gatewayVerification, clientReloadRequired, knowledgeImport and hostVerification separately, then follow the top-level configurationMode, configPath and hostActivationSteps. For generic manual-import, import mcpServers.agentwiki from configPath into the current host. If JSON import is unavailable, create a stdio MCP service in the host's required format with the exact command and args, preserving other settings. If you cannot operate settings, show the export path and import steps and wait for the user; do not claim registration. Explicitly request client authorization: enable agentwiki and allow local MCP and tool calls; website account approval does not replace this step. Reload MCP; if reload is unavailable or tools remain missing, fully quit and restart the client, then start a new conversation while preserving sessionId. Then call this host's agentwiki MCP onboard_status with empty arguments and inspect gateway.status, gateway.clientReloadRequired, and gateway.recovery. Top-level fields describe historical installation, not the current identity or connection. Use wiki_list_spaces to check current Space access, then wiki_get_page to read a known page the user can access and verify its title and contents. Only this actual successful tool call proves host reading works. A handshake or tools/list is not a successful page read.

基础连接不扫描、不导入、不上传。知识导入可稍后使用 knowledge_* 工具预览并明确确认。不要为验证创建伪文档。
Basic connection does not scan, import or upload. Knowledge import is a later, separately confirmed knowledge_* workflow; do not create placeholder documents for verification.

旧 NDJSON/human 接口继续兼容已有客户端；新接入默认使用以上分步 JSON 命令。
Legacy NDJSON/human interfaces remain compatible with existing clients. New connections use the bounded JSON steps above.

网页指南 / Web guide: ${BASE_URL}/guide/agent-onboard
`;
