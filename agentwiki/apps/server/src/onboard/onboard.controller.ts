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
      replacement: `Use the pinned 0.3.7 onboarding command: ${PUBLIC_COMMAND}`,
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
const PACKAGE_VERSION = '0.3.7';
const PUBLIC_COMMAND = `npx --yes @neomei/agentwiki-local-sync@${PACKAGE_VERSION} onboard --server ${API_BASE} --protocol ndjson`;

const ONBOARD_MD = `# AgentWiki Agent 接入

> v${PACKAGE_VERSION} — 2026-08-10

把下面这一条命令交给你的本地 Agent（Codex、Claude Code、OpenCode 等）：

\`\`\`bash
${PUBLIC_COMMAND}
\`\`\`

Agent 会自动完成网页授权、收集参数、确认计划、安装单一 \`agentwiki\` 网关 MCP、首次本地扫描和知识同步预览确认。你只需要做三个动作：

1. 在浏览器中批准授权
2. 确认接入计划
3. 确认首次知识同步预览

密码和登录信息不会进入 Agent 对话。

---

## 本地与远程执行平面

安装完成后只有一个名为 \`agentwiki\` 的本地 MCP 网关。它确定性地区分：

- \`wiki_*\` — 远程 AgentWiki 工具（页面、图谱、审核、记忆）
- \`local_*\` — 本地工具（扫描源、读取工件）
- \`knowledge_*\` — 组合工作流（扫描→预览→同步→拉取）

Agent 不需要选择 MCP server，网关自动路由。

---

## 其他命令

- \`onboard resume <sessionId>\` — 恢复中断的接入
- \`doctor\` — 检查安装健康状态
- \`uninstall\` — 移除网关 MCP 并恢复配置

---

完整文档：${BASE_URL}
`;
