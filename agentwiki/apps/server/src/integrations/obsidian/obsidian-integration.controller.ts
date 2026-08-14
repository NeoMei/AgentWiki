import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CombinedAuthGuard } from '../../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../../core/auth/human-only.guard';
import { CurrentPrincipal } from '../../core/auth/current-principal.decorator';
import {
  ActivateCurrentObsidianCredentialRequestSchema,
  ExchangeObsidianCredentialRequestSchema,
  type ExchangeObsidianCredentialRequest,
} from '@neomei/agentwiki-sync-protocol';
import { HumanDeviceGuard, type HumanDevicePrincipal } from './human-device.guard';
import { ObsidianIntegrationService } from './obsidian-integration.service';
import { SyncApiException } from './sync-error';

interface HumanPrincipal {
  userId: string;
  type?: string;
  agentId?: string;
}

function parseExchange(body: unknown): ExchangeObsidianCredentialRequest {
  const result = ExchangeObsidianCredentialRequestSchema.safeParse(body);
  if (!result.success) {
    throw new SyncApiException('PAYLOAD_INVALID', 'Invalid exchange request');
  }
  return result.data as ExchangeObsidianCredentialRequest;
}

@Controller('integrations/obsidian')
export class ObsidianIntegrationController {
  constructor(private readonly service: ObsidianIntegrationService) {}

  @Post('installations')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CombinedAuthGuard, HumanOnlyGuard)
  async createInstallation(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Ip() ip: string,
  ) {
    return this.service.createInstallation(principal.userId, ip);
  }

  @Delete('installations/:installationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(CombinedAuthGuard, HumanOnlyGuard)
  async revokeInstallation(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Param('installationId') installationId: string,
  ) {
    await this.service.revokeInstallation(principal.userId, installationId);
  }

  @Post('exchange')
  @HttpCode(HttpStatus.CREATED)
  async exchange(@Body() body: unknown, @Ip() ip: string) {
    return this.service.exchange(parseExchange(body), ip);
  }

  @Get('session')
  @UseGuards(HumanDeviceGuard)
  async session(@Req() request: { user: HumanDevicePrincipal }) {
    return this.service.getSession(request.user);
  }

  @Post('credentials/current/activate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(HumanDeviceGuard)
  async activate(
    @Body() body: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const result = ActivateCurrentObsidianCredentialRequestSchema.safeParse(body);
    if (!result.success) {
      throw new SyncApiException('PAYLOAD_INVALID', 'Invalid activate request');
    }
    return this.service.activate(request.user, result.data.credentialId);
  }

  @Delete('credentials/current')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(HumanDeviceGuard)
  async revokeCurrent(@Req() request: { user: HumanDevicePrincipal }) {
    await this.service.revokeCurrent(request.user);
  }

  @Get('credentials')
  @UseGuards(CombinedAuthGuard, HumanOnlyGuard)
  async listCredentials(@CurrentPrincipal() principal: HumanPrincipal) {
    const credentials = await this.service.listCredentials(principal.userId);
    return { protocolVersion: '1', credentials };
  }

  @Delete('credentials/:credentialId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(CombinedAuthGuard, HumanOnlyGuard)
  async revokeCredential(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Param('credentialId') credentialId: string,
  ) {
    await this.service.revokeCredential(principal.userId, credentialId);
  }
}
