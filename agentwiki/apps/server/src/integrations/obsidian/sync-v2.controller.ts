import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  CreateTreePushSessionRequestV2Schema,
  PushSessionParamsSchema,
  SpaceParamsSchema,
  TreeFinalizePushRequestV2Schema,
  TreeCapabilitiesResponseV2Schema,
  TreePushBatchV2Schema,
  parseBatchIndex,
  parsePageLimit,
} from '@neomei/agentwiki-sync-protocol';
import { PrismaService } from '../../database/prisma.service';
import { HumanDeviceGuard, type HumanDevicePrincipal } from './human-device.guard';
import { PushSessionService } from './push-session.service';
import { SyncApiException } from './sync-error';
import { SyncNoStoreInterceptor } from './sync-no-store.interceptor';
import { SyncV2RevisionService } from './sync-v2-revision.service';
import { SyncCapabilitiesService } from './sync-capabilities.service';

@Controller('sync/v2')
@UseGuards(HumanDeviceGuard)
@UseInterceptors(SyncNoStoreInterceptor)
export class SyncV2Controller {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revisions: SyncV2RevisionService,
    private readonly pushSessions: PushSessionService,
    private readonly capabilities: SyncCapabilitiesService,
  ) {}

  @Get('capabilities')
  async negotiatedCapabilities() {
    return TreeCapabilitiesResponseV2Schema.parse({
      protocolVersion: '2' as const,
      capabilities: this.capabilities.capabilitiesV2(),
      capabilitiesHash: await this.capabilities.hashV2(),
    });
  }

  @Get('spaces')
  async listSpaces(@Req() request: { user: HumanDevicePrincipal }) {
    const accessible = request.user.platformRole === 'super_admin'
      ? await this.prisma.space.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' } })
      : (await this.prisma.spaceMember.findMany({
        where: { userId: request.user.userId, space: { deletedAt: null } },
        include: { space: true }, orderBy: { createdAt: 'asc' },
      })).map((membership: any) => ({ ...membership.space, role: membership.role }));
    return {
      protocolVersion: '2',
      spaces: await Promise.all(accessible.map(async (space: any) => {
        const head = await this.revisions.head(space.id);
        const role = request.user.platformRole === 'super_admin' ? 'owner' : space.role;
        return {
          spaceId: space.id, displayName: space.name, role, canRead: true,
          canPublish: ['editor', 'owner'].includes(role),
          currentRevision: head.revision, folderCount: head.folderCount, pageCount: head.pageCount,
          revisionManifestByteLength: head.revisionManifestByteLength,
          revisionBodyBytes: head.revisionBodyBytes,
        };
      })),
    };
  }

  @Get('spaces/:spaceId/head')
  async head(@Param('spaceId') value: string, @Req() request: { user: HumanDevicePrincipal }) {
    const spaceId = this.parseSpaceId(value);
    await this.assertReadable(request.user, spaceId);
    return this.revisions.head(spaceId);
  }

  @Get('spaces/:spaceId/snapshot')
  async snapshot(
    @Param('spaceId') value: string,
    @Query('revision') revision: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limitValue: string | undefined,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const spaceId = this.parseSpaceId(value);
    await this.assertReadable(request.user, spaceId);
    return this.revisions.snapshot(spaceId, revision ?? 'current', cursor, this.parseLimit(limitValue));
  }

  @Get('spaces/:spaceId/delta')
  async delta(
    @Param('spaceId') value: string,
    @Query('from') from: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limitValue: string | undefined,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const spaceId = this.parseSpaceId(value);
    await this.assertReadable(request.user, spaceId);
    if (!from) throw this.invalid('Missing from query parameter');
    return this.revisions.delta(spaceId, from, cursor, this.parseLimit(limitValue));
  }

  @Post('spaces/:spaceId/push-sessions')
  @HttpCode(HttpStatus.CREATED)
  async createPushSession(
    @Param('spaceId') value: string,
    @Body() body: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const spaceId = this.parseSpaceId(value);
    const parsed = CreateTreePushSessionRequestV2Schema.safeParse(body);
    if (!parsed.success) throw this.invalid('Invalid create push session request');
    return this.pushSessions.createV2(request.user, spaceId, parsed.data);
  }

  @Put('spaces/:spaceId/push-sessions/:sessionId/batches/:batchIndex')
  async uploadBatch(
    @Param('spaceId') spaceValue: string,
    @Param('sessionId') sessionValue: string,
    @Param('batchIndex') batchValue: string,
    @Body() body: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const { spaceId, sessionId } = this.parseSession(spaceValue, sessionValue);
    let batchIndex: number;
    try { batchIndex = parseBatchIndex(batchValue); } catch { throw this.invalid('Invalid batch index'); }
    const parsed = TreePushBatchV2Schema.safeParse(body);
    if (!parsed.success || parsed.data.batchIndex !== batchIndex) throw this.invalid('Invalid batch payload');
    return this.pushSessions.uploadV2(request.user, spaceId, sessionId, parsed.data);
  }

  @Post('spaces/:spaceId/push-sessions/:sessionId/finalize')
  async finalize(
    @Param('spaceId') spaceValue: string,
    @Param('sessionId') sessionValue: string,
    @Body() body: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const { spaceId, sessionId } = this.parseSession(spaceValue, sessionValue);
    const parsed = TreeFinalizePushRequestV2Schema.safeParse(body);
    if (!parsed.success) throw this.invalid('Invalid finalize request');
    return this.pushSessions.finalizeV2(request.user, spaceId, sessionId, parsed.data);
  }

  @Get('spaces/:spaceId/push-sessions/:sessionId')
  async getSession(
    @Param('spaceId') spaceValue: string,
    @Param('sessionId') sessionValue: string,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const { spaceId, sessionId } = this.parseSession(spaceValue, sessionValue);
    return this.pushSessions.getV2(request.user, spaceId, sessionId);
  }

  @Delete('spaces/:spaceId/push-sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async abortSession(
    @Param('spaceId') spaceValue: string,
    @Param('sessionId') sessionValue: string,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const { spaceId, sessionId } = this.parseSession(spaceValue, sessionValue);
    await this.pushSessions.abortV2(request.user, spaceId, sessionId);
  }

  private parseSpaceId(value: string): string {
    const parsed = SpaceParamsSchema.safeParse({ spaceId: value });
    if (!parsed.success) throw this.invalid('Invalid spaceId');
    return parsed.data.spaceId;
  }

  private parseSession(spaceId: string, sessionId: string) {
    const parsed = PushSessionParamsSchema.safeParse({ spaceId, sessionId });
    if (!parsed.success) throw this.invalid('Invalid push session path parameters');
    return parsed.data;
  }

  private parseLimit(value?: string): number {
    try { return value ? parsePageLimit(value) : 100; } catch { throw this.invalid('Invalid limit'); }
  }

  private invalid(message: string): SyncApiException {
    return new SyncApiException('PAYLOAD_INVALID', message, undefined, '2');
  }

  private async assertReadable(principal: HumanDevicePrincipal, spaceId: string) {
    const space = await this.prisma.space.findUnique({ where: { id: spaceId }, select: { deletedAt: true } });
    if (!space || space.deletedAt) throw new SyncApiException('SPACE_FORBIDDEN', 'Space is not accessible', undefined, '2');
    if (principal.platformRole === 'super_admin') return;
    const member = await this.prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId: principal.userId, spaceId } },
    });
    if (!member) throw new SyncApiException('SPACE_FORBIDDEN', 'Space is not accessible', undefined, '2');
  }
}
