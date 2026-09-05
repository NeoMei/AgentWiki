import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type CompositeTemplateDefinition,
  type TemplateNode,
} from '@neomei/agentwiki-sync-protocol';
import { createHash, randomUUID } from 'crypto';
import { AuthorizationService, type Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import type { StructuralPageChange, SpaceTreeLockedTransaction } from '../core/sync/space-revision-writer.service';
import { ContentTreeService } from '../content-tree/content-tree.service';
import { ContentTreeConflict, ContentTreeError } from '../content-tree/content-tree.types';
import { PrismaService } from '../database/prisma.service';
import {
  compareCompositeTemplateSiblingOrder,
} from './composite-template-validator';
import { PageTemplateLocaleSchema, type PageTemplateLocale } from './page-template.types';
import { CompositeTemplateCatalogService } from './composite-template-catalog.service';

const MAX_SERIALIZABLE_ATTEMPTS = 3;
const INSTANTIATION_TRANSACTION_TIMEOUT_MS = 120_000;
const MAX_PAGE_TITLE_LENGTH = 200;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export type TemplateInstantiationInput = {
  templateVersion: number;
  locale: PageTemplateLocale;
  targetParentFolderId?: string | null;
  variables: Record<string, unknown>;
  rootName?: string;
  collaborationEnabled: boolean;
  roleBindings?: unknown[];
  enabledTaskNodeIds?: string[];
  expectedTreeRevision: bigint;
  idempotencyKey: string;
};

export type TemplateInstantiationResult = {
  instantiationId: string;
  rootFolderId: string | null;
  pageIds: string[];
  runId: string | null;
  treeRevision: bigint;
};

export type ExpandedTemplateNode =
  | { nodeId: string; parentNodeId: string | null; kind: 'folder'; order: number; name: string }
  | { nodeId: string; parentNodeId: string | null; kind: 'page'; order: number; title: string; content: string };

/** Shared by commit and the Task 11 preview path so both render the exact same names and ordering. */
export function expandTemplateDefinition(
  definition: CompositeTemplateDefinition,
  locale: PageTemplateLocale,
  options: { rootName?: string } = {},
): ExpandedTemplateNode[] {
  const root = definition.nodes.find((node) => node.parentNodeId === null);
  if (!root) throw new BusinessException('PAGE_TEMPLATE_INVALID');
  const rootName = options.rootName === undefined ? undefined : normalizeRootName(options.rootName);
  const children = new Map<string | null, TemplateNode[]>();
  for (const node of definition.nodes) {
    const siblings = children.get(node.parentNodeId) ?? [];
    siblings.push(node);
    children.set(node.parentNodeId, siblings);
  }
  for (const siblings of children.values()) siblings.sort(compareCompositeTemplateSiblingOrder);

  const expanded: ExpandedTemplateNode[] = [];
  const visit = (parentNodeId: string | null): void => {
    for (const node of children.get(parentNodeId) ?? []) {
      if (node.kind === 'folder') {
        expanded.push({
          nodeId: node.nodeId,
          parentNodeId: node.parentNodeId,
          kind: 'folder',
          order: node.order,
          name: node.nodeId === root.nodeId && rootName !== undefined
            ? rootName
            : localized(node.nameI18n, locale),
        });
        visit(node.nodeId);
      } else {
        const title = node.nodeId === root.nodeId && rootName !== undefined
          ? rootName
          : localized(node.titleI18n, locale);
        if (title.length < 1 || title.length > MAX_PAGE_TITLE_LENGTH) {
          throw new BusinessException('PAGE_TEMPLATE_INVALID', 'Expanded Page title must contain 1 through 200 characters');
        }
        expanded.push({
          nodeId: node.nodeId,
          parentNodeId: node.parentNodeId,
          kind: 'page',
          order: node.order,
          title,
          content: localized(node.contentI18n, locale),
        });
      }
    }
  };
  visit(null);
  if (expanded.length !== definition.nodes.length) throw new BusinessException('PAGE_TEMPLATE_INVALID');
  return expanded;
}

@Injectable()
export class TemplateInstantiationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly contentTree: ContentTreeService,
    private readonly catalog: CompositeTemplateCatalogService,
  ) {}

  async instantiate(
    spaceId: string,
    templateId: string,
    input: TemplateInstantiationInput,
    principal: Principal,
  ): Promise<TemplateInstantiationResult> {
    const normalized = normalizeRequest(spaceId, templateId, input);
    assertTask5Supported(normalized);
    const requestHash = createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex');
    for (let attempt = 0; attempt < MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await this.authorization.lockLiveHumanPrincipal(tx, principal);
          const lockedTx = await this.contentTree.lockPageMutationSpace(tx, spaceId);
          await this.authorization.assertLiveHumanSpaceAccess(
            lockedTx, principal, spaceId, ['owner', 'editor'],
          );
          const existing = await lockedTx.templateInstantiation.findUnique({
            where: {
              spaceId_createdByUserId_idempotencyKey: {
                spaceId, createdByUserId: principal.userId, idempotencyKey: normalized.idempotencyKey,
              },
            },
            select: { requestHash: true, result: true },
          });
          if (existing) {
            if (existing.requestHash !== requestHash) {
              throw new BusinessException('PAGE_TEMPLATE_INSTANTIATION_IDEMPOTENCY_CONFLICT');
            }
            return parseStoredResult(existing.result);
          }
          if (lockedTx.contentTreeRevision !== input.expectedTreeRevision) {
            throw new ContentTreeConflict(input.expectedTreeRevision, lockedTx.contentTreeRevision);
          }
          return this.instantiateLocked(lockedTx, spaceId, templateId, input, principal, requestHash);
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: INSTANTIATION_TRANSACTION_TIMEOUT_MS,
        });
      } catch (error) {
        if (!isSerializationConflict(error)) throw error;
        if (attempt === MAX_SERIALIZABLE_ATTEMPTS - 1) {
          throw new BusinessException(
            'PAGE_TEMPLATE_INSTANTIATION_RETRY_REQUIRED',
            'Concurrent template instantiation conflicted repeatedly; retry with the same idempotency key',
          );
        }
      }
    }
    throw new BusinessException('PAGE_TEMPLATE_INSTANTIATION_RETRY_REQUIRED');
  }

  private async instantiateLocked(
    tx: SpaceTreeLockedTransaction,
    spaceId: string,
    templateId: string,
    input: TemplateInstantiationInput,
    principal: Principal,
    requestHash: string,
  ): Promise<TemplateInstantiationResult> {
    const resolved = await this.catalog.resolve(
      tx, spaceId, templateId, input.templateVersion, input.locale,
    );
    const version = await tx.pageTemplateVersion.findUnique({
      where: { templateId_version: { templateId, version: input.templateVersion } },
      select: { id: true },
    });
    if (!version) throw new BusinessException('PAGE_TEMPLATE_VERSION_NOT_FOUND');
    const locale = resolved.locale;
    const nodes = expandTemplateDefinition(resolved.definition, locale, { rootName: input.rootName });
    await assertCombinedDepth(tx, spaceId, input.targetParentFolderId ?? null, nodes);
    const initialSiblingOrders = await loadInitialSiblingOrders(
      tx, spaceId, input.targetParentFolderId ?? null, nodes,
    );
    const instantiationId = randomUUID();
    const runtimeByNode = new Map<string, { kind: 'folder'; id: string } | { kind: 'page'; id: string }>();
    const pageIds: string[] = [];
    const changes: StructuralPageChange[] = [];
    const actor = { userId: principal.userId };
    const siblingOffsets = new Map<string, number>();

    for (const node of nodes) {
      const parentFolderId = node.parentNodeId === null
        ? (input.targetParentFolderId ?? null)
        : requireFolderRuntime(runtimeByNode, node.parentNodeId);
      const siblingKey = parentFolderId ?? '__root__';
      const base = node.parentNodeId === null
        ? initialSiblingOrders.root
        : initialSiblingOrders.empty;
      const offset = siblingOffsets.get(siblingKey) ?? 0;
      siblingOffsets.set(siblingKey, offset + 1);
      const sortOrder = base + offset;

      if (node.kind === 'folder') {
        const folder = await this.contentTree.createFolderLocked(tx, {
          spaceId, parentId: parentFolderId, name: node.name, actor, sortOrder,
        });
        runtimeByNode.set(node.nodeId, { kind: 'folder', id: folder.id });
        continue;
      }
      const pageId = randomUUID();
      const knowledgeKey = randomUUID();
      const placement = await this.contentTree.placePage(tx, {
        spaceId, pageId, title: node.title, folderId: parentFolderId,
      });
      const slug = `${slugify(node.title) || 'page'}-${pageId.slice(0, 12)}`;
      const page = await tx.page.create({ data: {
        id: pageId,
        knowledgeKey,
        title: node.title,
        slug,
        content: node.content,
        format: 'markdown',
        sourceTemplateId: templateId,
        sourceTemplateVersion: input.templateVersion,
        sourceTemplateLocale: locale,
        spaceId,
        authorId: principal.userId,
        parentId: null,
        folderId: placement.folderId,
        syncPath: placement.syncPath,
        syncPathKey: placement.syncPathKey,
        sortOrder,
        lastModifiedByUserId: principal.userId,
        lastModifiedAt: new Date(),
      } });
      await tx.pageVersion.create({ data: {
        pageId: page.id,
        title: page.title,
        content: page.content,
        authorId: page.authorId,
        slug: page.slug,
        format: page.format,
        parentId: page.parentId,
        folderId: page.folderId,
        syncPath: page.syncPath,
        syncPathKey: page.syncPathKey,
      } });
      runtimeByNode.set(node.nodeId, { kind: 'page', id: page.id });
      pageIds.push(page.id);
      changes.push({
        operation: 'upsert', pageId: page.knowledgeKey, folderId: page.folderId,
        path: page.syncPath, title: page.title, body: page.content,
      });
    }

    const advanced = await this.contentTree.advancePageMutation(tx, {
      spaceId,
      expectedTreeRevision: input.expectedTreeRevision,
      structural: true,
      changes,
      actor,
    });
    const root = nodes.find((node) => node.parentNodeId === null)!;
    const rootRuntime = runtimeByNode.get(root.nodeId)!;
    const result: TemplateInstantiationResult = {
      instantiationId,
      rootFolderId: rootRuntime.kind === 'folder' ? rootRuntime.id : null,
      pageIds,
      runId: null,
      treeRevision: advanced.treeRevision,
    };
    await tx.templateInstantiation.create({ data: {
      id: instantiationId,
      spaceId,
      compositeTemplateVersionId: version.id,
      createdByUserId: principal.userId,
      targetParentFolderId: input.targetParentFolderId ?? null,
      idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
      requestHash,
      treeRevision: result.treeRevision,
      status: 'completed',
      result: storedResult(result),
      completedAt: new Date(),
    } });
    await tx.templateInstantiationNode.createMany({ data: nodes.map((node) => {
      const runtime = runtimeByNode.get(node.nodeId)!;
      return {
        instantiationId, spaceId, templateNodeId: node.nodeId, kind: node.kind,
        folderId: runtime.kind === 'folder' ? runtime.id : null,
        pageId: runtime.kind === 'page' ? runtime.id : null,
      };
    }) });
    await tx.templateEffectJob.createMany({ data: [
      ...pageIds.map((pageId) => ({
        instantiationId, spaceId, effectKey: `page-index:${pageId}`, kind: 'page_index',
        payload: { pageId },
      })),
      {
        instantiationId, spaceId, effectKey: `space-graph:${spaceId}`, kind: 'space_graph',
        payload: { spaceId },
      },
    ] });
    return result;
  }
}

function localized(value: { 'zh-CN'?: string; en?: string }, locale: PageTemplateLocale): string {
  const resolved = value[locale];
  if (resolved === undefined) throw new BusinessException('PAGE_TEMPLATE_INVALID');
  return resolved;
}

function normalizeRootName(value: string): string {
  if (typeof value !== 'string') throw new BusinessException('PAGE_TEMPLATE_INVALID');
  const normalized = value.normalize('NFC').trim();
  if (normalized.length < 1 || normalized.length > MAX_PAGE_TITLE_LENGTH) {
    throw new BusinessException('PAGE_TEMPLATE_INVALID', 'rootName must contain 1 through 200 characters');
  }
  return normalized;
}

function normalizeIdempotencyKey(value: string): string {
  if (typeof value !== 'string') throw new BusinessException('PAGE_TEMPLATE_INVALID');
  const normalized = value.normalize('NFC').trim();
  if (normalized.length < 1 || normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new BusinessException('PAGE_TEMPLATE_INVALID', 'idempotencyKey must contain 1 through 128 characters');
  }
  return normalized;
}

function normalizeRequest(spaceId: string, templateId: string, input: TemplateInstantiationInput) {
  if (!spaceId || !templateId
    || !Number.isInteger(input.templateVersion) || input.templateVersion < 1
    || typeof input.expectedTreeRevision !== 'bigint' || input.expectedTreeRevision < 0n
    || !PageTemplateLocaleSchema.safeParse(input.locale).success
    || typeof input.collaborationEnabled !== 'boolean'
    || !input.variables || typeof input.variables !== 'object' || Array.isArray(input.variables)) {
    throw new BusinessException('PAGE_TEMPLATE_INVALID');
  }
  return {
    spaceId,
    templateId,
    templateVersion: input.templateVersion,
    locale: input.locale,
    targetParentFolderId: input.targetParentFolderId ?? null,
    variables: sortJson(input.variables),
    rootName: input.rootName === undefined ? null : normalizeRootName(input.rootName),
    collaborationEnabled: input.collaborationEnabled,
    roleBindings: input.roleBindings === undefined ? null : sortJson(input.roleBindings),
    enabledTaskNodeIds: input.enabledTaskNodeIds === undefined
      ? null
      : [...input.enabledTaskNodeIds].sort(),
    expectedTreeRevision: input.expectedTreeRevision.toString(),
    idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
  };
}

function assertTask5Supported(input: ReturnType<typeof normalizeRequest>): void {
  if (input.collaborationEnabled
    || input.roleBindings !== null
    || input.enabledTaskNodeIds !== null
    || Object.keys(input.variables).length > 0) {
    throw new BusinessException(
      'PAGE_TEMPLATE_INSTANTIATION_UNSUPPORTED',
      'Collaboration, mappings, task selection, and free-form variables are not enabled yet',
    );
  }
}

function sortJson(value: unknown): any {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]));
  }
  return value;
}

function requireFolderRuntime(
  runtimeByNode: Map<string, { kind: 'folder'; id: string } | { kind: 'page'; id: string }>,
  nodeId: string,
): string {
  const runtime = runtimeByNode.get(nodeId);
  if (!runtime || runtime.kind !== 'folder') throw new BusinessException('PAGE_TEMPLATE_INVALID');
  return runtime.id;
}

async function assertCombinedDepth(
  tx: SpaceTreeLockedTransaction,
  spaceId: string,
  targetParentFolderId: string | null,
  nodes: readonly ExpandedTemplateNode[],
): Promise<void> {
  let parentDepth = 0;
  if (targetParentFolderId !== null) {
    const rows = await tx.$queryRaw<Array<{ depth: number }>>(Prisma.sql`
      WITH RECURSIVE ancestors AS (
        SELECT "id", "parentId", 1 AS depth
        FROM "Folder"
        WHERE "id" = ${targetParentFolderId}
          AND "spaceId" = ${spaceId}
          AND "deletedAt" IS NULL
        UNION ALL
        SELECT parent."id", parent."parentId", ancestors.depth + 1
        FROM "Folder" parent
        JOIN ancestors ON parent."id" = ancestors."parentId"
        WHERE parent."spaceId" = ${spaceId}
          AND parent."deletedAt" IS NULL
          AND ancestors.depth < 32
      )
      SELECT COALESCE(MAX(depth), 0)::int AS depth FROM ancestors
    `);
    parentDepth = rows[0]?.depth ?? 0;
    if (parentDepth === 0) throw new ContentTreeError('FOLDER_NOT_FOUND', 'Folder not found');
  }
  const depths = new Map<string, number>();
  let templateDepth = 0;
  for (const node of nodes) {
    const depth = node.parentNodeId === null ? 1 : (depths.get(node.parentNodeId) ?? 32) + 1;
    depths.set(node.nodeId, depth);
    templateDepth = Math.max(templateDepth, depth);
  }
  if (parentDepth + templateDepth > 32) {
    throw new ContentTreeError('FOLDER_DEPTH_LIMIT', 'Folder depth exceeds 32 levels');
  }
}

async function loadInitialSiblingOrders(
  tx: SpaceTreeLockedTransaction,
  spaceId: string,
  targetParentFolderId: string | null,
  nodes: readonly ExpandedTemplateNode[],
): Promise<{ root: number; empty: number }> {
  const rootNode = nodes.find((node) => node.parentNodeId === null);
  if (!rootNode) throw new BusinessException('PAGE_TEMPLATE_INVALID');
  const [folders, pages] = await Promise.all([
    tx.folder.aggregate({
      where: { spaceId, parentId: targetParentFolderId, deletedAt: null },
      _max: { sortOrder: true },
    }),
    tx.page.aggregate({
      where: { spaceId, folderId: targetParentFolderId, deletedAt: null },
      _max: { sortOrder: true },
    }),
  ]);
  return {
    root: Math.max(folders._max.sortOrder ?? -1, pages._max.sortOrder ?? -1) + 1,
    empty: 0,
  };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, '-').replace(/^-+|-+$/gu, '');
}

function storedResult(result: TemplateInstantiationResult): Prisma.InputJsonObject {
  return {
    instantiationId: result.instantiationId,
    rootFolderId: result.rootFolderId,
    pageIds: result.pageIds,
    runId: result.runId,
    treeRevision: result.treeRevision.toString(),
  };
}

function parseStoredResult(value: Prisma.JsonValue): TemplateInstantiationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BusinessException('PAGE_TEMPLATE_INVALID');
  }
  const result = value as Record<string, Prisma.JsonValue>;
  if (typeof result.instantiationId !== 'string'
    || !(typeof result.rootFolderId === 'string' || result.rootFolderId === null)
    || !Array.isArray(result.pageIds) || result.pageIds.some((id) => typeof id !== 'string')
    || !(typeof result.runId === 'string' || result.runId === null)
    || typeof result.treeRevision !== 'string' || !/^\d+$/u.test(result.treeRevision)) {
    throw new BusinessException('PAGE_TEMPLATE_INVALID');
  }
  return {
    instantiationId: result.instantiationId,
    rootFolderId: result.rootFolderId,
    pageIds: result.pageIds as string[],
    runId: result.runId,
    treeRevision: BigInt(result.treeRevision),
  };
}

function isSerializationConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  return error.code === 'P2010'
    && !!error.meta && typeof error.meta === 'object'
    && (error.meta as { code?: unknown }).code === '40001';
}
