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
} from '@nestjs/common';
import {
  CreatePushSessionRequestSchema,
  FinalizePushRequestSchema,
  parsePageLimit,
  PushBatchSchema,
} from '@neomei/agentwiki-sync-protocol';
import { PrismaService } from '../../database/prisma.service';
import { HumanDeviceGuard, type HumanDevicePrincipal } from './human-device.guard';
import { SyncApiException } from './sync-error';
import { SyncRevisionService } from './sync-revision.service';
import { SyncCursorService } from './sync-cursor.service';
import { SyncCapabilitiesService } from './sync-capabilities.service';
import { PushSessionService } from './push-session.service';

@Controller('sync/v1')
@UseGuards(HumanDeviceGuard)
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
    const memberships = await this.prisma.spaceMember.findMany({
      where: { userId: request.user.userId, space: { deletedAt: null } },
      include: { space: true },
      orderBy: { createdAt: 'asc' },
    });
    const spaces = await Promise.all(memberships.map(async (membership) => {
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
  async head(@Param('spaceId') spaceId: string, @Req() request: { user: HumanDevicePrincipal }) {
    await this.assertReadable(request.user, spaceId);
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
    @Param('spaceId') spaceId: string,
    @Query('revision') revisionQuery: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limitQuery: string | undefined,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    await this.assertReadable(request.user, spaceId);
    const limit = limitQuery ? parsePageLimit(limitQuery) : 100;
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
      revision = await this.revisions.resolveRevision(spaceId, revisionQuery ?? 'current');
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
    @Param('spaceId') spaceId: string,
    @Query('from') fromQuery: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limitQuery: string | undefined,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    await this.assertReadable(request.user, spaceId);
    if (!fromQuery) {
      throw new SyncApiException('PAYLOAD_INVALID', 'Missing from query parameter');
    }
    const limit = limitQuery ? parsePageLimit(limitQuery) : 100;
    let from = fromQuery;
    let afterPageId: string | undefined;
    if (cursor) {
      const payload = this.cursors.decode(cursor);
      if (payload.kind !== 'delta' || payload.spaceId !== spaceId || payload.fromRevision !== fromQuery) {
        throw new SyncApiException('CURSOR_INVALID', 'Cursor does not match this route');
      }
      afterPageId = payload.lastPageId;
    }
    const page = await this.revisions.deltaPage(spaceId, from, limit, afterPageId);
    const nextCursor = page.nextPageId
      ? this.cursors.encode({ kind: 'delta', spaceId, revision: page.toRevision, fromRevision: fromQuery, lastPageId: page.nextPageId })
      : null;
    const items = await Promise.all((page.items ?? []).map(async (row) => {
      if (row.operation === 'archive') {
        return { operation: 'archive' as const, pageId: row.pageId, previousPath: row.previousPath };
      }
      const pageRow = await this.prisma.syncRevisionPageRow.findUnique({
        where: { revisionId_pageId: { revisionId: page.toRevision, pageId: row.pageId } },
        include: { content: true },
      });
      if (!pageRow) {
        return { operation: 'archive' as const, pageId: row.pageId, previousPath: '' };
      }
      return {
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
    }));
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

  private async assertReadable(principal: HumanDevicePrincipal, spaceId: string) {
    const member = await this.prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId: principal.userId, spaceId } },
      include: { space: { select: { deletedAt: true } } },
    });
    if (!member || member.space.deletedAt) {
      throw new SyncApiException('SPACE_FORBIDDEN', 'Space is not accessible');
    }
  }

  @Post('spaces/:spaceId/push-sessions')
  @HttpCode(HttpStatus.CREATED)
  async createPushSession(
    @Param('spaceId') spaceId: string,
    @Body() body: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const input = CreatePushSessionRequestSchema.safeParse(body);
    if (!input.success) {
      throw new SyncApiException('PAYLOAD_INVALID', 'Invalid create push session request');
    }
    return this.pushSessions.create(request.user, spaceId, input.data);
  }

  @Put('spaces/:spaceId/push-sessions/:sessionId/batches/:batchIndex')
  async uploadBatch(
    @Param('spaceId') spaceId: string,
    @Param('sessionId') sessionId: string,
    @Param('batchIndex') batchIndex: string,
    @Body() body: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const batch = PushBatchSchema.safeParse(body);
    if (!batch.success || batch.data.batchIndex !== Number(batchIndex)) {
      throw new SyncApiException('PAYLOAD_INVALID', 'Invalid batch payload');
    }
    return this.pushSessions.upload(request.user, spaceId, sessionId, batch.data);
  }

  @Post('spaces/:spaceId/push-sessions/:sessionId/finalize')
  async finalize(
    @Param('spaceId') spaceId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    const input = FinalizePushRequestSchema.safeParse(body);
    if (!input.success) {
      throw new SyncApiException('PAYLOAD_INVALID', 'Invalid finalize request');
    }
    return this.pushSessions.finalize(request.user, spaceId, sessionId, input.data.confirmationHash);
  }

  @Get('spaces/:spaceId/push-sessions/:sessionId')
  async getPushSession(
    @Param('spaceId') spaceId: string,
    @Param('sessionId') sessionId: string,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    return this.pushSessions.get(request.user, spaceId, sessionId);
  }

  @Delete('spaces/:spaceId/push-sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async abortPushSession(
    @Param('spaceId') spaceId: string,
    @Param('sessionId') sessionId: string,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    await this.pushSessions.abort(request.user, spaceId, sessionId);
  }
}
