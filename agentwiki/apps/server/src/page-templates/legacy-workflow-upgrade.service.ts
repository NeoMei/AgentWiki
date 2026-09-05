import { Injectable } from '@nestjs/common';
import { Prisma, type PageTemplateCategory } from '@prisma/client';
import {
  CollaborationTemplateDefinitionSchema,
  CompositeTemplateDefinitionSchema,
  type CompositeTemplateDefinition,
  type TemplateNode,
} from '@neomei/agentwiki-sync-protocol';
import { createHash } from 'crypto';
import { AuthorizationService, type Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { SpaceRevisionWriterService } from '../core/sync/space-revision-writer.service';
import { PrismaService } from '../database/prisma.service';
import { hashCollaborationTemplate, validateCollaborationTemplate } from '../collaboration-workflows/template-validator';
import { hashCompositeDefinition, validateCompositeDefinition } from './composite-template-validator';
import { PageTemplateService } from './page-template.service';
import { PageTemplateLocaleSchema, type PageTemplateLocale } from './page-template.types';
import { addCompositePageReviewGates } from './composite-template-definitions';

export type LegacyWorkflowUpgradeInput = {
  expectedLegacyVersion: number;
  expectedLegacyDefinitionHash: string;
  name: string;
  description?: string;
  defaultTitle: string;
  category: PageTemplateCategory;
  locale: PageTemplateLocale;
  nodes: TemplateNode[];
  taskTargets: Array<{ taskNodeId: string; pageNodeId: string }>;
};

export type LegacyWorkflowUpgradeIssue = { code: string; nodeId?: string };

type PreparedUpgrade = {
  definition: CompositeTemplateDefinition;
  definitionHash: string;
  upgradeRequestHash: string;
  issues: LegacyWorkflowUpgradeIssue[];
};

@Injectable()
export class LegacyWorkflowUpgradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly revisionWriter: SpaceRevisionWriterService,
    private readonly pageTemplates: PageTemplateService,
  ) {}

  source(spaceId: string, legacyId: string, principal: Principal) {
    if (principal.agentId) throw new BusinessException('PAGE_TEMPLATE_PERMISSION_DENIED');
    return this.prisma.$transaction(async (tx) => {
      try {
        await this.authorization.assertLiveHumanSpaceAccess(
          tx, principal, spaceId, ['owner', 'admin'],
        );
      } catch (error) {
        if (error instanceof BusinessException && error.businessCode === 'SPACE_ACCESS_DENIED') {
          throw new BusinessException('PAGE_TEMPLATE_PERMISSION_DENIED');
        }
        throw error;
      }
      const legacy = await this.requireLegacy(tx, spaceId, legacyId);
      const parsed = CollaborationTemplateDefinitionSchema.safeParse(structuredClone(legacy.definition));
      if (!parsed.success || validateCollaborationTemplate(parsed.data).length > 0) {
        throw new BusinessException('COLLABORATION_TEMPLATE_INVALID');
      }
      return {
        legacyId: legacy.id,
        version: legacy.version,
        definitionHash: hashCollaborationTemplate(parsed.data),
        definition: structuredClone(parsed.data),
      };
    });
  }

  preview(
    spaceId: string,
    legacyId: string,
    input: LegacyWorkflowUpgradeInput,
    principal: Principal,
  ): Promise<PreparedUpgrade> {
    return this.inManagedSpace(spaceId, principal, async (tx) => {
      const legacy = await this.requireLegacy(tx, spaceId, legacyId);
      this.assertLegacyCas(legacy, input);
      return this.prepare(legacy.definition, input);
    });
  }

  upgrade(
    spaceId: string,
    legacyId: string,
    input: LegacyWorkflowUpgradeInput,
    principal: Principal,
  ) {
    return this.inManagedSpace(spaceId, principal, async (tx) => {
      const requestHash = hashUpgradeRequest(input);
      const replay = await tx.pageTemplateVersionLegacyWorkflowSource.findUnique({
        where: {
          spaceId_legacyTemplateId_legacyVersion_legacyDefinitionHash: {
            spaceId,
            legacyTemplateId: legacyId,
            legacyVersion: input.expectedLegacyVersion,
            legacyDefinitionHash: input.expectedLegacyDefinitionHash,
          },
        },
        include: {
          compositeTemplateVersion: { select: { templateId: true, version: true } },
        },
      });
      if (replay) {
        if (replay.upgradeRequestHash !== requestHash) {
          throw new BusinessException('PAGE_TEMPLATE_UPGRADE_CONFLICT');
        }
        return this.pageTemplates.getCompositeManagedRecordInLockedTransaction(
          tx,
          replay.compositeTemplateVersion.templateId,
          replay.compositeTemplateVersion.version,
          input.locale,
        );
      }

      const legacy = await this.requireLegacy(tx, spaceId, legacyId);
      this.assertLegacyCas(legacy, input);
      const prepared = this.prepare(legacy.definition, input);
      if (prepared.issues.length > 0) {
        throw new BusinessException('PAGE_TEMPLATE_INVALID', undefined, { issues: prepared.issues });
      }
      const created = await this.pageTemplates.createCompositeSpaceTemplateInLockedTransaction(
        tx,
        spaceId,
        {
          name: input.name,
          description: input.description,
          defaultTitle: input.defaultTitle,
          category: input.category,
          locale: input.locale,
          definition: prepared.definition,
        },
        principal,
      );
      const version = await tx.pageTemplateVersion.findUnique({
        where: { templateId_version: { templateId: created.id, version: created.currentVersion } },
        select: { id: true },
      });
      if (!version) throw new BusinessException('PAGE_TEMPLATE_VERSION_NOT_FOUND');
      await tx.pageTemplateVersionLegacyWorkflowSource.create({ data: {
        compositeTemplateVersionId: version.id,
        spaceId,
        legacyTemplateId: legacyId,
        legacyVersion: input.expectedLegacyVersion,
        legacyDefinitionHash: input.expectedLegacyDefinitionHash,
        upgradeRequestHash: requestHash,
        createdById: principal.userId,
      } });
      return this.pageTemplates.getCompositeManagedRecordInLockedTransaction(
        tx, created.id, created.currentVersion, input.locale,
      );
    });
  }

  private async inManagedSpace<T>(
    spaceId: string,
    principal: Principal,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (principal.agentId) throw new BusinessException('PAGE_TEMPLATE_PERMISSION_DENIED');
    return this.prisma.$transaction(async (tx) => {
      try {
        await this.authorization.lockLiveHumanPrincipal(tx, principal);
        const lockedTx = await this.revisionWriter.lockSpace(tx, spaceId);
        await this.authorization.assertLiveHumanSpaceAccess(
          lockedTx, principal, spaceId, ['owner', 'admin'],
        );
        return operation(lockedTx);
      } catch (error) {
        if (error instanceof BusinessException && error.businessCode === 'SPACE_ACCESS_DENIED') {
          throw new BusinessException('PAGE_TEMPLATE_PERMISSION_DENIED');
        }
        throw error;
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  private async requireLegacy(tx: Prisma.TransactionClient, spaceId: string, legacyId: string) {
    const legacy = await tx.collaborationTemplate.findFirst({
      where: {
        id: legacyId,
        spaceId,
        scopeKey: spaceId,
        system: false,
        archivedAt: null,
      },
    });
    if (!legacy) throw new BusinessException('COLLABORATION_TEMPLATE_NOT_FOUND');
    return legacy;
  }

  private assertLegacyCas(
    legacy: { version: number; definition: Prisma.JsonValue },
    input: LegacyWorkflowUpgradeInput,
  ): void {
    const parsed = CollaborationTemplateDefinitionSchema.safeParse(structuredClone(legacy.definition));
    if (!parsed.success || validateCollaborationTemplate(parsed.data).length > 0) {
      throw new BusinessException('COLLABORATION_TEMPLATE_INVALID');
    }
    if (legacy.version !== input.expectedLegacyVersion
      || hashCollaborationTemplate(parsed.data) !== input.expectedLegacyDefinitionHash) {
      throw new BusinessException('COLLABORATION_TEMPLATE_VERSION_CONFLICT');
    }
  }

  private prepare(definitionInput: Prisma.JsonValue, input: LegacyWorkflowUpgradeInput): PreparedUpgrade {
    const originalWorkflow = CollaborationTemplateDefinitionSchema.parse(structuredClone(definitionInput));
    const workflow = addCompositePageReviewGates(
      originalWorkflow, input.taskTargets.map((target) => target.taskNodeId),
    );
    const raw = {
      schemaVersion: 1 as const,
      kind: 'page_group' as const,
      nodes: structuredClone(input.nodes),
      collaboration: {
        workflow,
        taskTargets: structuredClone(input.taskTargets),
      },
    };
    const issues: LegacyWorkflowUpgradeIssue[] = [];
    const gateCount = originalWorkflow.nodes.filter((node) => node.kind === 'human_review').length;
    if (gateCount > 1) issues.push({ code: 'LEGACY_REQUIRED_HUMAN_GATES_MULTIPLE' });
    const targets = new Set(input.taskTargets.map((target) => target.taskNodeId));
    for (const node of workflow.nodes) {
      if (node.kind === 'agent_task' && node.output.kind === 'markdown' && !targets.has(node.id)) {
        issues.push({ code: 'TEMPLATE_MARKDOWN_TARGET_REQUIRED', nodeId: node.id });
      }
    }
    const parsed = CompositeTemplateDefinitionSchema.safeParse(raw);
    if (!parsed.success) {
      issues.push({ code: 'TEMPLATE_SCHEMA_INVALID' });
      const fallback = raw as CompositeTemplateDefinition;
      return {
        definition: fallback,
        definitionHash: hashCompositeDefinition(fallback),
        upgradeRequestHash: hashUpgradeRequest(input),
        issues: uniqueIssues(issues),
      };
    }
    issues.push(...validateCompositeDefinition(parsed.data));
    return {
      definition: parsed.data,
      definitionHash: hashCompositeDefinition(parsed.data),
      upgradeRequestHash: hashUpgradeRequest(input),
      issues: uniqueIssues(issues),
    };
  }
}

function hashUpgradeRequest(input: LegacyWorkflowUpgradeInput): string {
  const normalized = {
    ...input,
    name: input.name.trim().replace(/\s+/gu, ' '),
    description: input.description?.trim() ?? '',
    defaultTitle: input.defaultTitle.trim(),
    locale: PageTemplateLocaleSchema.parse(input.locale),
  };
  return createHash('sha256').update(JSON.stringify(sortObject(normalized)), 'utf8').digest('hex');
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortObject(item)]));
  }
  return value;
}

function uniqueIssues(issues: LegacyWorkflowUpgradeIssue[]): LegacyWorkflowUpgradeIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}\u0000${issue.nodeId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
