import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CollaborationTemplateDefinitionSchema,
  type CollaborationTemplateDefinition,
} from '@neomei/agentwiki-sync-protocol';
import { AuthorizationService, type Principal, type SpaceRole } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { PrismaService } from '../database/prisma.service';
import type {
  CreateRunDraftDto,
  ReassignTaskDto,
  RunActionDto,
  StartRunDto,
  UpdateRunDraftDto,
  ValidateRunDraftDto,
} from './run.dto';
import { canonicalRequestHash, RunEventStore } from './run-event.store';
import { hashCollaborationTemplate } from './template-validator';
import { ProgressionService } from './progression.service';
import { CollaborationEventsService } from './collaboration-events.service';
import { HISTORY_KINDS, HistoryCursorService, type HistoryKind, type HistoryPosition, type RunListStatus } from './history-cursor.service';
import { withCollaborationSerializableRetry } from './serializable-retry';
import { reviewerMemberIssues, rolesAtLeast } from './reviewer-members';
import { RunExpansionService } from './run-expansion.service';
import { assertCollaborationAgentGrantsExecutable } from './agent-readiness';
import { parseCollaborationInputs } from './run-input-validation';
import { supersedeRunPagePublicationsLocked } from './page-publication-invalidation';
import { canonicalPageContentHash } from './page-baseline';
import { PageResultService } from './page-result.service';

const READ_ROLES: SpaceRole[] = ['owner', 'admin', 'editor', 'viewer'];
const EDIT_ROLES: SpaceRole[] = ['owner', 'admin', 'editor'];
const MANAGE_ROLES: SpaceRole[] = ['owner', 'admin'];
const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;
type RoleBindingInput = { roleSlotId: string; agentId: string };
type Tx = Prisma.TransactionClient;

const HUMAN_TODO_DETAIL_SELECT = {
  id: true, runId: true, taskId: true, generation: true, templateId: true, ordinal: true,
  name: true, required: true, status: true, summary: true, evidence: true, createdAt: true, updatedAt: true,
} satisfies Prisma.CollaborationTaskTodoSelect;

const HUMAN_TODO_PREVIEW_SELECT = {
  id: true, taskId: true, generation: true, ordinal: true, name: true, required: true, status: true,
} satisfies Prisma.CollaborationTaskTodoSelect;

const HUMAN_ATTEMPT_SELECT = {
  id: true, runId: true, taskId: true, generation: true, agentId: true, attemptNumber: true,
  status: true, leaseStartedAt: true, leaseExpiresAt: true, maxExecutionAt: true,
  failureCode: true, repairCount: true, finishedAt: true, createdAt: true, updatedAt: true,
  basePageVersionId: true, basePageUpdatedAt: true, baseContentHash: true,
} satisfies Prisma.CollaborationTaskAttemptSelect;

const HUMAN_ARTIFACT_DETAIL_SELECT = {
  id: true, runId: true, taskId: true, attemptId: true, generation: true, version: true,
  kind: true, status: true, payload: true, evidence: true, acceptedAt: true, createdAt: true,
} satisfies Prisma.CollaborationTaskArtifactSelect;

const HUMAN_ARTIFACT_PREVIEW_SELECT = {
  id: true, taskId: true, generation: true, version: true, kind: true, status: true, createdAt: true,
} satisfies Prisma.CollaborationTaskArtifactSelect;

const HUMAN_REVIEW_DETAIL_SELECT = {
  id: true, runId: true, nodeId: true, revision: true, generation: true, sourceTaskId: true,
  artifactId: true, revisionTaskId: true, minimumRole: true, reviewerUserIds: true,
  allowTerminate: true, status: true, reviewerUserId: true, reason: true, decidedAt: true,
  createdAt: true,
} satisfies Prisma.CollaborationReviewSelect;

const HUMAN_REVIEW_PREVIEW_SELECT = {
  id: true, nodeId: true, generation: true, sourceTaskId: true, artifactId: true, revisionTaskId: true,
  minimumRole: true, reviewerUserIds: true, allowTerminate: true, status: true, createdAt: true,
} satisfies Prisma.CollaborationReviewSelect;

const HUMAN_EVENT_DETAIL_SELECT = {
  id: true, runId: true, sequence: true, type: true, actorKind: true, actorId: true,
  operation: true, target: true, actorUserId: true, actorAgentId: true, metadata: true,
  createdAt: true,
} satisfies Prisma.CollaborationRunEventSelect;

const HUMAN_EVENT_PREVIEW_SELECT = {
  id: true, sequence: true, type: true, actorKind: true, operation: true, target: true, createdAt: true,
} satisfies Prisma.CollaborationRunEventSelect;

const HUMAN_RUN_MAX_SERIALIZED_BYTES = 512_000;
const HUMAN_HISTORY_MAX_SERIALIZED_BYTES = 4_000_000;
// One legal 1 MB Markdown/evidence-summary payload can expand to 6 MB when every
// byte is JSON-escaped. Fifty 2,048-character Evidence references add < 0.7 MB;
// 8 MB leaves > 1 MB for the fixed row/page envelope while remaining bounded.
const HUMAN_ARTIFACT_HISTORY_MAX_SERIALIZED_BYTES = 8_000_000;
const HUMAN_ARTIFACT_HISTORY_MAX_PAGE = 1;
const HUMAN_PAGE_COMPARISON_MAX_SERIALIZED_BYTES = 8_000_000;
const HUMAN_TODO_PREVIEW_LIMIT = 3;
const HUMAN_EVENT_PREVIEW_LIMIT = 20;
const ACTIVE_RUN_STATUSES = ['draft', 'ready', 'running', 'waiting_review', 'paused'] as const;
const HISTORY_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;

const HUMAN_RUN_SUMMARY_SELECT = {
  id: true, name: true, status: true, templateId: true, templateVersion: true,
  createdAt: true, updatedAt: true, startedAt: true, finishedAt: true,
} satisfies Prisma.CollaborationRunSelect;

const HUMAN_RUN_SELECT = {
  id: true,
  spaceId: true,
  templateId: true,
  templateVersion: true,
  snapshotHash: true,
  name: true,
  status: true,
  version: true,
  startedById: true,
  pauseReason: true,
  eventSequence: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true,
  templateSnapshot: true,
  roleBindings: {
    select: { id: true, runId: true, roleSlotId: true, roleSlotName: true, agentId: true },
  },
  tasks: {
    orderBy: { ordinal: 'asc' },
    select: {
      id: true,
      runId: true,
      nodeId: true,
      ordinal: true,
      name: true,
      objective: true,
      roleSlotId: true,
      assigneeAgentId: true,
      status: true,
      generation: true,
      dependencyMode: true,
      skippable: true,
      nextAttemptAt: true,
      completedAt: true,
      targetPageId: true,
      targetSpaceId: true,
      basePageVersionId: true,
      basePageUpdatedAt: true,
      baseContentHash: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.CollaborationRunSelect;

@Injectable()
export class RunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly events: RunEventStore,
    private readonly progression: ProgressionService,
    private readonly notifications: CollaborationEventsService,
    private readonly historyCursors: HistoryCursorService,
    private readonly expansion: RunExpansionService,
    private readonly pageResults: PageResultService,
  ) {}

  async createDraft(spaceId: string, body: CreateRunDraftDto, principal: Principal) {
    if (principal.agentId) throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
    const receipt = await withCollaborationSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      await this.assertLiveHumanAccess(tx, principal, spaceId, EDIT_ROLES);
      const template = await this.loadTemplate(tx, spaceId, body.templateId);
      const definition = parseDefinition(template.definition);
      const inputs = parseCollaborationInputs(definition, body.inputs);
      const bindings = this.normalizeBindings(definition, body.roleBindings, true);
      const run = await tx.collaborationRun.create({
        data: {
          spaceId,
          templateId: template.id,
          templateVersion: template.version,
          templateSnapshot: toJson({}),
          snapshotHash: hashJson({}),
          name: body.name.trim(),
          status: 'draft',
          version: 1,
          inputs: toJson(inputs),
          startedById: principal.userId,
        },
      });
      if (bindings.length > 0) {
        await tx.collaborationRoleBinding.createMany({
          data: bindings.map((binding) => ({ runId: run.id, ...binding })),
        });
      }
      return { runId: run.id, status: run.status, version: run.version };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    await this.notifications.publishCurrentRun(receipt.runId);
    return this.loadHumanRun(this.prisma as unknown as Tx, receipt.runId);
  }

  async updateDraft(spaceId: string, runId: string, body: UpdateRunDraftDto, principal: Principal) {
    if (principal.agentId) throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
    await withCollaborationSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      await this.assertLiveHumanAccess(tx, principal, spaceId, EDIT_ROLES);
      const current = await tx.collaborationRun.findFirst({
        where: { id: runId, spaceId, status: { in: ['draft', 'ready'] }, version: body.expectedVersion },
      });
      if (!current) throw new BusinessException('COLLABORATION_RUN_VERSION_CONFLICT');
      const template = await this.loadLegacyRunTemplate(tx, spaceId, current);
      const definition = parseDefinition(template.definition);
      const inputs = body.inputs === undefined ? undefined : parseCollaborationInputs(definition, body.inputs);
      if (body.roleBindings) {
        const bindings = this.normalizeBindings(definition, body.roleBindings);
        await tx.collaborationRoleBinding.deleteMany({ where: { runId } });
        await tx.collaborationRoleBinding.createMany({
          data: bindings.map((binding) => ({ runId, ...binding })),
        });
      }
      const updated = await tx.collaborationRun.updateMany({
        where: { id: runId, spaceId, status: { in: ['draft', 'ready'] }, version: body.expectedVersion },
        data: {
          status: 'draft',
          ...(body.name === undefined ? {} : { name: body.name.trim() }),
          ...(inputs === undefined ? {} : { inputs: toJson(inputs) }),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new BusinessException('COLLABORATION_RUN_VERSION_CONFLICT');
      return { runId, status: 'draft' as const, version: body.expectedVersion + 1 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    await this.notifications.publishCurrentRun(runId);
    return this.loadHumanRun(this.prisma as unknown as Tx, runId);
  }

  async validateDraft(
    spaceId: string,
    runId: string,
    body: ValidateRunDraftDto,
    principal: Principal,
  ) {
    if (principal.agentId) throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
    await withCollaborationSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      await this.assertLiveHumanAccess(tx, principal, spaceId, EDIT_ROLES);
      const run = await tx.collaborationRun.findFirst({
        where: { id: runId, spaceId, status: 'draft', version: body.expectedVersion },
      });
      if (!run) throw new BusinessException('COLLABORATION_RUN_VERSION_CONFLICT');
      const template = await this.loadLegacyRunTemplate(tx, spaceId, run);
      const definition = parseDefinition(template.definition);
      const bindings = await this.loadBindings(tx, runId, run);
      parseCollaborationInputs(definition, run.inputs);
      this.normalizeBindings(definition, bindings);
      await this.assertReviewerMembers(tx, spaceId, definition);
      await this.validateFreshAgents(tx, spaceId, bindings.map((binding) => binding.agentId));
      const updated = await tx.collaborationRun.updateMany({
        where: { id: runId, spaceId, status: 'draft', version: body.expectedVersion },
        data: { status: 'ready', version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new BusinessException('COLLABORATION_RUN_VERSION_CONFLICT');
      return { runId, status: 'ready' as const, version: body.expectedVersion + 1 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    await this.notifications.publishCurrentRun(runId);
    return this.loadHumanRun(this.prisma as unknown as Tx, runId);
  }

  async startRun(spaceId: string, runId: string, body: StartRunDto, principal: Principal) {
    if (principal.agentId) throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
    await withCollaborationSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      await this.assertLiveHumanAccess(tx, principal, spaceId, EDIT_ROLES);
      const scopedRun = await tx.collaborationRun.findFirst({
        where: { id: runId, spaceId },
        select: { id: true },
      });
      if (!scopedRun) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
      return this.events.executeIdempotent(tx, {
        runId,
        actorKind: 'human',
        actorId: principal.userId,
        actorUserId: principal.userId,
        operation: 'start_run',
        target: runId,
        key: body.idempotencyKey,
        requestHash: canonicalRequestHash({ expectedVersion: body.expectedVersion }),
      }, async () => {
        const run = await tx.collaborationRun.findFirst({
          where: { id: runId, spaceId, status: 'ready', version: body.expectedVersion },
        });
        if (!run) throw new BusinessException('COLLABORATION_RUN_VERSION_CONFLICT');
        const template = await this.loadLegacyRunTemplate(tx, spaceId, run);
        const definition = parseDefinition(template.definition);
        const bindings = await this.loadBindings(tx, runId, run);
        parseCollaborationInputs(definition, run.inputs);
        this.normalizeBindings(definition, bindings);
        await this.assertReviewerMembers(tx, spaceId, definition);
        await this.validateFreshAgents(tx, spaceId, bindings.map((binding) => binding.agentId));
        const snapshot = structuredClone(definition);
        const updated = await tx.collaborationRun.update({
          where: { id: runId },
          data: {
            templateVersion: template.version,
            templateSnapshot: toJson(snapshot),
            snapshotHash: hashCollaborationTemplate(snapshot),
            status: 'running',
            startedAt: new Date(),
            version: { increment: 1 },
          },
        });
        const agentByRole = new Map(bindings.map((binding) => [binding.roleSlotId, binding.agentId]));
        const assignments = new Map(definition.nodes.flatMap((node) => node.kind === 'agent_task'
          ? [[node.id, { agentId: agentByRole.get(node.roleSlotId)! }] as const]
          : []));
        await this.expansion.expand(tx, runId, definition, assignments);
        return { runId, status: updated.status, version: updated.version };
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    await this.notifications.publishCurrentRun(runId);
    return this.loadHumanRun(this.prisma as unknown as Tx, runId);
  }

  async listRuns(
    spaceId: string,
    status: string,
    cursor: string | undefined,
    limit: string | undefined,
    principal: Principal,
  ) {
    await this.assertHumanAccess(principal, spaceId, READ_ROLES);
    const listStatus = parseRunListStatus(status);
    const pageSize = parseRunListLimit(limit ?? '100');
    const position = cursor ? this.historyCursors.decodeRunList(cursor, spaceId, listStatus) : undefined;
    const statusValues = listStatus === 'active' ? ACTIVE_RUN_STATUSES : HISTORY_RUN_STATUSES;
    const rows = await this.prisma.collaborationRun.findMany({
      where: {
        spaceId,
        status: { in: [...statusValues] },
        ...(position ? timestampKeyset('createdAt', position) : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
      select: HUMAN_RUN_SUMMARY_SELECT,
    });
    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize).map(runSummary);
    const last = hasMore ? items[items.length - 1] : undefined;
    const nextCursor = last
      ? this.historyCursors.encodeRunList({
        spaceId, status: listStatus, position: { at: new Date(last.createdAt).toISOString(), id: last.id },
      })
      : null;
    return { items, nextCursor };
  }

  async getHumanRun(spaceId: string, runId: string, principal: Principal) {
    const member = await this.assertLiveHumanAccess(
      this.prisma as unknown as Tx,
      principal,
      spaceId,
      READ_ROLES,
    );
    const run = await this.prisma.collaborationRun.findFirst({ where: { id: runId, spaceId } });
    if (!run) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
    return this.loadHumanRun(this.prisma as unknown as Tx, runId, {
      userId: principal.userId,
      role: member.role,
    });
  }

  async getHumanRunDraftDetails(spaceId: string, runId: string, principal: Principal) {
    await this.assertHumanAccess(principal, spaceId, READ_ROLES);
    const run = await this.prisma.collaborationRun.findFirst({
      where: { id: runId, spaceId, status: { in: ['draft', 'ready'] } },
      select: {
        id: true, name: true, status: true, version: true, inputs: true, updatedAt: true,
        roleBindings: { select: { roleSlotId: true, roleSlotName: true, agentId: true } },
      },
    });
    if (!run) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration draft not found');
    return run;
  }

  async getHumanRunHistory(
    spaceId: string,
    runId: string,
    kind: string,
    cursor: string | undefined,
    limit: string | undefined,
    principal: Principal,
  ) {
    await this.assertHumanAccess(principal, spaceId, READ_ROLES);
    const run = await this.prisma.collaborationRun.findFirst({
      where: { id: runId, spaceId },
      select: { id: true },
    });
    if (!run) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
    const historyKind = parseHistoryKind(kind);
    const pageSize = parseHistoryLimit(limit ?? '50');
    const materializedPageSize = historyKind === 'artifacts'
      ? Math.min(pageSize, HUMAN_ARTIFACT_HISTORY_MAX_PAGE)
      : pageSize;
    const position = cursor ? this.historyCursors.decode(cursor, historyKind, runId) : undefined;
    let rows: any[];
    if (historyKind === 'events') {
      const sequence = position && 'sequence' in position ? position.sequence : undefined;
      rows = await this.prisma.collaborationRunEvent.findMany({
        where: { runId, ...(sequence === undefined ? {} : { sequence: { lt: sequence } }) },
        orderBy: { sequence: 'desc' },
        take: materializedPageSize + 1,
        select: HUMAN_EVENT_DETAIL_SELECT,
      });
    } else {
      const timestampPosition = position && 'at' in position ? position : undefined;
      const timestampField = 'createdAt';
      const timestampWhere = timestampPosition
        ? timestampKeyset(timestampField, timestampPosition)
        : {};
      const query = {
        where: { runId, ...timestampWhere },
        orderBy: [{ [timestampField]: 'desc' as const }, { id: 'desc' as const }],
        take: materializedPageSize + 1,
      };
      if (historyKind === 'todos') {
        rows = await this.prisma.collaborationTaskTodo.findMany({ ...query, select: HUMAN_TODO_DETAIL_SELECT } as any);
      } else if (historyKind === 'attempts') {
        rows = await this.prisma.collaborationTaskAttempt.findMany({ ...query, select: HUMAN_ATTEMPT_SELECT } as any);
      } else if (historyKind === 'artifacts') {
        rows = await this.prisma.collaborationTaskArtifact.findMany({ ...query, select: HUMAN_ARTIFACT_DETAIL_SELECT } as any);
      } else {
        rows = await this.prisma.collaborationReview.findMany({ ...query, select: HUMAN_REVIEW_DETAIL_SELECT } as any);
      }
    }
    const hasMore = rows.length > materializedPageSize;
    const items = rows.slice(0, materializedPageSize);
    let nextCursor: string | null = null;
    if (hasMore && items.length) {
      const last = items[items.length - 1]!;
      const nextPosition: HistoryPosition = historyKind === 'events'
        ? { sequence: last.sequence }
        : { at: new Date(last.createdAt).toISOString(), id: last.id };
      nextCursor = this.historyCursors.encode({ kind: historyKind, runId, position: nextPosition });
    }
    const page = { items, nextCursor };
    const serializedBudget = historyKind === 'artifacts'
      ? HUMAN_ARTIFACT_HISTORY_MAX_SERIALIZED_BYTES
      : HUMAN_HISTORY_MAX_SERIALIZED_BYTES;
    if (Buffer.byteLength(JSON.stringify(page), 'utf8') > serializedBudget) {
      throw new BusinessException('COLLABORATION_HISTORY_PAGE_TOO_LARGE', 'Reduce the History page limit');
    }
    return page;
  }

  async getHumanArtifact(spaceId: string, runId: string, artifactId: string, principal: Principal) {
    await this.assertHumanAccess(principal, spaceId, READ_ROLES);
    const run = await this.prisma.collaborationRun.findFirst({
      where: { id: runId, spaceId },
      select: { id: true },
    });
    if (!run) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
    const artifact = await this.prisma.collaborationTaskArtifact.findFirst({
      where: { id: artifactId, runId },
      select: HUMAN_ARTIFACT_DETAIL_SELECT,
    });
    if (!artifact) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration Artifact not found');
    return artifact;
  }

  async getHumanPageReviewComparison(
    spaceId: string,
    runId: string,
    reviewId: string,
    principal: Principal,
  ) {
    const member = await this.assertLiveHumanAccess(
      this.prisma as unknown as Tx, principal, spaceId, READ_ROLES,
    );
    const run = await this.prisma.collaborationRun.findFirst({
      where: { id: runId, spaceId }, select: { id: true, spaceId: true },
    });
    if (!run) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
    const review = await this.prisma.collaborationReview.findFirst({
      where: { id: reviewId, runId },
      select: {
        id: true, runId: true, sourceTaskId: true, artifactId: true, status: true,
        minimumRole: true, reviewerUserIds: true,
      },
    });
    if (!review) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration review not found');
    const artifact = await this.prisma.collaborationTaskArtifact.findFirst({
      where: { id: review.artifactId, runId, taskId: review.sourceTaskId },
      select: {
        id: true, runId: true, taskId: true, attemptId: true, status: true,
        payload: true, evidence: true,
        attempt: { select: {
          id: true, basePageVersionId: true, basePageUpdatedAt: true, baseContentHash: true,
        } },
      },
    });
    if (!artifact) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration Artifact not found');
    const link = await this.prisma.collaborationArtifactChangeSetLink.findUnique({
      where: { artifactId: artifact.id },
      include: { changeSet: { select: { status: true } } },
    });
    const canDecide = await this.canDecideHumanReview(
      spaceId, review, member.role, principal.userId,
    );
    if (!link) {
      const adopted = adoptedCurrentPage(artifact.payload);
      if (!adopted) throw new BusinessException('RESOURCE_NOT_FOUND', 'Page review comparison not found');
      const [page, pageVersion] = await Promise.all([
        this.prisma.page.findFirst({
          where: { id: adopted.pageId, spaceId, deletedAt: null },
          select: {
            id: true, title: true, content: true, updatedAt: true,
            slug: true, format: true, parentId: true, folderId: true,
            syncPath: true, syncPathKey: true,
          },
        }),
        this.prisma.pageVersion.findFirst({
          where: { id: adopted.pageVersionId, pageId: adopted.pageId },
          select: { id: true, pageId: true, title: true, content: true, createdAt: true },
        }),
      ]);
      if (!page || !pageVersion || canonicalPageContentHash(pageVersion.content) !== adopted.contentHash) {
        throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Adopted Page result is inconsistent');
      }
      const currentHash = canonicalPageContentHash(page.content);
      const currentPageVersionId = await this.pageResults.readCurrentPageVersionLocked(
        this.prisma as unknown as Tx, page,
      );
      return ensureComparisonBudget({
        mode: 'adopted_current' as const,
        reviewId: review.id,
        artifactId: artifact.id,
        canDecide,
        target: { pageId: page.id, title: page.title },
        adoptedCurrent: { ...adopted, markdown: pageVersion.content, title: pageVersion.title },
        current: {
          pageVersionId: currentPageVersionId,
          updatedAt: page.updatedAt.toISOString(),
          contentHash: currentHash,
          markdown: page.content,
        },
        conflict: currentPageVersionId !== adopted.pageVersionId,
      });
    }
    if (link.runId !== runId || link.taskId !== review.sourceTaskId || link.spaceId !== spaceId) {
      throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Page result Link does not match the Review');
    }
    const page = await this.prisma.page.findFirst({
      where: { id: link.pageId, spaceId, deletedAt: null },
      select: {
        id: true, title: true, content: true, updatedAt: true,
        slug: true, format: true, parentId: true, folderId: true,
        syncPath: true, syncPathKey: true,
      },
    });
    if (!page) throw new BusinessException('RESOURCE_NOT_FOUND', 'Target Page not found');
    const attempt = artifact.attempt;
    const currentHash = canonicalPageContentHash(page.content);
    const currentPageVersionId = await this.pageResults.readCurrentPageVersionLocked(
      this.prisma as unknown as Tx, page,
    );
    const matchesBaseline = !!attempt.basePageUpdatedAt && !!attempt.baseContentHash
      && page.updatedAt.toISOString() === attempt.basePageUpdatedAt.toISOString()
      && currentHash === attempt.baseContentHash
      && currentPageVersionId === attempt.basePageVersionId;
    const exactVersion = attempt.basePageVersionId
      ? await this.prisma.pageVersion.findFirst({
        where: { id: attempt.basePageVersionId, pageId: page.id },
        select: { id: true, title: true, content: true, createdAt: true },
      })
      : null;
    if (attempt.basePageVersionId && !exactVersion) {
      throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Attempt PageVersion baseline is missing');
    }
    const markdown = artifactMarkdown(artifact.payload);
    return ensureComparisonBudget({
      mode: 'candidate' as const,
      reviewId: review.id,
      artifactId: artifact.id,
      canDecide,
      target: { pageId: page.id, title: page.title },
      baseline: {
        pageVersionId: attempt.basePageVersionId,
        updatedAt: attempt.basePageUpdatedAt?.toISOString() ?? null,
        contentHash: attempt.baseContentHash,
        available: !!exactVersion || matchesBaseline,
        title: exactVersion?.title ?? (matchesBaseline ? page.title : null),
        markdown: exactVersion?.content ?? (matchesBaseline ? page.content : null),
      },
      candidate: {
        changeSetId: link.changeSetId,
        changeSetStatus: link.changeSet.status,
        markdown,
        evidence: artifact.evidence,
      },
      current: {
        pageVersionId: currentPageVersionId,
        updatedAt: page.updatedAt.toISOString(),
        contentHash: currentHash,
        markdown: page.content,
      },
      conflict: !matchesBaseline,
    });
  }

  pauseRun(runId: string, body: RunActionDto, principal: Principal, expectedSpaceId?: string) {
    return this.mutateRun(runId, 'pause_run', body, principal, false, async (tx, run) => {
      if (!['running', 'waiting_review'].includes(run.status)) throw this.runStateError(run.status);
      await this.invalidateAttempts(tx, runId, body.reason);
      await tx.collaborationRunTask.updateMany({
        where: { runId, status: { in: ['claimed', 'running'] } },
        data: { status: 'ready', nextAttemptAt: null },
      });
      await tx.collaborationRun.update({ where: { id: runId }, data: { status: 'paused', pauseReason: body.reason } });
    }, runId, expectedSpaceId);
  }

  resumeRun(runId: string, body: RunActionDto, principal: Principal, expectedSpaceId?: string) {
    return this.mutateRun(runId, 'resume_run', body, principal, false, async (tx, run) => {
      if (run.status !== 'paused') throw this.runStateError(run.status);
      if (run.pauseReason === 'page_version_conflict') {
        throw new BusinessException(
          'COLLABORATION_PROGRESS_INVARIANT',
          'Resolve the Page version conflict before resuming this Run',
        );
      }
      await tx.collaborationRun.update({ where: { id: runId }, data: { status: 'running', pauseReason: null } });
      await this.progression.advanceRun(tx, runId, `human-resume:${body.idempotencyKey}`, false);
    }, runId, expectedSpaceId);
  }

  failRun(runId: string, body: RunActionDto, principal: Principal, expectedSpaceId?: string) {
    return this.mutateRun(runId, 'fail_run', body, principal, true, async (tx, run) => {
      this.assertNotTerminal(run.status);
      await this.invalidateAttempts(tx, runId, body.reason);
      await supersedeRunPagePublicationsLocked(tx, { runId });
      await tx.collaborationRun.update({ where: { id: runId }, data: { status: 'failed', finishedAt: new Date() } });
    }, runId, expectedSpaceId);
  }

  cancelRun(runId: string, body: RunActionDto, principal: Principal, expectedSpaceId?: string) {
    return this.mutateRun(runId, 'cancel_run', body, principal, true, async (tx, run) => {
      this.assertNotTerminal(run.status);
      await this.invalidateAttempts(tx, runId, body.reason);
      await supersedeRunPagePublicationsLocked(tx, { runId });
      await tx.collaborationRun.update({ where: { id: runId }, data: { status: 'cancelled', finishedAt: new Date() } });
    }, runId, expectedSpaceId);
  }

  retryTask(runId: string, taskId: string, body: RunActionDto, principal: Principal, expectedSpaceId?: string) {
    return this.mutateRun(runId, 'retry_task', body, principal, false, async (tx, run) => {
      this.assertNotTerminal(run.status);
      const task = await tx.collaborationRunTask.findFirst({ where: { id: taskId, runId } });
      if (!task) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration task not found');
      if (!['failed', 'retry_wait'].includes(task.status)) {
        throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Only failed or waiting-retry tasks can be retried');
      }
      await this.invalidateAttempts(tx, runId, body.reason, taskId);
      const generation = task.generation + 1;
      await tx.collaborationRunTask.update({
        where: { id: taskId },
        data: { status: 'ready', generation, nextAttemptAt: null, completedAt: null },
      });
      await tx.collaborationTaskArtifact.updateMany({
        where: { runId, taskId, generation: task.generation, status: { in: ['pending', 'accepted'] } },
        data: { status: 'superseded' },
      });
      const node = snapshotNodes(run.templateSnapshot).find((item) => item.kind === 'agent_task' && item.id === task.nodeId);
      if (!node || node.kind !== 'agent_task') throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT');
      await tx.collaborationTaskTodo.createMany({
        data: node.todos.map((todo: any, ordinal: number) => ({
          runId,
          taskId,
          generation,
          templateId: todo.id,
          ordinal,
          name: todo.name,
          required: todo.required,
          status: 'pending',
        })),
      });
      await tx.collaborationRun.update({ where: { id: runId }, data: { status: 'running', pauseReason: null } });
      await this.progression.advanceRun(tx, runId, `human-retry:${body.idempotencyKey}`, false);
    }, taskId, expectedSpaceId);
  }

  reassignTask(runId: string, taskId: string, body: ReassignTaskDto, principal: Principal, expectedSpaceId?: string) {
    return this.mutateRun(runId, 'reassign_task', body, principal, false, async (tx, run) => {
      this.assertNotTerminal(run.status);
      const task = await tx.collaborationRunTask.findFirst({ where: { id: taskId, runId } });
      if (!task) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration task not found');
      if (['submitted', 'completed', 'skipped'].includes(task.status)) {
        throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'This task can no longer be reassigned');
      }
      await this.validateFreshAgents(tx, run.spaceId, [body.agentId]);
      await this.invalidateAttempts(tx, runId, body.reason, taskId);
      await supersedeRunPagePublicationsLocked(tx, { runId, taskIds: [taskId] });
      const active = ['claimed', 'running'].includes(task.status);
      await tx.collaborationRunTask.update({
        where: { id: taskId },
        data: {
          assigneeAgentId: body.agentId,
          ...(active ? { status: 'ready', nextAttemptAt: null } : {}),
        },
      });
    }, taskId, expectedSpaceId);
  }

  skipTask(runId: string, taskId: string, body: RunActionDto, principal: Principal, expectedSpaceId?: string) {
    return this.mutateRun(runId, 'skip_task', body, principal, true, async (tx, run) => {
      this.assertNotTerminal(run.status);
      const task = await tx.collaborationRunTask.findFirst({ where: { id: taskId, runId } });
      if (!task) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration task not found');
      if (!task.skippable) throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'This task is not skippable');
      if (['submitted', 'completed', 'skipped'].includes(task.status)) {
        throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'This task can no longer be skipped');
      }
      await this.invalidateAttempts(tx, runId, body.reason, taskId);
      await tx.collaborationRunTask.update({ where: { id: taskId }, data: { status: 'skipped', completedAt: new Date() } });
      await this.progression.advanceRun(tx, runId, `human-skip:${body.idempotencyKey}`, false);
    }, taskId, expectedSpaceId);
  }

  private async mutateRun(
    runId: string,
    operation: string,
    body: RunActionDto,
    principal: Principal,
    managersOnly: boolean,
    mutation: (tx: Tx, run: {
      id: string; spaceId: string; status: string; startedById: string; pauseReason: string | null;
      templateSnapshot: unknown;
    }) => Promise<void>,
    target = runId,
    expectedSpaceId?: string,
  ) {
    if (principal.agentId) throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
    await withCollaborationSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const current = await tx.collaborationRun.findUnique({
        where: { id: runId },
        select: {
          id: true, spaceId: true, status: true, startedById: true,
          pauseReason: true, templateSnapshot: true,
        },
      });
      if (!current || (expectedSpaceId !== undefined && current.spaceId !== expectedSpaceId)) {
        throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
      }
      const member = await this.assertLiveHumanAccess(
        tx,
        principal,
        current.spaceId,
        managersOnly ? MANAGE_ROLES : READ_ROLES,
      );
      const role = member.role as SpaceRole;
      if (managersOnly && !MANAGE_ROLES.includes(role)) {
        throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
      }
      if (!managersOnly && !MANAGE_ROLES.includes(role) && current.startedById !== principal.userId) {
        throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
      }
      let eventMetadata: Record<string, unknown> = { reason: body.reason };
      if (operation === 'reassign_task') {
        const task = await tx.collaborationRunTask.findFirst({
          where: { id: target, runId },
          select: { assigneeAgentId: true },
        });
        eventMetadata = {
          reason: body.reason,
          oldAgentId: task?.assigneeAgentId ?? null,
          newAgentId: (body as ReassignTaskDto).agentId,
        };
      }
      return this.events.executeIdempotent(tx, {
        runId,
        actorKind: 'human',
        actorId: principal.userId,
        actorUserId: principal.userId,
        operation,
        target,
        key: body.idempotencyKey,
        requestHash: canonicalRequestHash(body),
        metadata: eventMetadata,
      }, async () => {
        await mutation(tx, current);
        const updated = await tx.collaborationRun.findUnique({
          where: { id: runId },
          select: { id: true, status: true, version: true },
        });
        if (!updated) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
        return { runId: updated.id, status: updated.status, version: updated.version };
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    await this.notifications.publishCurrentRun(runId);
    return this.loadHumanRun(this.prisma as unknown as Tx, runId);
  }

  private async assertHumanAccess(principal: Principal, spaceId: string, roles: SpaceRole[]) {
    if (principal.agentId) throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
    try {
      return await this.authorization.assertSpaceAccess(principal, spaceId, roles);
    } catch (error) {
      if (error instanceof BusinessException && error.businessCode === 'SPACE_ACCESS_DENIED') {
        throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
      }
      throw error;
    }
  }

  private async canDecideHumanReview(
    spaceId: string,
    review: { status: string; minimumRole: string; reviewerUserIds: Prisma.JsonValue },
    role: SpaceRole,
    userId: string,
  ): Promise<boolean> {
    if (review.status !== 'pending' || !rolesAtLeast(review.minimumRole).includes(role)) return false;
    const reviewerUserIds = Array.isArray(review.reviewerUserIds)
      ? review.reviewerUserIds.filter((value): value is string => typeof value === 'string')
      : [];
    if (reviewerUserIds.length === 0 || reviewerUserIds.includes(userId)) return true;
    if (!['owner', 'admin'].includes(role)) return false;
    const eligible = await this.prisma.spaceMember.findMany({
      where: {
        spaceId,
        userId: { in: reviewerUserIds },
        role: { in: rolesAtLeast(review.minimumRole) },
        user: { type: 'human', deletedAt: null, lockedAt: null },
      },
      select: { userId: true },
      take: reviewerUserIds.length,
    });
    return eligible.length === 0;
  }

  private async assertLiveHumanAccess(tx: Tx, principal: Principal, spaceId: string, roles: SpaceRole[]) {
    try {
      return await this.authorization.assertLiveHumanSpaceAccess(tx, principal, spaceId, roles);
    } catch (error) {
      if (error instanceof BusinessException && error.businessCode === 'SPACE_ACCESS_DENIED') {
        throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
      }
      throw error;
    }
  }

  private async loadTemplate(tx: Tx, spaceId: string, templateId: string) {
    const template = await tx.collaborationTemplate.findFirst({
      where: {
        id: templateId,
        archivedAt: null,
        OR: [{ system: true, scopeKey: 'system', spaceId: null }, { system: false, spaceId, scopeKey: spaceId }],
      },
    });
    if (!template) throw new BusinessException('COLLABORATION_TEMPLATE_NOT_FOUND');
    return template;
  }

  private async loadLegacyRunTemplate(
    tx: Tx,
    spaceId: string,
    run: { templateId: string | null },
  ) {
    if (run.templateId === null) {
      throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', 'This operation requires a legacy collaboration template source');
    }
    return this.loadTemplate(tx, spaceId, run.templateId);
  }

  private normalizeBindings(
    definition: CollaborationTemplateDefinition,
    input: RoleBindingInput[],
    allowMissingRequired = false,
  ) {
    const slots = new Map(definition.roleSlots.map((slot) => [slot.id, slot]));
    const seen = new Set<string>();
    const bindings = input.map((binding) => {
      const slot = slots.get(binding.roleSlotId);
      if (!slot || seen.has(binding.roleSlotId)) {
        throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', 'Role bindings do not match the template');
      }
      seen.add(binding.roleSlotId);
      return { roleSlotId: slot.id, roleSlotName: slot.name, agentId: binding.agentId };
    });
    if (!allowMissingRequired && definition.roleSlots.some((slot) => slot.required && !seen.has(slot.id))) {
      throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', 'Required role bindings are missing');
    }
    return bindings;
  }

  private async validateFreshAgents(tx: Tx, spaceId: string, agentIds: string[]): Promise<void> {
    await assertCollaborationAgentGrantsExecutable(tx, spaceId, agentIds);
  }

  private async assertReviewerMembers(
    tx: Tx,
    spaceId: string,
    definition: CollaborationTemplateDefinition,
  ): Promise<void> {
    const issues = await reviewerMemberIssues(tx, spaceId, definition);
    if (issues.length) throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', undefined, { issues });
  }

  private async loadBindings(tx: Tx, runId: string, run: unknown): Promise<RoleBindingInput[]> {
    const embedded = (run as { roleBindings?: RoleBindingInput[] }).roleBindings;
    return embedded ?? tx.collaborationRoleBinding.findMany({ where: { runId } });
  }

  private async invalidateAttempts(tx: Tx, runId: string, reason: string, taskId?: string): Promise<void> {
    await tx.collaborationTaskAttempt.updateMany({
      where: { runId, ...(taskId ? { taskId } : {}), status: { in: ['claimed', 'running'] } },
      data: { status: 'invalidated', failureCode: reason.slice(0, 4_000), finishedAt: new Date() },
    });
  }

  private async loadHumanRun(
    tx: Tx,
    runId: string,
    reviewerContext?: { userId: string; role: SpaceRole },
  ) {
    const run = await tx.collaborationRun.findUnique({
      where: { id: runId },
      select: HUMAN_RUN_SELECT,
    });
    if (!run) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
    const roleBindings = run.roleBindings;
    const taskGenerations = run.tasks.map((task) => ({ taskId: task.id, generation: task.generation }));
    const taskByNodeId = new Map(run.tasks.map((task) => [task.nodeId, task]));
    const reviewNodes = snapshotNodes(run.templateSnapshot)
      .filter((node) => node.kind === 'human_review');
    const currentReviewLookups = reviewNodes.flatMap((node) => {
      const sourceTask = taskByNodeId.get(node.artifactTaskId);
      return sourceTask ? [{ nodeId: node.id, sourceTaskId: sourceTask.id, generation: sourceTask.generation }] : [];
    });
    const [todos, latestAttempts, latestArtifacts, reviews, newestEvents] = await Promise.all([
      tx.collaborationTaskTodo.findMany({
        where: { OR: taskGenerations },
        orderBy: [{ taskId: 'asc' }, { ordinal: 'asc' }],
        select: HUMAN_TODO_PREVIEW_SELECT,
      }),
      Promise.all(taskGenerations.map(({ taskId, generation }) => tx.collaborationTaskAttempt.findFirst({
        where: { taskId, generation },
        orderBy: { attemptNumber: 'desc' },
        select: HUMAN_ATTEMPT_SELECT,
      }))),
      Promise.all(taskGenerations.map(({ taskId, generation }) => tx.collaborationTaskArtifact.findFirst({
        where: { taskId, generation },
        orderBy: { version: 'desc' },
        select: HUMAN_ARTIFACT_PREVIEW_SELECT,
      }))),
      Promise.all(currentReviewLookups.map((lookup) => tx.collaborationReview.findFirst({
        where: { runId, ...lookup },
        orderBy: { revision: 'desc' },
        select: HUMAN_REVIEW_PREVIEW_SELECT,
      }))),
      tx.collaborationRunEvent.findMany({
        where: { runId },
        orderBy: { sequence: 'desc' },
        take: HUMAN_EVENT_PREVIEW_LIMIT,
        select: HUMAN_EVENT_PREVIEW_SELECT,
      }),
    ]);
    const currentReviews = reviews.filter((review): review is NonNullable<typeof review> => review !== null);
    const pagePublications = currentReviews.length === 0 ? []
      : await tx.collaborationArtifactChangeSetLink.findMany({
        where: {
          runId,
          artifactId: { in: currentReviews.map((review) => review.artifactId) },
        },
        select: { artifactId: true, pageId: true, changeSetId: true },
        take: currentReviews.length,
      });
    const pagePublicationByArtifact = new Map(pagePublications.map((item) => [item.artifactId, item]));
    const designatedReviewerIds = [...new Set(currentReviews.flatMap((review) =>
      Array.isArray(review.reviewerUserIds) ? review.reviewerUserIds.filter((id): id is string => typeof id === 'string') : []))];
    const eligibleReviewerRoles = reviewerContext && designatedReviewerIds.length
      ? new Map((await tx.spaceMember.findMany({
        where: {
          spaceId: run.spaceId,
          userId: { in: designatedReviewerIds },
          user: { type: 'human', deletedAt: null, lockedAt: null },
        },
        select: { userId: true, role: true },
      })).map((member) => [member.userId, member.role as SpaceRole]))
      : new Map<string, SpaceRole>();
    const reviewPreviews = currentReviews.map((review) => {
      const reviewerUserIds = Array.isArray(review.reviewerUserIds)
        ? review.reviewerUserIds.filter((id): id is string => typeof id === 'string')
        : [];
      const roleAllowed = !!reviewerContext && rolesAtLeast(review.minimumRole).includes(reviewerContext.role);
      const hasEligibleDesignatedReviewer = reviewerUserIds.some((reviewerId) => {
        const role = eligibleReviewerRoles.get(reviewerId);
        return !!role && rolesAtLeast(review.minimumRole).includes(role);
      });
      const canDecide = review.status === 'pending' && roleAllowed && (
        reviewerUserIds.length === 0
        || reviewerUserIds.includes(reviewerContext!.userId)
        || (['owner', 'admin'].includes(reviewerContext!.role) && !hasEligibleDesignatedReviewer)
      );
      return {
        ...review,
        reviewerUserIds,
        canDecide,
        approvalCriteria: stringArray(reviewNodes.find((node) => node.id === review.nodeId)?.approvalCriteria),
        pagePublication: pagePublicationByArtifact.get(review.artifactId) ?? null,
      };
    });
    const tasks = run.tasks.map((task, index) => {
      const currentTodos = todos.filter((todo) => todo.taskId === task.id);
      const { objective, ...taskFields } = task;
      const attempt = latestAttempts[index];
      const artifact = latestArtifacts[index];
      return {
        ...taskFields,
        objectivePreview: previewText(objective, 240),
        todoCounts: countTodoStatuses(currentTodos),
        todos: currentTodos.slice(0, HUMAN_TODO_PREVIEW_LIMIT).map(todoPreview),
        attempts: attempt ? [attemptPreview(attempt)] : [],
        artifacts: artifact ? [artifactPreview(artifact)] : [],
      };
    });
    const instructions = new Map<string, { agentId: string; roleSlotIds: string[]; taskIds: string[] }>();
    for (const binding of roleBindings) {
      const current = instructions.get(binding.agentId) ?? { agentId: binding.agentId, roleSlotIds: [], taskIds: [] };
      current.roleSlotIds.push(binding.roleSlotId);
      instructions.set(binding.agentId, current);
    }
    for (const task of tasks) {
      const existing = instructions.get(task.assigneeAgentId);
      if (!existing && ['completed', 'failed', 'skipped'].includes(task.status)) continue;
      const current = existing ?? { agentId: task.assigneeAgentId, roleSlotIds: [], taskIds: [] };
      current.taskIds.push(task.id);
      instructions.set(task.assigneeAgentId, current);
    }
    const { templateSnapshot: _templateSnapshot, ...publicRun } = run;
    const response = {
      ...publicRun,
      tasks,
      reviews: reviewPreviews,
      events: newestEvents.reverse(),
      joinInstructions: [...instructions.values()],
    };
    if (Buffer.byteLength(JSON.stringify(response), 'utf8') > HUMAN_RUN_MAX_SERIALIZED_BYTES) {
      throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Human Run summary exceeds its response budget');
    }
    return response;
  }

  private assertNotTerminal(status: string): void {
    if ((TERMINAL_RUN_STATUSES as readonly string[]).includes(status)) throw new BusinessException('COLLABORATION_RUN_TERMINAL');
  }

  private runStateError(status: string): BusinessException {
    this.assertNotTerminal(status);
    return new BusinessException('COLLABORATION_PROGRESS_INVARIANT');
  }
}

function parseDefinition(value: unknown): CollaborationTemplateDefinition {
  const result = CollaborationTemplateDefinitionSchema.safeParse(value);
  if (!result.success) throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', undefined, { issues: result.error.issues });
  return result.data;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function artifactMarkdown(value: Prisma.JsonValue): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof (value as { markdown?: unknown }).markdown !== 'string') {
    throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Page Artifact Markdown is missing');
  }
  return (value as { markdown: string }).markdown;
}

function adoptedCurrentPage(value: Prisma.JsonValue): {
  kind: 'human_adopt_current';
  pageId: string;
  pageVersionId: string;
  contentHash: string;
  adoptedByUserId: string;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const adopted = (value as { adoptedCurrentPage?: unknown }).adoptedCurrentPage;
  if (!adopted || typeof adopted !== 'object' || Array.isArray(adopted)) return null;
  const item = adopted as Record<string, unknown>;
  return item.kind === 'human_adopt_current'
    && typeof item.pageId === 'string'
    && typeof item.pageVersionId === 'string'
    && typeof item.contentHash === 'string'
    && typeof item.adoptedByUserId === 'string'
    ? item as ReturnType<typeof adoptedCurrentPage>
    : null;
}

function ensureComparisonBudget<T>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > HUMAN_PAGE_COMPARISON_MAX_SERIALIZED_BYTES) {
    throw new BusinessException('COLLABORATION_HISTORY_PAGE_TOO_LARGE', 'Page comparison exceeds its response budget');
  }
  return value;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}

function snapshotNodes(value: unknown): any[] {
  return value && typeof value === 'object' && Array.isArray((value as { nodes?: unknown }).nodes)
    ? (value as { nodes: any[] }).nodes
    : [];
}

function parseHistoryKind(value: string): HistoryKind {
  if (!(HISTORY_KINDS as readonly string[]).includes(value)) {
    throw new BusinessException('COLLABORATION_HISTORY_QUERY_INVALID');
  }
  return value as HistoryKind;
}

function parseHistoryLimit(value: string): number {
  if (!/^\d+$/u.test(value)) throw new BusinessException('COLLABORATION_HISTORY_QUERY_INVALID');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new BusinessException('COLLABORATION_HISTORY_QUERY_INVALID');
  }
  return parsed;
}

function parseRunListStatus(value: string): RunListStatus {
  if (value !== 'active' && value !== 'history') {
    throw new BusinessException('COLLABORATION_RUN_LIST_QUERY_INVALID');
  }
  return value;
}

function parseRunListLimit(value: string): number {
  if (!/^\d+$/u.test(value)) throw new BusinessException('COLLABORATION_RUN_LIST_QUERY_INVALID');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new BusinessException('COLLABORATION_RUN_LIST_QUERY_INVALID');
  }
  return parsed;
}

function timestampKeyset(field: 'createdAt' | 'updatedAt', position: { at: string; id: string }) {
  const at = new Date(position.at);
  return {
    OR: [
      { [field]: { lt: at } },
      { [field]: at, id: { lt: position.id } },
    ],
  };
}

function previewText(value: string | null | undefined, maximum: number): string | null {
  if (!value) return null;
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function countTodoStatuses(todos: Array<{ status: string }>) {
  const counts = { total: todos.length, pending: 0, doing: 0, done: 0, failed: 0 };
  for (const todo of todos) {
    if (todo.status === 'pending' || todo.status === 'doing' || todo.status === 'done' || todo.status === 'failed') {
      counts[todo.status] += 1;
    }
  }
  return counts;
}

function todoPreview(todo: any) {
  return {
    id: todo.id, taskId: todo.taskId, generation: todo.generation, ordinal: todo.ordinal,
    name: previewText(todo.name, 120), required: todo.required, status: todo.status,
  };
}

function attemptPreview(attempt: any) {
  return {
    id: attempt.id, taskId: attempt.taskId, generation: attempt.generation, agentId: attempt.agentId,
    attemptNumber: attempt.attemptNumber, status: attempt.status, leaseStartedAt: attempt.leaseStartedAt,
    leaseExpiresAt: attempt.leaseExpiresAt, maxExecutionAt: attempt.maxExecutionAt,
    failureCode: previewText(attempt.failureCode, 240), repairCount: attempt.repairCount,
    basePageVersionId: attempt.basePageVersionId,
    basePageUpdatedAt: attempt.basePageUpdatedAt,
    baseContentHash: attempt.baseContentHash,
    finishedAt: attempt.finishedAt, createdAt: attempt.createdAt, updatedAt: attempt.updatedAt,
  };
}

function artifactPreview(artifact: any) {
  return {
    id: artifact.id, taskId: artifact.taskId, generation: artifact.generation, version: artifact.version,
    kind: artifact.kind, status: artifact.status, createdAt: artifact.createdAt,
    preview: `${artifact.kind} v${artifact.version}`,
  };
}

function runSummary(run: any) {
  return {
    id: run.id, name: run.name, status: run.status, templateId: run.templateId,
    templateVersion: run.templateVersion, createdAt: run.createdAt, updatedAt: run.updatedAt,
    startedAt: run.startedAt, finishedAt: run.finishedAt,
  };
}
