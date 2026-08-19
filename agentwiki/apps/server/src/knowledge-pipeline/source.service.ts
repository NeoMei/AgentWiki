import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BusinessException } from '../core/filters/business-error';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { execFile, execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { promises as dns } from 'dns';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { isIP } from 'net';
import { tmpdir } from 'os';
import { extname, posix, resolve } from 'path';
import { promisify } from 'util';
import { PrismaService } from '../database/prisma.service';
import { Principal } from '../core/authorization/authorization.service';
import { CreateSourceDto, UpdateSourceDto } from '../core/dto/source.dto';
import { ReviewService } from '../review/review.service';
import { extractHtmlText, isSupportedTextContentType } from './remote-source';

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.json', '.py', '.java', '.go', '.rs', '.sql', '.yaml', '.yml']);
const execFileAsync = promisify(execFile);
const MAX_REMOTE_REDIRECTS = 5;
const MAX_REMOTE_BYTES = 10 * 1024 * 1024;

interface FetchedSegment {
  sourcePath: string;
  title: string;
  content: string;
  format: 'markdown' | 'json';
  evidence?: Array<{ sourcePath: string; sourceHash: string; quote: string }>;
}

interface FetchedSource {
  content: string;
  metadata?: object;
  cleanup?: string;
  files?: Array<{ path: string; contentHash: string; size: number; commit?: string }>;
  segments?: FetchedSegment[];
  sourceVersion?: { id: string; version: number; contentHash: string };
}

interface LocatedChunk {
  content: string;
  location: Record<string, unknown>;
}

interface CompiledPage {
  sourcePath: string;
  title: string;
  content: string;
  format: 'markdown' | 'json';
  contentHash: string;
}

@Injectable()
export class SourceService {
  private readonly logger = new Logger(SourceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly review: ReviewService,
  ) {}

  async create(spaceId: string, principal: Principal, dto: CreateSourceDto | { type: 'file'; name: string; content: string }) {
    this.validateInput(dto);
    const identity = dto.type === 'url' || dto.type === 'git' ? dto.uri! : dto.content!;
    const contentHash = this.hash(identity);
    const existing = await this.prisma.source.findUnique({
      where: { spaceId_type_contentHash: { spaceId, type: dto.type, contentHash } },
    });
    if (existing) return existing;
    try {
      return await this.prisma.source.create({
        data: {
          spaceId,
          type: dto.type,
          name: dto.name,
          uri: 'uri' in dto ? dto.uri : undefined,
          contentHash,
          createdByUserId: principal.agentId ? undefined : principal.userId,
          createdByAgentId: principal.agentId,
          versions: dto.type === 'text' || dto.type === 'file' ? {
            create: { version: 1, content: dto.content, contentHash },
          } : undefined,
        },
        include: { versions: true },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const concurrent = await this.prisma.source.findUnique({
          where: { spaceId_type_contentHash: { spaceId, type: dto.type, contentHash } },
          include: { versions: true },
        });
        if (concurrent) return concurrent;
      }
      throw error;
    }
  }

  async list(spaceId: string) {
    return this.prisma.source.findMany({
      where: { spaceId },
      include: { _count: { select: { versions: true, runs: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const source = await this.prisma.source.findUnique({
      where: { id },
      include: {
        versions: { orderBy: { version: 'desc' }, take: 10 },
        runs: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!source) throw new NotFoundException('Source not found');
    return source;
  }

  async update(id: string, dto: UpdateSourceDto) {
    return this.prisma.source.update({
      where: { id },
      data: {
        name: dto.name,
        status: dto.status,
        archivedAt: dto.status === 'archived' ? new Date() : dto.status === 'active' ? null : undefined,
      },
    });
  }

  async createRun(sourceId: string, principal: Principal, idempotencyKey?: string) {
    const source = await this.prisma.source.findUnique({ where: { id: sourceId } });
    if (!source || source.status !== 'active') throw new BadRequestException('Source is not active');
    if (idempotencyKey) {
      if (idempotencyKey.length > 128) throw new BadRequestException('Idempotency key is too long');
      const existing = await this.prisma.ingestRun.findUnique({
        where: { sourceId_idempotencyKey: { sourceId, idempotencyKey } },
      });
      if (existing) return existing;
    }
    return this.prisma.ingestRun.create({
      data: {
        sourceId,
        idempotencyKey,
        spaceId: source.spaceId,
        requestedByUserId: principal.agentId ? undefined : principal.userId,
        requestedByAgentId: principal.agentId,
        requestedScopes: principal.scopes || [],
        requestedCredentialId: principal.credentialId,
        requestedCredentialType: principal.agentId ? 'agent' : principal.credentialId ? 'personal' : 'jwt',
      },
    });
  }

  async listRuns(spaceId: string) {
    return this.prisma.ingestRun.findMany({
      where: { spaceId },
      include: { source: { select: { id: true, name: true, type: true } }, changeSet: { select: { id: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRun(id: string) {
    const run = await this.prisma.ingestRun.findUnique({
      where: { id },
      include: { source: true, artifacts: true, evidences: true, changeSet: { include: { items: true } } },
    });
    if (!run) throw new NotFoundException('Run not found');
    return run;
  }

  async retryRun(id: string) {
    const run = await this.prisma.ingestRun.findUnique({
      where: { id },
      include: { changeSet: { select: { status: true } } },
    });
    if (!run || !['failed', 'partial', 'cancelled'].includes(run.status)) {
      throw new BusinessException('RUN_NOT_RETRYABLE', 'Run is not retryable');
    }
    return this.prisma.$transaction(async (tx) => {
      if (run.changeSet?.status === 'published' || run.changeSet?.status === 'reverted') {
        return tx.ingestRun.create({
          data: {
            sourceId: run.sourceId,
            spaceId: run.spaceId,
            requestedByUserId: run.requestedByUserId,
            requestedByAgentId: run.requestedByAgentId,
            requestedScopes: run.requestedScopes,
            requestedCredentialId: run.requestedCredentialId,
            requestedCredentialType: run.requestedCredentialType,
            nextAttemptAt: new Date(),
          },
        });
      }
      await tx.changeSet.deleteMany({ where: { runId: id, status: { in: ['pending_review', 'approved', 'rejected'] } } });
      await tx.artifact.deleteMany({ where: { runId: id } });
      await tx.evidence.deleteMany({ where: { runId: id, targetPageId: null } });
      return tx.ingestRun.update({
        where: { id },
        data: {
          status: 'queued', stage: 'queued', error: null, cancelRequested: false,
          attempts: 0, nextAttemptAt: new Date(), completedAt: null,
          lockedAt: null, leaseOwner: null, leaseExpiresAt: null,
        },
      });
    });
  }

  async cancelRun(id: string) {
    const [queued, active] = await this.prisma.$transaction([
      this.prisma.ingestRun.updateMany({
        where: { id, status: 'queued' },
        data: { cancelRequested: true, status: 'cancelled', stage: 'cancelled', completedAt: new Date(), nextAttemptAt: null },
      }),
      this.prisma.ingestRun.updateMany({
        where: { id, status: { in: ['reserved', 'fetching', 'extracting', 'compiling', 'indexing'] } },
        data: { cancelRequested: true },
      }),
    ]);
    if (!queued.count && !active.count) throw new BadRequestException('Run can no longer be cancelled');
    return { success: true };
  }

  async recoverInterruptedRuns() {
    const staleBefore = new Date(Date.now() - Number(this.config.get('INGEST_LEASE_MS') || 5 * 60_000));
    await this.prisma.ingestRun.updateMany({
      where: {
        status: { in: ['reserved', 'fetching', 'extracting', 'compiling', 'indexing'] },
        OR: [
          { leaseExpiresAt: { lte: new Date() } },
          { leaseExpiresAt: null, lockedAt: { lte: staleBefore } },
        ],
      },
      data: {
        status: 'queued', stage: 'queued', lockedAt: null, leaseOwner: null,
        leaseExpiresAt: null, nextAttemptAt: new Date(),
      },
    });
  }

  async processRun(id: string, workerId?: string) {
    const leaseMs = Number(this.config.get('INGEST_LEASE_MS') || 5 * 60_000);
    const reserved = await this.prisma.ingestRun.updateMany({
      where: { id, status: 'reserved', ...(workerId ? { leaseOwner: workerId } : {}) },
      data: {
        status: 'fetching', stage: 'fetching', attempts: { increment: 1 }, lockedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + leaseMs),
      },
    });
    if (reserved.count === 0) return;
    const run = await this.prisma.ingestRun.findUnique({ where: { id }, include: { source: true, inputSourceVersion: true } });
    if (!run) return;
    await this.prisma.$transaction([
      this.prisma.artifact.deleteMany({ where: { runId: id } }),
      this.prisma.evidence.deleteMany({ where: { runId: id, targetPageId: null, targetRelationId: null } }),
      this.prisma.changeSet.deleteMany({ where: { runId: id, status: { in: ['pending_review', 'approved', 'rejected'] } } }),
    ]);
    let cleanup: string | undefined;
    try {
      let currentScopes = await this.assertRequesterStillAuthorized(run);
      if (run.cancelRequested) throw new Error('Run cancelled');
      const fetched = await this.fetch(run.source, run.inputSourceVersion);
      cleanup = fetched.cleanup;
      currentScopes = await this.assertRequesterStillAuthorized(run);
      await this.assertRunActive(id, workerId, leaseMs);

      const segments = (fetched.segments?.length ? fetched.segments : [{
        sourcePath: '__root__', title: run.source.name, content: fetched.content, format: 'markdown' as const,
      }]).map((segment) => ({ ...segment, content: this.redactSecrets(segment.content) }));
      const sanitized = segments.map((segment) => `## ${segment.sourcePath}\n${segment.content}`).join('\n\n');
      const contentHash = this.hash(sanitized);
      let version = fetched.sourceVersion
        ? await this.prisma.sourceVersion.findUnique({ where: { id: fetched.sourceVersion.id } })
        : await this.prisma.sourceVersion.findFirst({ where: { sourceId: run.sourceId, contentHash } });
      if (!version && fetched.sourceVersion) throw new Error('Pinned source version no longer exists');
      if (!version) {
        const latest = await this.prisma.sourceVersion.findFirst({ where: { sourceId: run.sourceId }, orderBy: { version: 'desc' } });
        try {
          version = await this.prisma.sourceVersion.create({
            data: { sourceId: run.sourceId, version: (latest?.version || 0) + 1, content: sanitized, contentHash, metadata: fetched.metadata as any },
          });
        } catch (error: any) {
          if (error?.code !== 'P2002') throw error;
          version = await this.prisma.sourceVersion.findFirst({ where: { sourceId: run.sourceId, contentHash } });
          if (!version) throw error;
        }
        if (fetched.files?.length) {
          await this.prisma.sourceFileSnapshot.createMany({
            data: fetched.files.map((file) => ({ ...file, sourceVersionId: version!.id })),
          });
        }
      }

      await this.advanceRun(id, workerId, leaseMs, 'extracting');
      const chunks = this.chunkSegments(segments, 8_000);
      await this.prisma.artifact.createMany({
        data: chunks.map((chunk, index) => ({
          runId: id, type: 'chunk', content: chunk.content,
          metadata: { index, ...chunk.location },
        })),
      });
      const chunkEvidence = chunks.map((chunk) => ({
          runId: id,
          sourceVersionId: version!.id,
          quote: chunk.content.slice(0, 500),
          location: chunk.location as any,
          confidence: 1,
      }));
      const explicitEvidence = segments.flatMap((segment) =>
        (segment.evidence || []).map((evidence) => ({
          runId: id,
          sourceVersionId: version!.id,
          quote: this.redactSecrets(evidence.quote),
          location: {
            sourcePath: segment.sourcePath,
            originalSourcePath: evidence.sourcePath,
            sourceHash: evidence.sourceHash,
          },
          confidence: 1,
        })),
      );
      await this.prisma.evidence.createMany({
        data: [...chunkEvidence, ...explicitEvidence],
      });
      const evidences = await this.prisma.evidence.findMany({
        where: { runId: id },
        select: { id: true, location: true },
      });
      const evidenceByPath = new Map<string, string>();
      for (const evidence of evidences) {
        const location = evidence.location as Record<string, unknown> | null;
        const sourcePath = typeof location?.sourcePath === 'string' ? location.sourcePath : undefined;
        if (sourcePath && !evidenceByPath.has(sourcePath)) evidenceByPath.set(sourcePath, evidence.id);
      }

      await this.assertRunActive(id, workerId, leaseMs);
      currentScopes = await this.assertRequesterStillAuthorized(run);
      await this.advanceRun(id, workerId, leaseMs, 'compiling');
      const compiledPages: CompiledPage[] = segments.map((segment) => ({
        sourcePath: segment.sourcePath,
        title: segment.sourcePath === '__root__' ? run.source.name : segment.title,
        content: segment.content,
        format: segment.format,
        contentHash: this.hash(segment.content),
      }));
      const existingPages = await this.prisma.page.findMany({
        where: { spaceId: run.spaceId, sourceId: run.sourceId, deletedAt: null },
        select: { id: true, sourcePath: true, title: true, content: true, format: true, sourceVersionId: true, updatedAt: true },
      });
      const existingByPath = new Map(existingPages.map((page) => [page.sourcePath || '__root__', page]));
      const compiledPaths = new Set(compiledPages.map((page) => page.sourcePath));
      const itemStatus = 'pending';
      const changeItems: Array<{ type: string; status: string; payload: Record<string, unknown> }> = [];
      for (const page of compiledPages) {
        const existing = existingByPath.get(page.sourcePath);
        if (!existing) {
          changeItems.push({
            type: 'create_page', status: itemStatus,
            payload: { ...page, sourceId: run.sourceId, sourceVersionId: version.id },
          });
        } else if (
          existing.title !== page.title || existing.content !== page.content ||
          existing.format !== page.format || existing.sourceVersionId !== version.id
        ) {
          changeItems.push({
            type: 'update_page', status: itemStatus,
            payload: {
              pageId: existing.id,
              sourcePath: page.sourcePath,
              sourceId: run.sourceId,
              sourceVersionId: version.id,
              expectedUpdatedAt: existing.updatedAt.toISOString(),
              changes: { title: page.title, content: page.content, format: page.format },
            },
          });
        }
      }
      for (const existing of existingPages) {
        const sourcePath = existing.sourcePath || '__root__';
        if (!compiledPaths.has(sourcePath)) {
          changeItems.push({ type: 'archive_page', status: itemStatus, payload: { pageId: existing.id, sourcePath, expectedUpdatedAt: existing.updatedAt.toISOString() } });
        }
      }

      const relations = this.extractRelations(segments);
      const existingPageIds = existingPages.map((page) => page.id);
      const existingRelations = existingPageIds.length ? await this.prisma.knowledgeRelation.findMany({
        where: { sourcePageId: { in: existingPageIds }, targetPageId: { in: existingPageIds }, origin: 'compiled' },
        select: { id: true, sourcePageId: true, targetPageId: true, relation: true, lastModifiedAt: true },
      }) : [];
      const pathByPageId = new Map(existingPages.map((page) => [page.id, page.sourcePath || '__root__']));
      const existingRelationByKey = new Map(existingRelations.map((relation) => [
        `${pathByPageId.get(relation.sourcePageId)}|${pathByPageId.get(relation.targetPageId)}|${relation.relation}`,
        relation,
      ]));
      const compiledRelationKeys = new Set<string>();
      for (const relation of relations) {
        const key = `${relation.sourcePath}|${relation.targetPath}|${relation.relation}`;
        compiledRelationKeys.add(key);
        if (existingRelationByKey.has(key)) continue;
        changeItems.push({
          type: 'create_relation', status: itemStatus,
          payload: {
            ...relation,
            confidence: 0.85,
            evidenceId: evidenceByPath.get(relation.sourcePath),
          },
        });
      }
      for (const [key, relation] of existingRelationByKey) {
        if (!compiledRelationKeys.has(key)) {
          changeItems.push({
            type: 'archive_relation', status: itemStatus,
            payload: { relationId: relation.id, expectedLastModifiedAt: relation.lastModifiedAt.toISOString() },
          });
        }
      }

      const entities = this.extractEntities(segments);
      await this.prisma.artifact.createMany({
        data: [
          ...compiledPages.map((page) => ({ runId: id, type: 'compiled_page', content: page.content, metadata: { sourcePath: page.sourcePath, title: page.title, contentHash: page.contentHash } })),
          ...entities.map((entity) => ({ runId: id, type: 'entity', content: entity.name, metadata: entity })),
          ...relations.map((relation) => ({ runId: id, type: 'relation_candidate', content: `${relation.sourcePath} ${relation.relation} ${relation.targetPath}`, metadata: relation })),
        ],
      });

      const [spacePolicy, agentPolicy] = await Promise.all([
        this.prisma.space.findUnique({ where: { id: run.spaceId }, select: { approvalPolicy: true } }),
        run.requestedByAgentId
          ? this.prisma.agent.findUnique({ where: { id: run.requestedByAgentId }, select: { approvalMode: true } })
          : Promise.resolve(null),
      ]);
      currentScopes = await this.assertRequesterStillAuthorized(run);
      const autoPublish = changeItems.length > 0 &&
        spacePolicy?.approvalPolicy === 'scoped-auto-publish' &&
        agentPolicy?.approvalMode === 'scoped-auto-publish' &&
        currentScopes.includes('review:auto-publish');
      const changeSet = changeItems.length ? await this.prisma.changeSet.create({
        data: {
          spaceId: run.spaceId,
          runId: id,
          title: `Import: ${run.source.name}`,
          status: autoPublish ? 'approved' : 'pending_review',
          createdByUserId: run.requestedByUserId,
          createdByAgentId: run.requestedByAgentId,
          items: {
            create: changeItems.map((item) => ({ ...item, status: autoPublish ? 'accepted' : item.status, payload: item.payload as any })),
          },
        },
      }) : null;

      await this.assertRunActive(id, workerId, leaseMs);
      await this.assertRequesterStillAuthorized(run);
      await this.advanceRun(id, workerId, leaseMs, 'indexing');
      await this.prisma.artifact.create({
        data: {
          runId: id,
          type: 'index',
          content: JSON.stringify({
            sourceVersionId: version.id,
            documents: compiledPages.map((page) => ({ sourcePath: page.sourcePath, contentHash: page.contentHash })),
            entities: entities.length,
            relations: relations.length,
          }),
          metadata: { algorithm: 'source-document-and-page-search-index-v2' },
        },
      });
      await this.assertRunActive(id, workerId, leaseMs);
      if (autoPublish && changeSet) {
        const publishScopes = await this.assertRequesterStillAuthorized(run);
        if (!publishScopes.includes('review:auto-publish')) throw new Error('Run requester is no longer authorized');
        await this.prisma.ingestRun.update({ where: { id }, data: { status: 'publishing', stage: 'publishing' } });
        await this.review.publish(changeSet.id);
      }

      const partial = Number((fetched.metadata as any)?.skippedFiles || 0) > 0;
      await this.prisma.ingestRun.update({
        where: { id },
        data: {
          status: partial ? 'partial' : 'completed', stage: partial ? 'partial' : 'completed',
          lockedAt: null, leaseOwner: null, leaseExpiresAt: null, completedAt: new Date(),
          result: {
            chunks: chunks.length,
            sourceVersionId: version.id,
            pages: compiledPages.length,
            changeItems: changeItems.length,
            entities: entities.length,
            relations: relations.length,
            ...(run.source.type === 'url' ? {
              sourceMetadata: {
                finalUrl: (fetched.metadata as any)?.finalUrl,
                contentType: (fetched.metadata as any)?.contentType,
                redirectCount: (fetched.metadata as any)?.redirectCount,
              },
            } : {}),
          },
        },
      });
      await this.safeAuditRun(run, partial ? 'partial' : 'success');
    } catch (error: any) {
      const current = await this.prisma.ingestRun.findUnique({ where: { id } });
      const cancelled = current?.cancelRequested || error.message === 'Run cancelled';
      const authorizationRevoked = error.message === 'Run requester is no longer authorized';
      const leaseLost = error.message === 'Run lease lost';
      const exhausted = (current?.attempts || 0) >= (current?.maxAttempts || 3);
      if (cancelled || authorizationRevoked || !exhausted) {
        await this.prisma.changeSet.deleteMany({ where: { runId: id, status: { in: ['pending_review', 'approved', 'rejected'] } } });
      }
      if (!leaseLost) {
        await this.prisma.ingestRun.update({
          where: { id },
          data: {
            status: cancelled ? 'cancelled' : authorizationRevoked || exhausted ? 'failed' : 'queued',
            stage: cancelled ? 'cancelled' : authorizationRevoked || exhausted ? 'failed' : 'queued',
            error: error.message, lockedAt: null, leaseOwner: null, leaseExpiresAt: null,
            nextAttemptAt: cancelled || authorizationRevoked || exhausted ? null : new Date(Date.now() + 5_000),
          },
        });
      }
      await this.safeAuditRun(run, cancelled ? 'cancelled' : 'failure', error.message);
      throw error;
    } finally {
      if (cleanup) rmSync(cleanup, { recursive: true, force: true });
    }
  }

  private validateInput(dto: any) {
    if ((dto.type === 'text' || dto.type === 'file') && !dto.content) throw new BadRequestException('Content is required');
    if ((dto.type === 'url' || dto.type === 'git') && !dto.uri) throw new BadRequestException('URI is required');
    if (dto.content && Buffer.byteLength(dto.content) > 10 * 1024 * 1024) throw new BadRequestException('Source exceeds 10 MB');
  }

  private async fetch(source: any, inputSourceVersion?: any): Promise<FetchedSource> {
    if (source.type === 'okf') {
      if (!inputSourceVersion) throw new Error('Pinned source version no longer exists');
      let envelope: { documents?: Array<{ path: string; title: string; content: string; evidence?: FetchedSegment['evidence'] }> };
      try {
        envelope = JSON.parse(inputSourceVersion.content);
      } catch {
        throw new Error('Pinned OKF source version is invalid');
      }
      if (!Array.isArray(envelope.documents)) throw new Error('Pinned OKF source version is invalid');
      return {
        content: inputSourceVersion.content,
        segments: envelope.documents.map((document) => ({
          sourcePath: document.path,
          title: document.title,
          content: document.content,
          format: extname(document.path).toLowerCase() === '.json' ? 'json' : 'markdown',
          evidence: document.evidence,
        })),
        sourceVersion: {
          id: inputSourceVersion.id,
          version: inputSourceVersion.version,
          contentHash: inputSourceVersion.contentHash,
        },
      };
    }
    if (source.type === 'text' || source.type === 'file') {
      const version = await this.prisma.sourceVersion.findFirst({ where: { sourceId: source.id }, orderBy: { version: 'desc' } });
      const content = version?.content || '';
      return {
        content,
        segments: [{ sourcePath: '__root__', title: source.name, content, format: 'markdown' }],
      };
    }
    if (source.type === 'url') {
      const fetched = await this.fetchRemoteUrl(source.uri);
      return { ...fetched, segments: [{ sourcePath: '__root__', title: source.name, content: fetched.content, format: 'markdown' }] };
    }
    let url: URL;
    try { url = new URL(source.uri); } catch { throw new BusinessException('SOURCE_INVALID', 'Git URL is invalid'); }
    const allowedHosts = (this.config.get<string>('ALLOWED_GIT_HOSTS') || 'github.com,gitlab.com').split(',').map((value) => value.trim());
    if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname) || url.username || url.password) throw new BusinessException('SOURCE_INVALID', 'Git URL is not allowed');
    const root = mkdtempSync(resolve(tmpdir(), 'agentwiki-source-'));
    try {
      const target = resolve(root, 'repo');
      await execFileAsync('git', [
        'clone', '--depth', '1', '--single-branch', '--filter=blob:limit=1048576',
        url.toString(), target,
      ], { timeout: 120_000, maxBuffer: 1024 * 1024 });
      const parts: string[] = [];
      const files: Array<{ path: string; contentHash: string; size: number; commit?: string }> = [];
      const segments: FetchedSegment[] = [];
      let bytes = 0;
      let fileCount = 0;
      let skippedFiles = 0;
      const walk = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (entry.name === '.git') continue;
          if (bytes >= 10 * 1024 * 1024) { skippedFiles += 1; continue; }
          const fullPath = resolve(directory, entry.name);
          if (entry.isDirectory()) walk(fullPath);
          else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
            const size = statSync(fullPath).size;
            if (size <= 1024 * 1024 && bytes + size <= 10 * 1024 * 1024) {
              const content = readFileSync(fullPath, 'utf8');
              const sourcePath = fullPath.slice(target.length + 1).replace(/\\/g, '/');
              parts.push(`\n## ${sourcePath}\n` + content);
              bytes += size;
              fileCount += 1;
              files.push({ path: sourcePath, contentHash: this.hash(content), size });
              segments.push({
                sourcePath,
                title: sourcePath,
                content,
                format: extname(sourcePath).toLowerCase() === '.json' ? 'json' : 'markdown',
              });
            } else {
              skippedFiles += 1;
            }
          }
        }
      };
      walk(target);
      const commit = execFileSync('git', ['-C', target, 'rev-parse', 'HEAD'], { timeout: 10_000, encoding: 'utf8' }).trim();
      files.forEach((file) => { file.commit = commit; });
      return { content: parts.join('\n'), metadata: { repository: url.toString(), commit, fileCount, bytes, skippedFiles }, files, segments, cleanup: root };
    } catch (error) {
      rmSync(root, { recursive: true, force: true });
      throw error;
    }
  }

  private async fetchRemoteUrl(uri: string): Promise<FetchedSource> {
    let currentUrl = uri;
    let redirectCount = 0;
    while (true) {
      const target = await this.validateRemoteUrl(currentUrl);
      const lookup = (_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) =>
        callback(null, target.address, target.family);
      const response = await axios.get(target.url.toString(), {
        responseType: 'arraybuffer', timeout: 30_000, maxContentLength: MAX_REMOTE_BYTES,
        maxBodyLength: MAX_REMOTE_BYTES, maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
        httpAgent: new HttpAgent({ lookup }),
        httpsAgent: new HttpsAgent({ lookup }),
      });
      if (response.status >= 300) {
        const location = response.headers.location;
        if (typeof location !== 'string' || !location) throw new BadRequestException('Remote redirect is missing a location');
        if (redirectCount >= MAX_REMOTE_REDIRECTS) throw new BadRequestException('Remote URL has too many redirects');
        currentUrl = new URL(location, target.url).toString();
        redirectCount += 1;
        continue;
      }
      const contentTypeHeader = response.headers['content-type'];
      const contentType = typeof contentTypeHeader === 'string' ? contentTypeHeader : '';
      if (!isSupportedTextContentType(contentType)) throw new BadRequestException('Unsupported remote content type');
      const buffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
      if (buffer.byteLength > MAX_REMOTE_BYTES) throw new BadRequestException('Remote source exceeds 10 MB');
      let decoded: string;
      try {
        decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        throw new BadRequestException('Remote source must be valid UTF-8');
      }
      const content = contentType.toLowerCase().startsWith('text/html') ? extractHtmlText(decoded) : decoded.trim();
      if (!content) throw new BadRequestException('Remote source is empty');
      return {
        content,
        metadata: { finalUrl: target.url.toString(), contentType, redirectCount },
      };
    }
  }

  private async validateRemoteUrl(value: string) {
    let url: URL;
    try { url = new URL(value); } catch { throw new BadRequestException('URL is invalid'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new BadRequestException('URL is not allowed');
    const addresses = await dns.lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => this.isPrivateAddress(address))) {
      throw new BadRequestException('Private network URLs are not allowed');
    }
    const pinned = addresses[0];
    return { url, address: pinned.address, family: pinned.family };
  }

  private isPrivateAddress(address: string): boolean {
    const normalized = address.toLowerCase();
    if (!isIP(normalized)) return true;
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return this.isPrivateAddress(mapped);
    if (isIP(normalized) === 6) {
      return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') ||
        normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff');
    }
    const octets = normalized.split('.').map(Number);
    return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] >= 224 ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19));
  }

  private redactSecrets(content: string) {
    return content
      .replace(/(["']?(?:api[_-]?key|apikey|secret|password|token)["']?\s*[:=]\s*)["']?[^\s'",}]+["']?/gi, '$1[REDACTED]')
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
  }

  private chunk(content: string, size: number) {
    const chunks: string[] = [];
    for (let offset = 0; offset < content.length; offset += size) chunks.push(content.slice(offset, offset + size));
    return chunks.length ? chunks : [''];
  }

  private chunkSegments(segments: FetchedSegment[], size: number): LocatedChunk[] {
    const chunks: LocatedChunk[] = [];
    for (const segment of segments) {
      let startLine = 1;
      for (let offset = 0; offset < segment.content.length || (offset === 0 && segment.content.length === 0); offset += size) {
        const content = segment.content.slice(offset, offset + size);
        const lineCount = content ? content.split('\n').length - 1 : 0;
        chunks.push({
          content,
          location: {
            sourcePath: segment.sourcePath,
            startLine,
            endLine: startLine + lineCount,
            startChar: offset,
            endChar: offset + content.length,
          },
        });
        startLine += lineCount;
        if (!segment.content.length) break;
      }
    }
    return chunks;
  }

  private extractEntities(segments: FetchedSegment[]) {
    const entities: Array<{ name: string; kind: string; sourcePath: string }> = [];
    const seen = new Set<string>();
    const patterns = [
      { kind: 'heading', pattern: /^#{1,6}\s+(.+)$/gm },
      { kind: 'symbol', pattern: /\b(?:class|interface|type|function|enum|model)\s+([A-Za-z_$][\w$]*)/g },
    ];
    for (const segment of segments) {
      for (const { kind, pattern } of patterns) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(segment.content)) && entities.length < 500) {
          const name = match[1].trim().slice(0, 200);
          const key = `${segment.sourcePath}|${kind}|${name.toLowerCase()}`;
          if (!name || seen.has(key)) continue;
          seen.add(key);
          entities.push({ name, kind, sourcePath: segment.sourcePath });
        }
      }
    }
    return entities;
  }

  private extractRelations(segments: FetchedSegment[]) {
    const paths = new Set(segments.map((segment) => segment.sourcePath));
    const relations: Array<{ sourcePath: string; targetPath: string; relation: string }> = [];
    const seen = new Set<string>();
    for (const segment of segments) {
      const references: Array<{ value: string; relation: string }> = [];
      const importPattern = /(?:from\s+|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
      const markdownPattern = /\[[^\]]+\]\(([^)]+)\)/g;
      let match: RegExpExecArray | null;
      while ((match = importPattern.exec(segment.content))) references.push({ value: match[1], relation: 'imports' });
      while ((match = markdownPattern.exec(segment.content))) references.push({ value: match[1], relation: 'links_to' });
      for (const reference of references) {
        const targetPath = this.resolveSourceReference(segment.sourcePath, reference.value, paths);
        if (!targetPath || targetPath === segment.sourcePath) continue;
        const key = `${segment.sourcePath}|${targetPath}|${reference.relation}`;
        if (seen.has(key)) continue;
        seen.add(key);
        relations.push({ sourcePath: segment.sourcePath, targetPath, relation: reference.relation });
      }
    }
    return relations;
  }

  private resolveSourceReference(sourcePath: string, reference: string, paths: Set<string>) {
    const clean = reference.split(/[?#]/)[0].replace(/\\/g, '/');
    if (!clean || /^[a-z]+:/i.test(clean) || clean.startsWith('#')) return undefined;
    const base = clean.startsWith('.') ? posix.normalize(posix.join(posix.dirname(sourcePath), clean)) : posix.normalize(clean);
    const variants = [
      base,
      `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.json`, `${base}.md`,
      posix.join(base, 'index.ts'), posix.join(base, 'index.tsx'), posix.join(base, 'index.js'),
    ];
    return variants.find((candidate) => paths.has(candidate));
  }

  private async assertRunActive(runId: string, workerId: string | undefined, leaseMs: number) {
    const run = await this.prisma.ingestRun.findUnique({
      where: { id: runId },
      select: { cancelRequested: true, leaseOwner: true },
    });
    if (run?.cancelRequested) throw new Error('Run cancelled');
    if (workerId && run?.leaseOwner !== workerId) throw new Error('Run lease lost');
    if (workerId) {
      const refreshed = await this.prisma.ingestRun.updateMany({
        where: { id: runId, leaseOwner: workerId },
        data: { lockedAt: new Date(), leaseExpiresAt: new Date(Date.now() + leaseMs) },
      });
      if (!refreshed.count) throw new Error('Run lease lost');
    }
  }

  private async advanceRun(runId: string, workerId: string | undefined, leaseMs: number, stage: string) {
    const advanced = await this.prisma.ingestRun.updateMany({
      where: { id: runId, ...(workerId ? { leaseOwner: workerId } : {}) },
      data: {
        status: stage,
        stage,
        lockedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + leaseMs),
      },
    });
    if (!advanced.count) throw new Error(workerId ? 'Run lease lost' : 'Run not found');
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private async assertNotCancelled(runId: string) {
    const run = await this.prisma.ingestRun.findUnique({ where: { id: runId }, select: { cancelRequested: true } });
    if (run?.cancelRequested) throw new Error('Run cancelled');
  }

  private async assertRequesterStillAuthorized(run: any): Promise<string[]> {
    if (run.requestedByAgentId) {
      const [grant, credential] = await Promise.all([
        this.prisma.agentGrant.findUnique({
          where: { agentId_spaceId: { agentId: run.requestedByAgentId, spaceId: run.spaceId } },
          include: {
            agent: { select: { status: true, revokedAt: true, owner: { select: { deletedAt: true, lockedAt: true } } } },
            space: { select: { deletedAt: true } },
          },
        }),
        run.requestedCredentialId && run.requestedCredentialType === 'agent'
          ? this.prisma.agentCredential.findFirst({
              where: {
                id: run.requestedCredentialId,
                agentId: run.requestedByAgentId,
                revokedAt: null,
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              },
              select: { scopes: true },
            })
          : Promise.resolve(null),
      ]);
      if (!grant || grant.role !== 'editor' || grant.agent.status !== 'active' || grant.agent.revokedAt ||
        grant.agent.owner.deletedAt || grant.agent.owner.lockedAt || grant.space.deletedAt || !credential?.scopes.includes('runs:write')) {
        throw new Error('Run requester is no longer authorized');
      }
      return grant.scopes.length > 0
        ? credential.scopes.filter((scope) => grant.scopes.includes(scope))
        : credential.scopes;
    }
    const requester = run.requestedByUserId ? await this.prisma.user.findUnique({
      where: { id: run.requestedByUserId },
      select: { deletedAt: true, lockedAt: true, type: true, platformRole: true },
    }) : null;
    if (!requester || requester.deletedAt || requester.lockedAt || requester.type !== 'human') {
      throw new Error('Run requester is no longer authorized');
    }
    if (requester.platformRole === 'super_admin') {
      if (run.requestedCredentialType === 'personal') {
        const credential = run.requestedCredentialId ? await this.prisma.apiKeyCredential.findFirst({
          where: {
            id: run.requestedCredentialId,
            userId: run.requestedByUserId,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          select: { scopes: true },
        }) : null;
        if (!credential) throw new Error('Run requester is no longer authorized');
        return credential.scopes;
      }
      return [];
    }
    const membership = await this.prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId: run.requestedByUserId, spaceId: run.spaceId } },
      include: {
        user: { select: { deletedAt: true, type: true } },
        space: { select: { deletedAt: true } },
      },
    });
    if (!membership || !['owner', 'admin', 'editor'].includes(membership.role) || membership.space.deletedAt ||
      membership.user.deletedAt || membership.user.type !== 'human') {
      throw new Error('Run requester is no longer authorized');
    }
    if (run.requestedCredentialType === 'personal') {
      const credential = run.requestedCredentialId ? await this.prisma.apiKeyCredential.findFirst({
        where: {
          id: run.requestedCredentialId,
          userId: run.requestedByUserId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { scopes: true },
      }) : null;
      if (!credential) throw new Error('Run requester is no longer authorized');
      return credential.scopes;
    }
    return [];
  }

  private auditRun(run: any, outcome: string, error?: string) {
    if (run.requestedByAgentId) {
      return this.prisma.agentAuditEvent.create({
        data: { agentId: run.requestedByAgentId, action: 'ingest.run.process', outcome, resourceType: 'IngestRun', resourceId: run.id, metadata: error ? { error } : undefined },
      });
    }
    return this.prisma.securityAuditEvent.create({
      data: { actorUserId: run.requestedByUserId, action: 'ingest.run.process', outcome, metadata: { runId: run.id, ...(error ? { error } : {}) } },
    });
  }

  private async safeAuditRun(run: any, outcome: string, error?: string) {
    try {
      await this.auditRun(run, outcome, error);
    } catch (auditError) {
      this.logger.error('Ingest run audit failed', auditError instanceof Error ? auditError.stack || auditError.message : String(auditError));
    }
  }
}
