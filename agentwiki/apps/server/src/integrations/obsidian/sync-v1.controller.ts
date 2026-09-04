import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  CreatePushSessionRequestSchema,
  FinalizePushRequestSchema,
  parseBatchIndex,
  parsePageLimit,
  PushBatchParamsSchema,
  PushBatchSchema,
  PushSessionParamsSchema,
  SpaceParamsSchema,
} from '@neomei/agentwiki-sync-protocol';
import { PrismaService } from '../../database/prisma.service';
import { HumanDeviceGuard, type HumanDevicePrincipal } from './human-device.guard';
import { SyncNoStoreInterceptor } from './sync-no-store.interceptor';
import { SyncApiException } from './sync-error';
import { SyncRevisionService } from './sync-revision.service';
import { SyncCursorService } from './sync-cursor.service';
import { SyncCapabilitiesService } from './sync-capabilities.service';
import { PushSessionService } from './push-session.service';

@Controller('sync/v1')
@UseGuards(HumanDeviceGuard)
@UseInterceptors(SyncNoStoreInterceptor)
export class SyncV1Controller {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revisions: SyncRevisionService,
    private readonly cursors: SyncCursorService,
    private readonly capabilities: SyncCapabilitiesService,
    private readonly pushSessions: PushSessionService,
  ) {}

  @Get('spaces')
  async listSpaces(@Req() request: { user: HumanDevicePrincipal }) {
    if (request.user.platformRole === 'super_admin') {
      const allSpaces = await this.prisma.space.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      const spaces = await Promise.all(allSpaces.map(async (space) => {
        await this.capabilities.assertV1Compatible(space.id);
        const head = await this.revisions.head(space.id);
        return {
          spaceId: space.id,
          displayName: space.name,
          role: 'owner' as const,
          canRead: true,
          canPublish: true,
          currentRevision: head.revision,
          pageCount: head.pageCount.toString(),
          revisionManifestByteLength: head.revisionManifestByteLength.toString(),
          revisionBodyBytes: head.revisionBodyBytes.toString(),
        };
      }));
      return { protocolVersion: '1', spaces };
    }

    const memberships = await this.prisma.spaceMember.findMany({
      where: { userId: request.user.userId, space: { deletedAt: null } },
      include: { space: true },
      orderBy: { createdAt: 'asc' },
    });
    const spaces = await Promise.all(memberships.map(async (membership) => {
      await this.capabilities.assertV1Compatible(membership.spaceId);
      const head = await this.revisions.head(membership.spaceId);
      return {
        spaceId: membership.spaceId,
        displayName: membership.space.name,
        role: membership.role,
        canRead: true,
        canPublish: ['editor', 'admin', 'owner'].includes(membership.role),
        currentRevision: head.revision,
        pageCount: head.pageCount.toString(),
        revisionManifestByteLength: head.revisionManifestByteLength.toString(),
        revisionBodyBytes: head.revisionBodyBytes.toString(),
      };
    }));
    return { protocolVersion: '1', spaces };
  }

  @Get('spaces/:spaceId/head')
  async head(@Param('spaceId') spaceIdParam: string, @Req() request: { user: HumanDevicePrincipal }) {
    const spaceId = this.parseSpaceId(spaceIdParam);
    await this.assertReadable(request.user, spaceId);
    await this.capabilities.assertV1Compatible(spaceId);
    const head = await this.revisions.head(spaceId);
    return {
      protocolVersion: '1',
      spaceId,
      revision: head.revision,
      sequence: head.sequence,
      revisionContentHash: head.revisionContentHash,
      pageCount: head.pageCount.toString(),
      revisionManifestByteLength: head.revisionManifestByteLength.toString(),
      revisionBodyBytes: head.revisionBodyBytes.toString(),
      publishedAt: head.publishedAt,
    };
  }

  @Get('spaces/:spaceId/snapshot')
  async snapshot(
    @Param('spaceId') spaceIdParam: string,
    @Query('revision') revisionQuery: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limitQuery: string | undefined,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const spaceId = this.parseSpaceId(spaceIdParam);
    await this.assertReadable(request.user, spaceId);
    let limit: number;
    try {
      limit = limitQuery ? parsePageLimit(limitQuery) : 100;
    } catch {
      throw new SyncApiException('PAYLOAD_INVALID', 'Invalid limit');
    }
    let revision: string;
    let afterPageId: string | undefined;
    if (cursor) {
      const payload = this.cursors.decode(cursor);
      if (payload.kind !== 'snapshot' || payload.spaceId !== spaceId) {
        throw new SyncApiException('CURSOR_INVALID', 'Cursor does not match this route');
      }
      revision = payload.revision;
      afterPageId = payload.lastPageId;
    } else {
      const revisionRef = revisionQuery ?? 'current';
      if (revisionRef === 'current') await this.capabilities.assertV1Compatible(spaceId);
      revision = await this.revisions.resolveRevision(spaceId, revisionRef);
    }
    const page = await this.revisions.snapshotPage(spaceId, revision, limit, afterPageId);
    const nextCursor = page.nextPageId
      ? this.cursors.encode({ kind: 'snapshot', spaceId, revision, lastPageId: page.nextPageId })
      : null;
    return {
      protocolVersion: '1',
      spaceId,
      revision,
      sequence: page.head.sequence,
      revisionContentHash: page.head.revisionContentHash,
      pageCount: page.head.pageCount.toString(),
      revisionManifestByteLength: page.head.revisionManifestByteLength.toString(),
      revisionBodyBytes: page.head.revisionBodyBytes.toString(),
      items: (page.items ?? []).map((row) => ({
        pageId: row.pageId,
        path: row.path,
        title: row.title,
        body: row.content.body,
        contentHash: row.contentHash,
        updatedAt: row.updatedAt.toISOString(),
      })),
      nextCursor,
    };
  }

  @Get('spaces/:spaceId/delta')
  async delta(
    @Param('spaceId') spaceIdParam: string,
    @Query('from') fromQuery: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limitQuery: string | undefined,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const spaceId = this.parseSpaceId(spaceIdParam);
    await this.assertReadable(request.user, spaceId);
    if (!fromQuery) {
      throw new SyncApiException('PAYLOAD_INVALID', 'Missing from query parameter');
    }
    let limit: number;
    try {
      limit = limitQuery ? parsePageLimit(limitQuery) : 100;
    } catch {
      throw new SyncApiException('PAYLOAD_INVALID', 'Invalid limit');
    }
    const from = fromQuery;
    let afterPageId: string | undefined;
    let toRevision: string | undefined;
    if (cursor) {
      const payload = this.cursors.decode(cursor);
      if (
        payload.kind !== 'delta'
        || payload.spaceId !== spaceId
        || payload.fromRevision !== fromQuery
        || typeof payload.revision !== 'string'
        || payload.revision.length === 0
      ) {
        throw new SyncApiException('CURSOR_INVALID', 'Cursor does not match this route');
      }
      afterPageId = payload.lastPageId;
      toRevision = payload.revision;
    } else {
      await this.capabilities.assertV1Compatible(spaceId);
    }
    const page = await this.revisions.deltaPage(spaceId, from, limit, afterPageId, toRevision);
    const deltaRows = page.items ?? [];
    const items = [];
    let totalBytes = 0;
    let lastPageId = page.nextPageId;
    const maxResponseBytes = this.capabilities.capabilities().maxResponseBytes;
    for (const row of deltaRows) {
      let item;
      if (row.operation === 'archive') {
        item = { operation: 'archive' as const, pageId: row.pageId, previousPath: row.previousPath };
      } else {
        const pageRow = await this.prisma.syncRevisionPageRow.findUnique({
          where: { revisionId_pageId: { revisionId: page.toRevision, pageId: row.pageId } },
          include: { content: true },
        });
        if (!pageRow) {
          item = { operation: 'archive' as const, pageId: row.pageId, previousPath: '' };
        } else {
          item = {
            operation: 'upsert' as const,
            page: {
              pageId: pageRow.pageId,
              path: pageRow.path,
              title: pageRow.title,
              body: pageRow.content.body,
              contentHash: pageRow.contentHash,
              updatedAt: pageRow.updatedAt.toISOString(),
            },
          };
        }
      }
      const itemPageId = item.operation === 'upsert' ? item.page.pageId : item.pageId;
      const estimate = item.operation === 'upsert'
        ? new TextEncoder().encode(item.page.body).byteLength
          + new TextEncoder().encode(item.page.title).byteLength
          + new TextEncoder().encode(item.page.contentHash).byteLength
          + new TextEncoder().encode(itemPageId).byteLength
          + 128
        : new TextEncoder().encode(itemPageId).byteLength + 64;
      if (items.length > 0 && totalBytes + estimate > maxResponseBytes) {
        const lastIncluded = items[items.length - 1];
        lastPageId = lastIncluded.operation === 'upsert'
          ? lastIncluded.page.pageId
          : lastIncluded.pageId;
        break;
      }
      items.push(item);
      totalBytes += estimate;
    }
    const nextCursor = lastPageId
      ? this.cursors.encode({ kind: 'delta', spaceId, revision: page.toRevision, fromRevision: fromQuery, lastPageId })
      : null;
    return {
      protocolVersion: '1',
      spaceId,
      fromRevision: fromQuery,
      toRevision: page.toRevision,
      toSequence: page.head.sequence,
      toRevisionContentHash: page.head.revisionContentHash,
      toPageCount: page.head.pageCount.toString(),
      toRevisionManifestByteLength: page.head.revisionManifestByteLength.toString(),
      toRevisionBodyBytes: page.head.revisionBodyBytes.toString(),
      items,
      nextCursor,
    };
  }

  private parseSpaceId(spaceId: string): string {
    const parsed = SpaceParamsSchema.safeParse({ spaceId });
    if (!parsed.success) {
      throw new SyncApiException('PAYLOAD_INVALID', 'Invalid spaceId');
    }
    return parsed.data.spaceId;
  }

  private parsePushSessionParams(spaceId: string, sessionId: string): { spaceId: string; sessionId: string } {
    const parsed = PushSessionParamsSchema.safeParse({ spaceId, sessionId });
    if (!parsed.success) {
      throw new SyncApiException('PAYLOAD_INVALID', 'Invalid push session path parameters');
    }
    return parsed.data;
  }

  private async assertReadable(principal: HumanDevicePrincipal, spaceId: string) {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: { deletedAt: true },
    });
    if (!space || space.deletedAt) {
      throw new SyncApiException('SPACE_FORBIDDEN', 'Space is not accessible');
    }
    if (principal.platformRole === 'super_admin') return;
    const member = await this.prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId: principal.userId, spaceId } },
    });
    if (!member) {
      throw new SyncApiException('SPACE_FORBIDDEN', 'Space is not accessible');
    }
  }

  @Post('spaces/:spaceId/push-sessions')
  @HttpCode(HttpStatus.CREATED)
  async createPushSession(
    @Param('spaceId') spaceIdParam: string,
    @Body() body: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const spaceId = this.parseSpaceId(spaceIdParam);
    await this.assertReadable(request.user, spaceId);
    await this.capabilities.assertV1Compatible(spaceId);
    const input = CreatePushSessionRequestSchema.safeParse(body);
    if (!input.success) {
      throw new SyncApiException('PAYLOAD_INVALID', 'Invalid create push session request');
    }
    return this.pushSessions.create(request.user, spaceId, input.data);
  }

  @Put('spaces/:spaceId/push-sessions/:sessionId/batches/:batchIndex')
  async uploadBatch(
    @Param('spaceId') spaceIdParam: string,
    @Param('sessionId') sessionIdParam: string,
    @Param('batchIndex') batchIndex: string,
    @Body() body: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const { spaceId, sessionId } = this.parsePushSessionParams(spaceIdParam, sessionIdParam);
    const pushBatchParams = PushBatchParamsSchema.safeParse({ spaceId, sessionId, batchIndex });
    if (!pushBatchParams.success) {
      throw new SyncApiException('PAYLOAD_INVALID', 'Invalid push batch path parameters');
    }
    let parsedBatchIndex: number;
    try {
      parsedBatchIndex = parseBatchIndex(batchIndex);
    } catch {
      throw new SyncApiException('PAYLOAD_INVALID', 'Invalid batch index');
    }
    const batch = PushBatchSchema.safeParse(body);
    if (!batch.success || batch.data.batchIndex !== parsedBatchIndex) {
      throw new SyncApiException('PAYLOAD_INVALID', 'Invalid batch payload');
    }
    return this.pushSessions.upload(request.user, spaceId, sessionId, batch.data);
  }

  @Post('spaces/:spaceId/push-sessions/:sessionId/finalize')
  @HttpCode(HttpStatus.OK)
  async finalize(
    @Param('spaceId') spaceIdParam: string,
    @Param('sessionId') sessionIdParam: string,
    @Body() body: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const { spaceId, sessionId } = this.parsePushSessionParams(spaceIdParam, sessionIdParam);
    const input = FinalizePushRequestSchema.safeParse(body);
    if (!input.success) {
      throw new SyncApiException('PAYLOAD_INVALID', 'Invalid finalize request');
    }
    return this.pushSessions.finalize(request.user, spaceId, sessionId, input.data.confirmationHash);
  }

  @Get('spaces/:spaceId/push-sessions/:sessionId')
  async getPushSession(
    @Param('spaceId') spaceIdParam: string,
    @Param('sessionId') sessionIdParam: string,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const { spaceId, sessionId } = this.parsePushSessionParams(spaceIdParam, sessionIdParam);
    return this.pushSessions.get(request.user, spaceId, sessionId);
  }

  @Delete('spaces/:spaceId/push-sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async abortPushSession(
    @Param('spaceId') spaceIdParam: string,
    @Param('sessionId') sessionIdParam: string,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const { spaceId, sessionId } = this.parsePushSessionParams(spaceIdParam, sessionIdParam);
    await this.pushSessions.abort(request.user, spaceId, sessionId);
  }
}
