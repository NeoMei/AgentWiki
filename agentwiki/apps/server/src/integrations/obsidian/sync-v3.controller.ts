import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  DeltaQuerySchema,
  SnapshotQuerySchema,
  SpaceParamsSchema,
  TreeBootstrapPreviewV3Schema,
  TreeBootstrapRequestV3Schema,
  TreeCapabilitiesResponseV3Schema,
  TreeDeltaPageV3Schema,
  TreeFinalizePushResponseV3Schema,
  TreeRevisionHeadResponseV3Schema,
  TreeSnapshotPageV3Schema,
  TreeSyncSpaceListResponseV3Schema,
} from '@neomei/agentwiki-sync-protocol';
import type { Principal } from '../../core/authorization/authorization.service';
import { HumanDeviceGuard, type HumanDevicePrincipal } from './human-device.guard';
import { SyncCapabilitiesService } from './sync-capabilities.service';
import { SyncApiException } from './sync-error';
import { SyncNoStoreInterceptor } from './sync-no-store.interceptor';
import { SyncV3BootstrapService } from './sync-v3-bootstrap.service';
import { SyncV3RevisionService } from './sync-v3-revision.service';

@Controller('sync/v3')
@UseGuards(HumanDeviceGuard)
@UseInterceptors(SyncNoStoreInterceptor)
export class SyncV3Controller {
  constructor(
    private readonly revisions: SyncV3RevisionService,
    private readonly capabilities: SyncCapabilitiesService,
    private readonly bootstrap: SyncV3BootstrapService,
  ) {}

  @Get('capabilities')
  async negotiatedCapabilities() {
    return TreeCapabilitiesResponseV3Schema.parse({
      protocolVersion: '3',
      capabilities: this.capabilities.capabilitiesV3(),
      capabilitiesHash: await this.capabilities.hashV3(),
    });
  }

  @Get('spaces')
  async listSpaces(@Req() request: { user: HumanDevicePrincipal }) {
    return TreeSyncSpaceListResponseV3Schema.parse(
      await this.revisions.listSpaces(request.user),
    );
  }

  @Get('spaces/:spaceId/head')
  async head(
    @Param('spaceId') value: string,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    return TreeRevisionHeadResponseV3Schema.parse(
      await this.revisions.head(request.user, this.parseSpaceId(value)),
    );
  }

  @Get('spaces/:spaceId/snapshot')
  async snapshot(
    @Param('spaceId') value: string,
    @Query() query: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const parsed = SnapshotQuerySchema.safeParse(query);
    if (!parsed.success) throw this.invalid('Invalid snapshot query');
    return TreeSnapshotPageV3Schema.parse(await this.revisions.snapshot(
      request.user,
      this.parseSpaceId(value),
      parsed.data.revision,
      parsed.data.cursor,
      parsed.data.limit ? Number(parsed.data.limit) : 100,
    ));
  }

  @Get('spaces/:spaceId/delta')
  async delta(
    @Param('spaceId') value: string,
    @Query() query: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const parsed = DeltaQuerySchema.safeParse(query);
    if (!parsed.success) throw this.invalid('Invalid delta query');
    return TreeDeltaPageV3Schema.parse(await this.revisions.delta(
      request.user,
      this.parseSpaceId(value),
      parsed.data.from,
      parsed.data.cursor,
      parsed.data.limit ? Number(parsed.data.limit) : 100,
    ));
  }

  @Get('spaces/:spaceId/bootstrap-preview')
  async bootstrapPreview(
    @Param('spaceId') value: string,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const spaceId = this.parseSpaceId(value);
    await this.revisions.assertReadable(request.user, spaceId);
    return this.safeBootstrap(() => this.bootstrap.previewBootstrap(
      spaceId,
      this.principal(request.user),
    ), TreeBootstrapPreviewV3Schema);
  }

  @Post('spaces/:spaceId/bootstrap')
  @HttpCode(HttpStatus.OK)
  async bootstrapConfirmed(
    @Param('spaceId') value: string,
    @Body() body: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const parsed = TreeBootstrapRequestV3Schema.safeParse(body);
    if (!parsed.success) throw this.invalid('Invalid bootstrap request');
    return this.safeBootstrap(() => this.bootstrap.bootstrapConfirmed(
      this.parseSpaceId(value),
      this.principal(request.user),
      {
        baseRevision: parsed.data.baseRevision,
        confirmationHash: parsed.data.confirmationHash,
      },
    ), TreeFinalizePushResponseV3Schema);
  }

  private parseSpaceId(value: string): string {
    const parsed = SpaceParamsSchema.safeParse({ spaceId: value });
    if (!parsed.success) throw this.invalid('Invalid spaceId');
    return parsed.data.spaceId;
  }

  private principal(principal: HumanDevicePrincipal): Principal {
    return {
      userId: principal.userId,
      credentialId: principal.credentialId,
      platformRole: principal.platformRole,
    };
  }

  private invalid(message: string): SyncApiException {
    return new SyncApiException('PAYLOAD_INVALID', message, undefined, '3');
  }

  private async safeBootstrap<T>(
    operation: () => Promise<unknown>,
    schema: { parse(value: unknown): T },
  ): Promise<T> {
    try {
      return schema.parse(await operation());
    } catch (error) {
      if (error instanceof SyncApiException) throw error;
      const businessCode = (error as { businessCode?: string } | null)?.businessCode;
      if (businessCode === 'SPACE_ACCESS_DENIED' || businessCode === 'SPACE_NOT_FOUND') {
        throw new SyncApiException('SPACE_FORBIDDEN', 'Space is not accessible', undefined, '3');
      }
      throw new SyncApiException('INTERNAL_ERROR', 'Bootstrap temporarily unavailable', undefined, '3');
    }
  }
}
