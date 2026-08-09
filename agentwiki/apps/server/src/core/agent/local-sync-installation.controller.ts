import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  InternalServerErrorException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { HumanOnlyGuard } from '../auth/human-only.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CreateLocalSyncInstallationDto,
  ExchangeLocalSyncInstallationDto,
} from '../dto/local-sync.dto';
import { LocalSyncInstallationService } from './local-sync-installation.service';

@Controller()
export class LocalSyncInstallationController {
  constructor(
    private readonly installations: LocalSyncInstallationService,
    private readonly config: ConfigService,
  ) {}

  @Post('agents/:agentId/local-sync-installations')
  @UseGuards(JwtAuthGuard, HumanOnlyGuard)
  create(
    @Req() req: Request,
    @Param('agentId') agentId: string,
    @Body() dto: CreateLocalSyncInstallationDto,
  ) {
    return this.installations.create(
      (req.user as { userId: string }).userId,
      agentId,
      dto.scopes,
      dto.pluginVersion,
      this.publicApiUrl(req),
    );
  }


  @Post('agents/:agentId/local-sync-installations/self')
  @UseGuards(CombinedAuthGuard)
  createForAgent(
    @Req() req: Request,
    @Param('agentId') agentId: string,
    @Body() dto: CreateLocalSyncInstallationDto,
  ) {
    const principal = req.user as {
      userId: string;
      agentId?: string;
      credentialId?: string;
      scopes?: string[];
    };
    if (principal.agentId && principal.agentId !== agentId) {
      throw new ForbiddenException('Agents can only create install codes for themselves');
    }
    return this.installations.create(
      principal.userId,
      agentId,
      dto.scopes,
      dto.pluginVersion,
      this.publicApiUrl(req),
      principal.agentId ? {
        credentialId: principal.credentialId!,
        scopes: principal.scopes || [],
      } : undefined,
    );
  }

  @Delete('agents/:agentId/local-sync-installations/:installationId')
  @UseGuards(JwtAuthGuard, HumanOnlyGuard)
  revoke(
    @Req() req: Request,
    @Param('agentId') agentId: string,
    @Param('installationId') installationId: string,
  ) {
    return this.installations.revoke(
      (req.user as { userId: string }).userId,
      agentId,
      installationId,
    );
  }

  @Post('integrations/local-sync/exchange')
  exchange(@Req() req: Request, @Body() dto: ExchangeLocalSyncInstallationDto) {
    return this.installations.exchange(dto.code, req.ip || req.socket.remoteAddress || 'unknown');
  }

  private publicApiUrl(req: Request): string {
    const configured = this.config.get<string>('PUBLIC_API_URL');
    if (configured) return this.normalizePublicApiUrl(configured);
    if (this.config.get<string>('NODE_ENV') !== 'development') {
      throw new InternalServerErrorException(
        'PUBLIC_API_URL is required outside development',
      );
    }
    return this.normalizePublicApiUrl(`${req.protocol}://${req.get('host')}/api`);
  }

  private normalizePublicApiUrl(value: string): string {
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error('Unsupported public API URL');
      }
      return value.replace(/\/+$/, '');
    } catch {
      throw new InternalServerErrorException(
        'PUBLIC_API_URL must be an absolute HTTP(S) URL without credentials',
      );
    }
  }
}
