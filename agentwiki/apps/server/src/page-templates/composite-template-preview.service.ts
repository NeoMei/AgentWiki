import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Principal } from '../core/authorization/authorization.service';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { ContentTreeConflict } from '../content-tree/content-tree.types';
import { ContentTreeError } from '../content-tree/content-tree.types';
import { PrismaService } from '../database/prisma.service';
import { CompositeTemplateCatalogService } from './composite-template-catalog.service';
import type { PreviewCompositeTemplateDto } from './composite-template.dto';
import { resolveParticipants } from './run-page-selection';
import { inspectCollaborationInputs } from '../collaboration-workflows/run-input-validation';
import { inspectCollaborationAgentReadiness } from '../collaboration-workflows/agent-readiness';
import type { RunPageSelectionBinding } from './run-page-selection';
import {
  expandTemplateDefinition,
  assertCompositeTemplatePlacement,
  ordinarySinglePageCollaboration,
  selectCompositeCollaboration,
} from './template-instantiation.service';

@Injectable()
export class CompositeTemplatePreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly catalog: CompositeTemplateCatalogService,
  ) {}

  preview(
    spaceId: string,
    templateId: string,
    input: PreviewCompositeTemplateDto,
    principal: Principal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.authorization.assertLiveHumanSpaceAccess(
        tx, principal, spaceId, ['owner', 'admin', 'editor', 'viewer'],
      );
      if (!input.variables || Object.keys(input.variables).length > 0) {
        throw new BusinessException('PAGE_TEMPLATE_INSTANTIATION_UNSUPPORTED');
      }
      if (!input.collaborationEnabled && (
        input.roleBindings !== undefined
        || input.enabledTaskNodeIds !== undefined
        || input.collaborationInputs !== undefined
      )) throw new BusinessException('PAGE_TEMPLATE_INSTANTIATION_UNSUPPORTED');
      const space = await tx.space.findUnique({
        where: { id: spaceId, deletedAt: null },
        select: { contentTreeRevision: true },
      });
      if (!space) throw new BusinessException('RESOURCE_NOT_FOUND');
      if (input.expectedTreeRevision !== undefined
        && BigInt(input.expectedTreeRevision) !== space.contentTreeRevision) {
        throw new ContentTreeConflict(BigInt(input.expectedTreeRevision), space.contentTreeRevision);
      }
      const resolved = await this.catalog.resolve(
        tx, spaceId, templateId, input.templateVersion, input.locale,
      );
      const nodes = expandTemplateDefinition(resolved.definition, resolved.locale, {
        rootName: input.rootName,
      });
      const selected = input.collaborationEnabled
        ? selectCompositeCollaboration(resolved.definition, input.enabledTaskNodeIds)
        : null;
      const available = resolved.definition.collaboration
        ?? (resolved.definition.kind === 'single_page'
          ? ordinarySinglePageCollaboration(resolved.definition)
          : null);
      const tasks = (selected?.workflow ?? available?.workflow)?.nodes
        .filter((node) => node.kind === 'agent_task') ?? [];
      const resolvedParticipants = selected
        ? resolveParticipants(
          tasks.map((task) => ({ nodeId: task.id, roleSlotId: task.roleSlotId, enabled: true })),
          toBindings(input.roleBindings ?? []),
        )
        : { assignments: [], agentIds: [], issues: [] };
      const issues: Array<Record<string, unknown>> = [...resolvedParticipants.issues];
      if (input.targetParentFolderId) {
        try {
          await assertCompositeTemplatePlacement(
            tx, spaceId, input.targetParentFolderId, nodes,
          );
        } catch (error) {
          if (error instanceof ContentTreeError && error.code === 'FOLDER_NOT_FOUND') {
            issues.push({ code: 'TARGET_PARENT_FOLDER_NOT_FOUND', folderId: input.targetParentFolderId });
          } else if (error instanceof ContentTreeError && error.code === 'FOLDER_DEPTH_LIMIT') {
            issues.push({ code: 'TARGET_FOLDER_DEPTH_LIMIT', folderId: input.targetParentFolderId });
          } else {
            throw error;
          }
        }
      }
      if (resolvedParticipants.agentIds.length > 0) {
        issues.push(...await inspectCollaborationAgentReadiness(
          tx, spaceId, resolvedParticipants.agentIds, true,
        ));
      }
      let inputValues: Record<string, string | number | boolean> = {};
      if (selected) {
        const inspected = inspectCollaborationInputs(
          selected.workflow, input.collaborationInputs ?? {},
        );
        inputValues = inspected.values;
        issues.push(...inspected.issues);
      }
      return {
        templateId,
        templateVersion: input.templateVersion,
        locale: resolved.locale,
        definitionHash: resolved.definitionHash,
        treeRevision: space.contentTreeRevision,
        nodes,
        pageCount: nodes.filter((node) => node.kind === 'page').length,
        folderCount: nodes.filter((node) => node.kind === 'folder').length,
        roleCount: (selected?.workflow ?? available?.workflow)?.roleSlots.length ?? 0,
        roles: (selected?.workflow ?? available?.workflow)?.roleSlots ?? [],
        inputs: (selected?.workflow ?? available?.workflow)?.inputs ?? [],
        inputValues,
        tasks: tasks.map((task) => ({
          nodeId: task.id,
          name: task.name,
          roleSlotId: task.roleSlotId,
          outputKind: task.output.kind,
          humanAcceptance: task.humanAcceptance,
        })),
        assignments: resolvedParticipants.assignments,
        participants: resolvedParticipants.agentIds,
        issues,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}

function toBindings(items: PreviewCompositeTemplateDto['roleBindings']): RunPageSelectionBinding[] {
  return (items ?? []).map((item) => item.kind === 'task_default'
    ? { kind: 'task_default', nodeId: item.nodeId!, roleSlotId: item.roleSlotId, agentId: item.agentId }
    : { kind: 'role_override', roleSlotId: item.roleSlotId, agentId: item.agentId });
}
