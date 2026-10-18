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
const PACKAGE_VERSION = '0.13.2';
const PUBLIC_COMMAND = `npx --yes @neomei/agentwiki-local-sync@${PACKAGE_VERSION} onboard start --server '${API_BASE}' --client generic --protocol json`;

const ONBOARD_MD = `# AgentWiki Agent 接入 / Connect your Agent

将本页完整交给支持本地 stdio MCP 的 Agent。默认 --client generic 导出通用 MCP 配置，供当前宿主导入；不会替未知宿主写入 Codex 配置。使用 WorkBuddy 时可改为 --client workbuddy，其他快捷配置为 --client codex、--client claude、--client opencode。
Give this complete guide to any Agent supporting local stdio MCP. The default --client generic exports MCP configuration for your current host to import; it does not write Codex configuration for unknown hosts. Use --client workbuddy for WorkBuddy, or the codex, claude and opencode presets for those clients.

1. 本机需要 Node.js 24 或 26。执行启动命令；环境预检失败时按返回的修复指引处理后再继续。每条命令结束后读取一个 JSON 对象并保存 sessionId。后续使用同一会话，不并行重复启动。
Node.js 24 or 26 is required locally. Run the start command; if environment preflight fails, follow its repair instructions before continuing. Read the single JSON response and preserve sessionId. Continue that same session throughout.

\`\`\`sh
${PUBLIC_COMMAND}
\`\`\`

2. 将 <sessionId> 替换为返回的会话 ID；<absolute-json-file> 替换为实际绝对文件路径，并安全引用 shell 参数。
Replace placeholders with the returned session ID or actual absolute file path, quoting shell arguments safely.
只读查看进度 / Inspect progress:
\`\`\`sh
npx --yes @neomei/agentwiki-local-sync@${PACKAGE_VERSION} onboard status --session <sessionId> --protocol json
\`\`\`
推进一个阶段 / Advance one phase:
\`\`\`sh
npx --yes @neomei/agentwiki-local-sync@${PACKAGE_VERSION} onboard continue --session <sessionId> --protocol json
\`\`\`

3. authorization_expired：该响应没有授权链接；保留原 sessionId、计划和配置，按 nextAction 执行不带 --reply-file 的 continue 续授权。收到新的 authorization_required 后，脚本会尝试自动打开浏览器；browserOpened 仅表示系统接受打开请求，不表示用户已授权。只有 browserOpened:false 时，使用当前客户端的浏览器或系统打开能力打开 authorizationUrl，仍不可用再展示可点击链接。用户须在 expiresAt 前登录并批准，等待 retryAfterMs 再 continue 检查。首次收到 authorization_required 也按此方式处理。status 只读查询不会重新打开浏览器；不要重复打开同一链接、新建会话或索取密码。
For authorization_expired, the response has no authorization link. Preserve sessionId, the plan, and configuration; follow nextAction by running continue without --reply-file to renew. Only after the new authorization_required response, the script attempts to open the browser. browserOpened means the system accepted opening, not user approval. Only for browserOpened:false, open authorizationUrl using this client's browser or system opener; show a clickable link if opening is unavailable. The user must sign in and approve before expiresAt, then wait retryAfterMs before continuing to check. Handle an initial authorization_required the same way. Read-only status does not reopen the browser; never repeatedly open the same link, start another session, or ask for passwords.

4. input_required：按 spaces 的名称让用户选择空间，填入对应 spaceId，或创建空间；询问 agentName 与最小必要 role（reader/editor/publisher）。使用当前 requestId/fields 写绝对路径 JSON 回复文件，POSIX 权限0600，Windows仅当前用户可读写。不要把用户输入拼接到shell中。
Show spaces by name, fill the selected spaceId or create a space, and ask for agentName and the least privilege role. Write the current requestId and values to an absolute JSON file, restricted to its owner (POSIX 0600). Do not interpolate user text into shell commands.

新空间 / New space: {"requestId":"current","values":{"spaceMode":"create","spaceName":"My space","agentName":"My Agent","role":"reader"}}
已有空间 / Existing space: {"requestId":"current","values":{"spaceMode":"existing","spaceId":"selected ID","agentName":"My Agent","role":"reader"}}

5. confirmation_required：向用户展示完整 plan（授权账号/服务器、空间、Agent、角色、配置路径），取得明确确认后写 {"requestId":"current","confirmed":true,"planHash":"current"}；拒绝用 false。精确使用当前 requestId/planHash；replyExpiresAt 过期需读取新请求。不得代用户批准。
Show the complete plan, including account/server, space, Agent, role and configuration path. Only after explicit approval submit the current requestId, confirmed boolean and exact planHash. Never reuse an expired reply or approve for the user.

提交回复文件 / Submit the reply file:
\`\`\`sh
npx --yes @neomei/agentwiki-local-sync@${PACKAGE_VERSION} onboard continue --session <sessionId> --reply-file <absolute-json-file> --protocol json
\`\`\`

6. configuration_pending 时继续同一会话。网络中断或 error.retryable:true 时先 status 后重试 continue；不可重试错误报告 code/nextAction。保留原计划和配置，不重复创建 Agent/Space。
For configuration_pending, continue the same session. After interruptions or retryable errors, inspect status and retry continue. Report code/nextAction for permanent errors. Preserve the original plan and configuration; do not recreate resources.

7. completed 只表示配置结束，分别报告 connectionStatus、gatewayVerification、clientReloadRequired、knowledgeImport、hostVerification，并按返回的顶层 configurationMode、configPath、hostActivationSteps 继续。generic 的 manual-import 只导出配置：将 configPath 文件中的 mcpServers.agentwiki 导入当前客户端；若不支持导入 JSON，则按该客户端的格式创建 stdio MCP 服务，原样填写 command 和 args，保留其他设置。无法操作设置时展示导出路径和导入步骤，等待用户完成，不得声称已注册。明确提示客户端授权：在宿主启用 agentwiki 并允许本地 MCP 服务与工具调用，网站账号授权不能替代这一步。重载 MCP；没有重载入口或仍看不到工具时，完全退出并重启客户端，再新建对话，保留同一 sessionId。最后必须使用当前宿主的 agentwiki MCP wiki_* 工具实际读取一篇有权限的已知页面，核对标题/内容，才能报告宿主读取成功。仅工具列表或握手不算实际读取。
completed only ends configuration. Report connectionStatus, gatewayVerification, clientReloadRequired, knowledgeImport and hostVerification separately, then follow the top-level configurationMode, configPath and hostActivationSteps. For generic manual-import, import mcpServers.agentwiki from configPath into the current host. If JSON import is unavailable, create a stdio MCP service in the host's required format with the exact command and args, preserving other settings. If you cannot operate settings, show the export path and import steps and wait for the user; do not claim registration. Explicitly request client authorization: enable agentwiki and allow local MCP and tool calls; website account approval does not replace this step. Reload MCP; if reload is unavailable or tools remain missing, fully quit and restart the client, then start a new conversation while preserving sessionId. Finally, actually read an authorized known page through this host's agentwiki MCP wiki_* tools and verify title/content. A handshake or tools/list is not a successful page read.

基础连接不扫描、不导入、不上传。知识导入可稍后使用 knowledge_* 工具预览并明确确认。不要为验证创建伪文档。
Basic connection does not scan, import or upload. Knowledge import is a later, separately confirmed knowledge_* workflow; do not create placeholder documents for verification.

旧 NDJSON/human 接口继续兼容已有客户端；新接入默认使用以上分步 JSON 命令。
Legacy NDJSON/human interfaces remain compatible with existing clients. New connections use the bounded JSON steps above.

网页指南 / Web guide: ${BASE_URL}/guide/agent-onboard
`;
