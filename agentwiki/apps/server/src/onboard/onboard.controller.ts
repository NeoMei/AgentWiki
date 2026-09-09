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
const PACKAGE_VERSION = '0.10.0';
const PUBLIC_COMMAND = `npx --yes @neomei/agentwiki-local-sync@${PACKAGE_VERSION} onboard start --server ${API_BASE} --client codex --protocol json`;

const ONBOARD_MD = `# AgentWiki Agent 接入 / Connect your Agent

将本页完整交给你的本地 Agent。默认使用 Codex；如果使用 Claude Code 或 OpenCode，把启动命令中的客户端分别改为 claude 或 opencode。
Give this complete guide to your local Agent. Change the start command client to claude or opencode when using Claude Code or OpenCode.

1. 执行启动命令，每条命令结束后读取一个 JSON 对象并保存 sessionId。后续使用同一会话，不并行重复启动。
Run the start command, read its single JSON response, and preserve sessionId. Continue that same session throughout.

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

3. authorization_expired：该响应没有授权链接；保留原 sessionId、计划和配置，按 nextAction 执行不带 --reply-file 的 continue 续授权。收到新的 authorization_required 后，才把其中的 authorizationUrl 给用户，在 expiresAt 前登录浏览器并批准，等待 retryAfterMs 再 continue。首次收到 authorization_required 也按此方式处理。不要新建会话或索取密码。
For authorization_expired, the response has no authorization link. Preserve sessionId, the plan, and configuration; follow nextAction by running continue without --reply-file to renew. Only after the new authorization_required response, give the user its authorizationUrl to approve before expiresAt, then wait retryAfterMs before continuing. Handle an initial authorization_required the same way. Never start another session or ask for passwords.

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

7. completed 只表示配置结束，分别报告 connectionStatus、gatewayVerification、clientReloadRequired、knowledgeImport、hostVerification。按需重载客户端后，必须使用当前宿主的 agentwiki MCP wiki_* 工具实际读取一篇已知页面，核对标题/内容，才能报告宿主读取成功。仅工具列表或握手不算实际读取。
Report configuration and gateway checks separately. Reload the client if needed, then actually read a known page through this host's agentwiki MCP wiki_* tools and verify title/content. A handshake or tools/list is not a successful page read.

基础连接不扫描、不导入、不上传。知识导入可稍后使用 knowledge_* 工具预览并明确确认。不要为验证创建伪文档。
Basic connection does not scan, import or upload. Knowledge import is a later, separately confirmed knowledge_* workflow; do not create placeholder documents for verification.

旧 NDJSON/human 接口继续兼容已有客户端；新接入默认使用以上分步 JSON 命令。
Legacy NDJSON/human interfaces remain compatible with existing clients. New connections use the bounded JSON steps above.

网页指南 / Web guide: ${BASE_URL}/guide/agent-onboard
`;
