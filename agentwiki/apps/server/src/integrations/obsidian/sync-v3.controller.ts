import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  BlobChunkReceiptV3Schema,
  CompleteBlobRequestV3Schema,
  CompletedBlobV3Schema,
  CreateTreePushSessionRequestV3Schema,
  CreateTreePushSessionResponseV3Schema,
  DeltaQuerySchema,
  SnapshotQuerySchema,
  SpaceParamsSchema,
  TreeBootstrapPreviewV3Schema,
  TreeBootstrapRequestV3Schema,
  TreeCapabilitiesResponseV3Schema,
  TreeDeltaPageV3Schema,
  TreeFinalizePushResponseV3Schema,
  TreeFinalizePushRequestV3Schema,
  TreePushBatchReceiptV3Schema,
  TreePushBatchV3Schema,
  TreePushSessionStatusResponseV3Schema,
  TreeRevisionHeadResponseV3Schema,
  TreeSnapshotPageV3Schema,
  TreeSyncSpaceListResponseV3Schema,
  TREE_SYNC_V3_HARD_LIMITS,
  TREE_SYNC_V2_LIMITS,
} from '@neomei/agentwiki-sync-protocol';
import type { Response } from 'express';
import type { Principal } from '../../core/authorization/authorization.service';
import { HumanDeviceGuard, type HumanDevicePrincipal } from './human-device.guard';
import { SyncCapabilitiesService } from './sync-capabilities.service';
import { SyncApiException } from './sync-error';
import { SyncNoStoreInterceptor } from './sync-no-store.interceptor';
import { SyncV3BootstrapService } from './sync-v3-bootstrap.service';
import { SyncV3RevisionService } from './sync-v3-revision.service';
import { SyncV3BlobService } from './sync-v3-blob.service';
import { SyncV3PushSessionService } from './sync-v3-push-session.service';

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

@Controller('sync/v3')
@UseGuards(HumanDeviceGuard)
@UseInterceptors(SyncNoStoreInterceptor)
export class SyncV3Controller {
  constructor(
    private readonly revisions: SyncV3RevisionService,
    private readonly capabilities: SyncCapabilitiesService,
    private readonly bootstrap: SyncV3BootstrapService,
    private readonly blobs: SyncV3BlobService,
    private readonly pushSessions: SyncV3PushSessionService,
  ) {}

  @Get('capabilities')
  async negotiatedCapabilities(@Query() query: unknown) {
    this.assertEmptyQuery(query);
    return TreeCapabilitiesResponseV3Schema.parse({
      protocolVersion: '3',
      capabilities: this.capabilities.capabilitiesV3(),
      capabilitiesHash: await this.capabilities.hashV3(),
    });
  }

  @Post('spaces/:spaceId/push-sessions')
  @HttpCode(HttpStatus.CREATED)
  async createPushSession(
    @Param('spaceId') spaceValue: string,
    @Query() query: unknown,
    @Body() body: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    this.assertEmptyQuery(query);
    const parsed = CreateTreePushSessionRequestV3Schema.safeParse(body);
    if (!parsed.success) throw this.invalid('Invalid v3 Push session request');
    return CreateTreePushSessionResponseV3Schema.parse(await this.pushSessions.create(
      request.user, this.parseSpaceId(spaceValue), parsed.data,
    ));
  }

  @Put('spaces/:spaceId/push-sessions/:sessionId/batches/:batchIndex')
  async uploadPushBatch(
    @Param('spaceId') spaceValue: string,
    @Param('sessionId') sessionId: string,
    @Param('batchIndex') batchIndexValue: string,
    @Query() query: unknown,
    @Body() body: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    this.assertEmptyQuery(query);
    const { spaceId, batchIndex } = this.parseBatchParams(spaceValue, sessionId, batchIndexValue);
    const parsed = TreePushBatchV3Schema.safeParse(body);
    if (!parsed.success || parsed.data.batchIndex !== batchIndex) {
      throw this.invalid('Invalid v3 Push batch');
    }
    return TreePushBatchReceiptV3Schema.parse(await this.pushSessions.uploadBatch(
      request.user, spaceId, sessionId, parsed.data,
    ));
  }

  @Post('spaces/:spaceId/push-sessions/:sessionId/finalize')
  @HttpCode(HttpStatus.OK)
  async finalizePushSession(
    @Param('spaceId') spaceValue: string,
    @Param('sessionId') sessionId: string,
    @Query() query: unknown,
    @Body() body: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    this.assertEmptyQuery(query);
    const spaceId = this.parseSessionParams(spaceValue, sessionId);
    const parsed = TreeFinalizePushRequestV3Schema.safeParse(body);
    if (!parsed.success) throw this.invalid('Invalid v3 Push finalize request');
    return TreeFinalizePushResponseV3Schema.parse(await this.pushSessions.finalize(
      request.user, spaceId, sessionId, parsed.data,
    ));
  }

  @Get('spaces/:spaceId/push-sessions/:sessionId')
  async getPushSession(
    @Param('spaceId') spaceValue: string,
    @Param('sessionId') sessionId: string,
    @Query() query: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    this.assertEmptyQuery(query);
    const spaceId = this.parseSessionParams(spaceValue, sessionId);
    return TreePushSessionStatusResponseV3Schema.parse(await this.pushSessions.get(
      request.user, spaceId, sessionId,
    ));
  }

  @Delete('spaces/:spaceId/push-sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async abortPushSession(
    @Param('spaceId') spaceValue: string,
    @Param('sessionId') sessionId: string,
    @Query() query: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    this.assertEmptyQuery(query);
    const spaceId = this.parseSessionParams(spaceValue, sessionId);
    await this.pushSessions.abort(request.user, spaceId, sessionId);
  }

  @Get('spaces')
  async listSpaces(
    @Query() query: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    this.assertEmptyQuery(query);
    return TreeSyncSpaceListResponseV3Schema.parse(
      await this.revisions.listSpaces(request.user),
    );
  }

  @Get('spaces/:spaceId/head')
  async head(
    @Param('spaceId') value: string,
    @Query() query: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    this.assertEmptyQuery(query);
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
    @Query() query: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    this.assertEmptyQuery(query);
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
    @Query() query: unknown,
    @Body() body: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    this.assertEmptyQuery(query);
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

  @Put('spaces/:spaceId/push-sessions/:sessionId/blobs/:contentHash/chunks/:chunkIndex')
  async putBlobChunk(
    @Param('spaceId') spaceValue: string,
    @Param('sessionId') sessionId: string,
    @Param('contentHash') contentHash: string,
    @Param('chunkIndex') chunkIndexValue: string,
    @Query() query: unknown,
    @Headers('content-type') contentType: string | undefined,
    @Headers('content-length') contentLength: string | undefined,
    @Req() request: { user: HumanDevicePrincipal } & AsyncIterable<Uint8Array>,
  ) {
    this.assertEmptyQuery(query);
    const { spaceId, chunkIndex } = this.parseBlobChunkParams(
      spaceValue,
      sessionId,
      contentHash,
      chunkIndexValue,
    );
    if (contentType !== 'application/octet-stream') {
      throw this.invalid('Blob chunks require application/octet-stream');
    }
    if (contentLength !== undefined) {
      if (!/^(0|[1-9][0-9]*)$/u.test(contentLength)) {
        throw this.invalid('Invalid Blob chunk Content-Length');
      }
      if (BigInt(contentLength) > BigInt(this.capabilities.capabilitiesV3().blobChunkBytes)) {
        throw new SyncApiException(
          'ATTACHMENT_QUOTA_EXCEEDED',
          'Blob chunk exceeds the negotiated byte limit',
          undefined,
          '3',
        );
      }
    }
    return BlobChunkReceiptV3Schema.parse(await this.blobs.putChunk(
      request.user,
      spaceId,
      sessionId,
      contentHash,
      chunkIndex,
      request,
    ));
  }

  @Post('spaces/:spaceId/push-sessions/:sessionId/blobs/:contentHash/complete')
  @HttpCode(HttpStatus.OK)
  async completeBlob(
    @Param('spaceId') spaceValue: string,
    @Param('sessionId') sessionId: string,
    @Param('contentHash') contentHash: string,
    @Query() query: unknown,
    @Body() body: unknown,
    @Req() request: { user: HumanDevicePrincipal },
  ) {
    this.assertEmptyQuery(query);
    const spaceId = this.parseBlobParams(spaceValue, sessionId, contentHash);
    const parsed = CompleteBlobRequestV3Schema.safeParse(body);
    if (!parsed.success || parsed.data.contentHash !== contentHash) {
      throw this.invalid('Invalid Blob completion request');
    }
    return CompletedBlobV3Schema.parse(await this.blobs.complete(
      request.user,
      spaceId,
      sessionId,
      contentHash,
      { sizeBytes: parsed.data.sizeBytes, chunkCount: parsed.data.chunkCount },
    ));
  }

  @Get('spaces/:spaceId/revisions/:revisionId/attachments/:attachmentId/content')
  async revisionAttachmentContent(
    @Param('spaceId') spaceValue: string,
    @Param('revisionId') revisionId: string,
    @Param('attachmentId') attachmentId: string,
    @Query() query: unknown,
    @Req() request: { user: HumanDevicePrincipal },
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    this.assertEmptyQuery(query);
    const spaceId = this.parseSpaceId(spaceValue);
    if (
      revisionId === 'current'
      || !PUBLIC_ID_PATTERN.test(revisionId)
      || !PUBLIC_ID_PATTERN.test(attachmentId)
    ) throw this.invalid('A valid fixed Revision and Attachment are required');
    const download = await this.blobs.openRevisionAttachment(
      request.user,
      spaceId,
      revisionId,
      attachmentId,
    );
    response.setHeader('Content-Type', download.mimeType);
    response.setHeader('Content-Length', String(download.sizeBytes));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(download.stream);
  }

  private parseSpaceId(value: string): string {
    const parsed = SpaceParamsSchema.safeParse({ spaceId: value });
    if (!parsed.success) throw this.invalid('Invalid spaceId');
    return parsed.data.spaceId;
  }

  private parseBlobParams(
    spaceValue: string,
    sessionId: string,
    contentHash: string,
  ): string {
    const spaceId = this.parseSpaceId(spaceValue);
    if (!UUID_PATTERN.test(sessionId) || !HASH_PATTERN.test(contentHash)) {
      throw this.invalid('Invalid Blob path parameters');
    }
    return spaceId;
  }

  private parseSessionParams(spaceValue: string, sessionId: string): string {
    const spaceId = this.parseSpaceId(spaceValue);
    if (!UUID_PATTERN.test(sessionId)) throw this.invalid('Invalid Push session path parameters');
    return spaceId;
  }

  private parseBatchParams(
    spaceValue: string,
    sessionId: string,
    batchIndexValue: string,
  ): { spaceId: string; batchIndex: number } {
    const spaceId = this.parseSessionParams(spaceValue, sessionId);
    if (!/^(0|[1-9][0-9]*)$/u.test(batchIndexValue)) throw this.invalid('Invalid batch index');
    const batchIndex = Number(batchIndexValue);
    if (!Number.isSafeInteger(batchIndex) || batchIndex >= TREE_SYNC_V2_LIMITS.maxDeltaItems) {
      throw this.invalid('Invalid batch index');
    }
    return { spaceId, batchIndex };
  }

  private parseBlobChunkParams(
    spaceValue: string,
    sessionId: string,
    contentHash: string,
    chunkIndexValue: string,
  ): { spaceId: string; chunkIndex: number } {
    const spaceId = this.parseBlobParams(spaceValue, sessionId, contentHash);
    if (!/^(0|[1-9][0-9]*)$/u.test(chunkIndexValue)) {
      throw this.invalid('Invalid Blob chunk index');
    }
    const chunkIndex = Number(chunkIndexValue);
    if (
      !Number.isSafeInteger(chunkIndex)
      || chunkIndex >= TREE_SYNC_V3_HARD_LIMITS.maxBlobChunks
    ) {
      throw new SyncApiException(
        'ATTACHMENT_QUOTA_EXCEEDED',
        'Blob chunk index exceeds the hard limit',
        undefined,
        '3',
      );
    }
    return { spaceId, chunkIndex };
  }

  private assertEmptyQuery(query: unknown): void {
    if (
      !query
      || typeof query !== 'object'
      || Array.isArray(query)
      || Object.keys(query as Record<string, unknown>).length !== 0
    ) throw this.invalid('Unexpected query parameters');
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
