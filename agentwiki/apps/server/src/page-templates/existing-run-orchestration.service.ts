import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Principal } from '../core/authorization/authorization.service';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { ContentTreeService } from '../content-tree/content-tree.service';
import { ContentTreeConflict } from '../content-tree/content-tree.types';
import { BusinessException } from '../core/filters/business-error';
import { PrismaService } from '../database/prisma.service';
import { CollaborationEventsService } from '../collaboration-workflows/collaboration-events.service';
import { RunExpansionService } from '../collaboration-workflows/run-expansion.service';
import { canonicalRequestHash, RunEventStore } from '../collaboration-workflows/run-event.store';
import { withCollaborationSerializableRetry } from '../collaboration-workflows/serializable-retry';
import { inspectCollaborationInputs } from '../collaboration-workflows/run-input-validation';
import { inspectCollaborationAgentReadiness } from '../collaboration-workflows/agent-readiness';
import type { ExistingRunPreviewDto } from './composite-template.dto';
import type { PageAgentBindingEdit } from './page-agent-binding.service';
import type { PageAgentBindingScopeInput } from './page-agent-binding.service';
import type { RunPageSelectionBinding } from './run-page-selection';
import {
  FolderTemplateSnapshotService,
  type PreparedExistingRunSource,
} from './folder-template-snapshot.service';
import { PageAgentBindingService } from './page-agent-binding.service';
import { resolveParticipants } from './run-page-selection';

export type ExistingRunPreviewInput = Omit<ExistingRunPreviewDto, 'source' | 'bindings' | 'bindingEdits'> & {
  source: { kind: 'page_selection' } | { kind: 'template_instantiation'; sourceInstantiationId: string };
  bindings: RunPageSelectionBinding[];
  bindingEdits?: PageAgentBindingEdit[];
};

export type ExistingRunStartInput = ExistingRunPreviewInput & {
  name: string;
  expectedTreeRevision: bigint;
  idempotencyKey: string;
};

@Injectable()
export class ExistingRunOrchestrationService {
  private readonly logger = new Logger(ExistingRunOrchestrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly contentTree: ContentTreeService,
    private readonly sources: FolderTemplateSnapshotService,
    private readonly pageBindings: PageAgentBindingService,
    private readonly expansion: RunExpansionService,
    private readonly events: RunEventStore,
    private readonly notifications: CollaborationEventsService,
  ) {}

  preview(spaceId: string, scopeId: string, input: ExistingRunPreviewInput, principal: Principal) {
    return this.prisma.$transaction(async (tx) => {
      await this.authorization.assertLiveHumanSpaceAccess(
        tx, principal, spaceId, ['owner', 'admin', 'editor', 'viewer'],
      );
      const space = await tx.space.findUnique({
        where: { id: spaceId, deletedAt: null }, select: { contentTreeRevision: true },
      });
      if (!space) throw new BusinessException('RESOURCE_NOT_FOUND');
      const prepared = await this.sources.prepareExistingRunSource(tx, spaceId, scopeId, input);
      return this.publicPreview(tx, spaceId, space.contentTreeRevision, prepared, input);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  previewFolderBindings(spaceId: string, folderId: string, pageIds: string[] | undefined, principal: Principal) {
    return this.prisma.$transaction(async (tx) => {
      await this.authorization.assertLiveHumanSpaceAccess(
        tx, principal, spaceId, ['owner', 'admin', 'editor', 'viewer'],
      );
      const discovered = pageIds === undefined
        ? await this.sources.discoverExistingFolderPages(tx, spaceId, folderId)
        : null;
      const scopedPageIds = discovered?.map((page) => page.pageId)
        ?? (await this.sources.assertExistingPageScope(
          tx, spaceId, folderId, pageIds!, { requireFolder: true },
        )).pageIds;
      const space = await tx.space.findUnique({
        where: { id: spaceId, deletedAt: null }, select: { contentTreeRevision: true },
      });
      if (!space) throw new BusinessException('RESOURCE_NOT_FOUND');
      const bindings = await this.pageBindings.readBindings(tx, spaceId, scopedPageIds);
      const titles = new Map(discovered?.map((page) => [page.pageId, page.title]) ?? []);
      return {
        treeRevision: space.contentTreeRevision,
        pages: bindings.map((binding) => ({
          ...binding,
          ...(titles.has(binding.pageId) ? { title: titles.get(binding.pageId)! } : {}),
        })),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  setFolderBindings(
    spaceId: string,
    folderId: string,
    input: PageAgentBindingScopeInput,
    principal: Principal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.authorization.lockLiveHumanPrincipal(tx, principal);
      const lockedTx = await this.contentTree.lockPageMutationSpace(
        tx, spaceId, input.expectedTreeRevision,
      );
      const scoped = await this.sources.assertExistingPageScope(
        lockedTx, spaceId, folderId, input.pageIds, { requireFolder: true },
      );
      return this.pageBindings.setBindingsForExactScope(
        lockedTx, spaceId, scoped.pageIds, input.edits, principal,
      );
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async start(spaceId: string, scopeId: string, input: ExistingRunStartInput, principal: Principal) {
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const operation = 'create_existing_page_group_run';
    const target = `${spaceId}:existing-scope:${scopeId}`;
    const requestHash = canonicalRequestHash({
      spaceId, scopeId, ...input, expectedTreeRevision: input.expectedTreeRevision.toString(),
    });
    const receipt = await withCollaborationSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      await this.authorization.lockLiveHumanPrincipal(tx, principal);
      const lockedTx = await this.contentTree.lockPageMutationSpace(tx, spaceId);
      await this.authorization.assertLiveHumanSpaceAccess(
        lockedTx, principal, spaceId, ['owner', 'admin', 'editor'],
      );
      const existing = await lockedTx.collaborationRunEvent.findFirst({
        where: {
          run: { spaceId }, actorKind: 'human', actorId: principal.userId,
          operation, idempotencyKey,
        },
        select: { runId: true },
        orderBy: { createdAt: 'asc' },
      });
      if (existing) {
        const replay = await this.events.findReplay<{ runId: string }>(lockedTx, {
          runId: existing.runId,
          actorKind: 'human', actorId: principal.userId, actorUserId: principal.userId,
          operation, target, key: idempotencyKey, requestHash,
        });
        if (!replay) throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT');
        return replay;
      }
      if (lockedTx.contentTreeRevision !== input.expectedTreeRevision) {
        throw new ContentTreeConflict(input.expectedTreeRevision, lockedTx.contentTreeRevision);
      }
      const prepared = await this.sources.prepareExistingRunSource(lockedTx, spaceId, scopeId, input);
      if (input.bindingEdits?.length) {
        await this.pageBindings.setBindings(lockedTx, spaceId, input.bindingEdits, principal);
      }
      const selectedBindings = [...prepared.defaultBindings, ...input.bindings];
      const runId = await this.expansion.createStarted(lockedTx, {
        spaceId,
        name: input.name,
        source: prepared.source,
        definition: prepared.definition,
        inputs: input.collaborationInputs,
        bindings: selectedBindings,
        taskPageIds: prepared.taskPageIds,
      }, principal);
      return this.events.executeIdempotent(lockedTx, {
        runId,
        actorKind: 'human', actorId: principal.userId, actorUserId: principal.userId,
        operation, target, key: idempotencyKey, requestHash,
        metadata: {
          pageIds: prepared.pageIds,
          sourceInstantiationId: prepared.sourceInstantiationId,
        },
      }, async () => ({ runId }));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    if (!receipt) throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT');
    try {
      await this.notifications.publishCurrentRun(receipt.runId);
    } catch {
      this.logger.warn({ code: 'COLLABORATION_NOTIFICATION_FAILED', runId: receipt.runId });
    }
    return receipt;
  }

  private async publicPreview(
    tx: Prisma.TransactionClient,
    spaceId: string,
    treeRevision: bigint,
    prepared: PreparedExistingRunSource,
    input: ExistingRunPreviewInput,
  ) {
    const inspectedInputs = inspectCollaborationInputs(prepared.definition, input.collaborationInputs);
    const tasks = prepared.definition.nodes.filter((node) => node.kind === 'agent_task');
    const bindings = [...prepared.defaultBindings, ...input.bindings];
    const participants = resolveParticipants(
      tasks.map((task) => ({ nodeId: task.id, roleSlotId: task.roleSlotId, enabled: true })),
      bindings,
    );
    const readinessIssues = participants.agentIds.length === 0 ? []
      : await inspectCollaborationAgentReadiness(tx, spaceId, participants.agentIds, true);
    return {
      treeRevision,
      pageIds: prepared.pageIds,
      source: prepared.source,
      sourceInstantiationId: prepared.sourceInstantiationId,
      inputs: inspectedInputs.values,
      inputDefinitions: prepared.definition.inputs,
      roles: prepared.definition.roleSlots,
      tasks: tasks.map((task) => ({ nodeId: task.id, name: task.name, roleSlotId: task.roleSlotId })),
      assignments: participants.assignments,
      participants: participants.agentIds,
      issues: [...inspectedInputs.issues, ...participants.issues, ...readinessIssues],
    };
  }
}

function normalizeIdempotencyKey(value: string): string {
  if (typeof value !== 'string') throw new BusinessException('COLLABORATION_TEMPLATE_INVALID');
  const normalized = value.normalize('NFC').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(normalized)) {
    throw new BusinessException('COLLABORATION_TEMPLATE_INVALID');
  }
  return normalized;
}
