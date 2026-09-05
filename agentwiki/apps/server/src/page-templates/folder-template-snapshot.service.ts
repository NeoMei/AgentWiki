import { Injectable } from '@nestjs/common';
import { Prisma, type PageTemplateCategory } from '@prisma/client';
import {
  COMPOSITE_TEMPLATE_LIMITS,
  CollaborationTemplateDefinitionSchema,
  CompositeTemplateDefinitionSchema,
  type CollaborationTemplateDefinition,
  type CompositeTemplateDefinition,
  type TemplateNode,
} from '@neomei/agentwiki-sync-protocol';
import { createHash } from 'crypto';
import { AuthorizationService, type Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { SpaceRevisionWriterService } from '../core/sync/space-revision-writer.service';
import { PrismaService } from '../database/prisma.service';
import { MarkdownResourceService } from '../markdown-resources/markdown-resource.service';
import { hashCollaborationTemplate, validateCollaborationTemplate } from '../collaboration-workflows/template-validator';
import { hashCompositeDefinition, validateCompositeDefinition } from './composite-template-validator';
import { PageTemplateService } from './page-template.service';
import { PageTemplateLocaleSchema, type PageTemplateLocale } from './page-template.types';
import {
  snapshotDefinition,
  snapshotDefinitionWithSourceMap,
  selectIndependentSimplePages,
  type FolderSnapshotSource,
  type FolderTemplateSnapshotSelection,
  type FolderTemplateWorkflowSource,
} from './folder-template-snapshot-definition';
import { selectCompositeCollaboration } from './template-instantiation.service';
import type { PageAgentBindingEdit } from './page-agent-binding.service';
import type { RunPageSelectionBinding } from './run-page-selection';

export {
  snapshotDefinition,
  snapshotDefinitionWithSourceMap,
  type FolderSnapshotSource,
  type FolderSnapshotSourceNode,
  type FolderTemplateSnapshotSelection,
  type FolderTemplateWorkflowSource,
} from './folder-template-snapshot-definition';

const SNAPSHOT_TRANSACTION_TIMEOUT_MS = 120_000;

export type FolderTemplateSnapshotWarning = {
  code: 'ATTACHMENTS_NOT_COPIED' | 'SOURCE_CONTENT_REVIEW_REQUIRED';
  affectedPageIds: string[];
  message: string;
};

export type FolderTemplateSourceToken = {
  digest: string;
  treeRevision: string;
  pages: Array<{
    pageId: string;
    updatedAt: string;
    titleHash: string;
    contentHash: string;
    matchingPageVersionId: string | null;
  }>;
  workflowSource: Record<string, unknown>;
};

export type FolderTemplateSnapshotSaveInput = {
  rootFolderId: string;
  selection: FolderTemplateSnapshotSelection;
  sourceToken: FolderTemplateSourceToken;
  acknowledgedWarnings: string[];
  name: string;
  description?: string;
  defaultTitle: string;
  category: PageTemplateCategory;
  locale: PageTemplateLocale;
};

export type FolderTemplateSnapshotPreview = {
  definition: CompositeTemplateDefinition;
  tree: TemplateNode[];
  roles: CollaborationTemplateDefinition['roleSlots'];
  warnings: FolderTemplateSnapshotWarning[];
  sourceToken: FolderTemplateSourceToken;
};

type SnapshotFolderRow = {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  updatedAt: Date;
  depth: number;
};

type SnapshotPageRow = {
  id: string;
  folderId: string | null;
  title: string;
  content: string;
  format: string;
  syncPath: string;
  sortOrder: number;
  updatedAt: Date;
};

type PreparedSnapshot = FolderTemplateSnapshotPreview & {
  tokenManifest: Record<string, unknown>;
};

export type ExistingRunSelectionInput = {
  source: { kind: 'page_selection' } | { kind: 'template_instantiation'; sourceInstantiationId: string };
  pageIds: string[];
  enabledTaskNodeIds?: string[];
  bindingEdits?: PageAgentBindingEdit[];
  roleSlotsByPage?: Array<{ pageId: string; roleSlotKey: string | null }>;
};

export type PreparedExistingRunSource = {
  name: string;
  source:
    | { kind: 'page_selection'; templateVersion: number }
    | { kind: 'composite'; compositeTemplateVersionId: string; templateInstantiationId: null; templateVersion: number };
  definition: CollaborationTemplateDefinition | null;
  taskPageIds: Record<string, string>;
  defaultBindings: RunPageSelectionBinding[];
  pageIds: string[];
  pages: Array<{ pageId: string; title: string }>;
  issues: Array<{ code: 'PAGE_ROLE_REQUIRED'; pageId: string }>;
  sourceInstantiationId: string | null;
};

@Injectable()
export class FolderTemplateSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly revisionWriter: SpaceRevisionWriterService,
    private readonly markdownResources: MarkdownResourceService,
    private readonly pageTemplates: PageTemplateService,
  ) {}

  preview(
    spaceId: string,
    rootFolderId: string,
    selection: FolderTemplateSnapshotSelection,
    principal: Principal,
  ): Promise<FolderTemplateSnapshotPreview> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCanManage(tx, principal, spaceId);
      return this.publicPreview(await this.prepare(tx, spaceId, rootFolderId, selection));
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: SNAPSHOT_TRANSACTION_TIMEOUT_MS,
    });
  }

  save(spaceId: string, input: FolderTemplateSnapshotSaveInput, principal: Principal) {
    if (principal.agentId) throw new BusinessException('PAGE_TEMPLATE_PERMISSION_DENIED');
    assertAcknowledgedWarnings(input.acknowledgedWarnings);
    const locale = PageTemplateLocaleSchema.parse(input.locale);
    if (locale !== input.selection.locale) throw new BusinessException('SOURCE_CHANGED');
    return this.prisma.$transaction(async (tx) => {
      await this.authorization.lockLiveHumanPrincipal(tx, principal);
      const lockedTx = await this.revisionWriter.lockSpace(tx, spaceId);
      await this.assertCanManage(lockedTx, principal, spaceId);
      const prepared = await this.prepare(
        lockedTx, spaceId, input.rootFolderId, input.selection,
      );
      if (!validSourceToken(input.sourceToken)
        || input.sourceToken.digest !== prepared.sourceToken.digest) {
        throw new BusinessException('SOURCE_CHANGED');
      }
      const attachmentWarning = prepared.warnings.some((warning) =>
        warning.code === 'ATTACHMENTS_NOT_COPIED');
      if (attachmentWarning && !input.acknowledgedWarnings.includes('ATTACHMENTS_NOT_COPIED')) {
        throw new BusinessException('PAGE_TEMPLATE_WARNING_CONFIRMATION_REQUIRED');
      }
      return this.pageTemplates.createCompositeSpaceTemplateInLockedTransaction(
        lockedTx,
        spaceId,
        {
          name: input.name,
          description: input.description,
          defaultTitle: input.defaultTitle,
          category: input.category,
          locale,
          definition: prepared.definition,
        },
        principal,
      );
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: SNAPSHOT_TRANSACTION_TIMEOUT_MS,
    });
  }

  /** Caller-transaction source resolver for existing Page/Folder Run preview and start. */
  async prepareExistingRunSource(
    tx: Prisma.TransactionClient,
    spaceId: string,
    scopeId: string,
    input: ExistingRunSelectionInput,
  ): Promise<PreparedExistingRunSource> {
    const scoped = await this.assertExistingPageScope(tx, spaceId, scopeId, input.pageIds);
    const { pageIds, scopePage, scopeFolder } = scoped;
    const pages = scoped.pages;
    const currentBindings = await tx.pageAgentBinding.findMany({
      where: { spaceId, pageId: { in: pageIds } },
      select: { pageId: true, agentId: true, roleSlotKey: true },
      take: pageIds.length,
    });
    const hypothetical = new Map(currentBindings.map((binding) => [binding.pageId, binding]));
    for (const edit of input.bindingEdits ?? []) {
      if (!pageIds.includes(edit.pageId)) throw new BusinessException('SOURCE_INVALID');
      if (edit.agentId === null) hypothetical.delete(edit.pageId);
      else hypothetical.set(edit.pageId, {
        pageId: edit.pageId, agentId: edit.agentId, roleSlotKey: edit.roleSlotKey,
      });
    }

    if (input.source.kind === 'page_selection') {
      const rootId = `selection-root:${scopeId}`;
      const details = snapshotDefinitionWithSourceMap({
        locale: 'en',
        nodes: [
          { sourceId: rootId, parentSourceId: null, kind: 'folder', order: 0, name: scopeFolder?.name ?? scopePage!.title },
          ...pages.map((page) => ({
            sourceId: page.id, parentSourceId: rootId, kind: 'page' as const,
            order: page.sortOrder, title: page.title, content: '', sourceSyncPath: '',
          })),
        ],
        bindings: pages.map((page) => {
          const binding = hypothetical.get(page.id);
          return {
            pageId: page.id,
            hasAgent: !!binding,
            roleSlotKey: binding?.roleSlotKey ?? null,
            ...(binding ? { agentId: binding.agentId } : {}),
          };
        }),
      }, { kind: 'simple_pages' }, selectedPageRoles(
        pages.map((page) => page.id), hypothetical, input.roleSlotsByPage,
      ));
      const collaboration = details.definition.collaboration;
      const missingRolePageIds = pages
        .filter((page) => selectedPageRole(page.id, hypothetical, input.roleSlotsByPage) === null)
        .map((page) => page.id);
      if (!collaboration) {
        if (input.enabledTaskNodeIds !== undefined) {
          throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', 'Enabled task selection is invalid');
        }
        return {
          name: scopeFolder?.name ?? scopePage!.title,
          source: { kind: 'page_selection', templateVersion: 1 },
          definition: null,
          taskPageIds: {},
          defaultBindings: [],
          pageIds,
          pages: pages.map((page) => ({ pageId: page.id, title: page.title })),
          issues: missingRolePageIds.map((pageId) => ({ code: 'PAGE_ROLE_REQUIRED', pageId })),
          sourceInstantiationId: null,
        };
      }
      const fullDefinition: CompositeTemplateDefinition = {
        ...details.definition,
        collaboration,
      };
      const selected = selectIndependentSimplePages(fullDefinition, input.enabledTaskNodeIds);
      const taskPageIds = Object.fromEntries(selected.taskTargets.map((target) => [
        target.taskNodeId, details.sourcePageIdByTemplateNodeId[target.pageNodeId],
      ]));
      const tasks = new Map(selected.workflow.nodes.flatMap((node) =>
        node.kind === 'agent_task' ? [[node.id, node] as const] : []));
      const defaultBindings = selected.taskTargets.flatMap((target) => {
        const pageId = taskPageIds[target.taskNodeId];
        const binding = pageId ? hypothetical.get(pageId) : undefined;
        const task = tasks.get(target.taskNodeId);
        return binding && task ? [{
          kind: 'task_default' as const,
          nodeId: task.id,
          roleSlotId: task.roleSlotId,
          agentId: binding.agentId,
        }] : [];
      });
      return {
        name: scopeFolder?.name ?? scopePage!.title,
        source: { kind: 'page_selection', templateVersion: 1 },
        definition: selected.workflow,
        taskPageIds,
        defaultBindings,
        pageIds,
        pages: pages.map((page) => ({ pageId: page.id, title: page.title })),
        issues: missingRolePageIds.map((pageId) => ({ code: 'PAGE_ROLE_REQUIRED', pageId })),
        sourceInstantiationId: null,
      };
    }

    if (!scopeFolder) throw new BusinessException('SOURCE_INVALID');
    const instantiation = await tx.templateInstantiation.findFirst({
      where: {
        id: input.source.sourceInstantiationId,
        spaceId,
        status: 'completed',
      },
      select: {
        id: true,
        compositeTemplateVersionId: true,
        compositeTemplateVersion: {
          select: {
            id: true, version: true, definition: true, schemaVersion: true,
            definitionHash: true,
            template: { select: { archivedAt: true } },
          },
        },
        nodes: { select: { templateNodeId: true, kind: true, pageId: true, folderId: true } },
      },
    });
    const version = instantiation?.compositeTemplateVersion;
    if (!instantiation || !version || version.template.archivedAt || version.schemaVersion !== 1
      || version.definition === null || !version.definitionHash) throw new BusinessException('SOURCE_INVALID');
    const parsed = CompositeTemplateDefinitionSchema.safeParse(structuredClone(version.definition));
    if (!parsed.success || validateCompositeDefinition(parsed.data).length > 0
      || hashCompositeDefinition(parsed.data) !== version.definitionHash) throw new BusinessException('SOURCE_INVALID');
    const root = parsed.data.nodes.find((node) => node.parentNodeId === null);
    if (!root || root.kind !== 'folder' || !instantiation.nodes.some((node) =>
      node.templateNodeId === root.nodeId && node.kind === 'folder' && node.folderId === scopeFolder.id)) {
      throw new BusinessException('SOURCE_INVALID');
    }
    const runtimeByTemplateNode = new Map(instantiation.nodes.flatMap((node) =>
      node.kind === 'page' && node.pageId ? [[node.templateNodeId, node.pageId] as const] : []));
    const runtimePageIds = new Set(runtimeByTemplateNode.values());
    if (pageIds.some((pageId) => !runtimePageIds.has(pageId))) throw new BusinessException('SOURCE_INVALID');
    const selected = selectCompositeCollaboration(parsed.data, input.enabledTaskNodeIds);
    const taskPageIds = Object.fromEntries(selected.taskTargets.map((target) => {
      const pageId = runtimeByTemplateNode.get(target.pageNodeId);
      if (!pageId || !pageIds.includes(pageId)) throw new BusinessException('SOURCE_INVALID');
      return [target.taskNodeId, pageId];
    }));
    const taskById = new Map(selected.workflow.nodes.flatMap((node) =>
      node.kind === 'agent_task' ? [[node.id, node] as const] : []));
    const defaultBindings = selected.taskTargets.flatMap((target) => {
      const pageId = taskPageIds[target.taskNodeId];
      const binding = hypothetical.get(pageId);
      const task = taskById.get(target.taskNodeId);
      return binding && task ? [{
        kind: 'task_default' as const, nodeId: task.id, roleSlotId: task.roleSlotId, agentId: binding.agentId,
      }] : [];
    });
    return {
      name: scopeFolder.name,
      source: {
        kind: 'composite', compositeTemplateVersionId: version.id,
        templateInstantiationId: null, templateVersion: version.version,
      },
      definition: selected.workflow,
      taskPageIds,
      defaultBindings,
      pageIds,
      pages: pages.map((page) => ({ pageId: page.id, title: page.title })),
      issues: [],
      sourceInstantiationId: instantiation.id,
    };
  }

  async assertExistingPageScope(
    tx: Prisma.TransactionClient,
    spaceId: string,
    scopeId: string,
    selectedPageIds: string[],
    options: { requireFolder?: boolean } = {},
  ): Promise<{
    pageIds: string[];
    scopePage: { id: string; title: string } | null;
    scopeFolder: { id: string; name: string } | null;
    pages: Array<{ id: string; title: string; sortOrder: number; folderId: string | null }>;
  }> {
    const pageIds = normalizeIds(selectedPageIds);
    if (pageIds.length === 0 || pageIds.length > COMPOSITE_TEMPLATE_LIMITS.pages) {
      throw new BusinessException('SOURCE_INVALID');
    }
    const [scopePage, scopeFolder] = await Promise.all([
      tx.page.findFirst({
        where: { id: scopeId, spaceId, deletedAt: null },
        select: { id: true, title: true },
      }),
      tx.folder.findFirst({
        where: { id: scopeId, spaceId, deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);
    if (!scopePage && !scopeFolder) throw new BusinessException('SOURCE_INVALID');
    if (options.requireFolder && !scopeFolder) throw new BusinessException('SOURCE_INVALID');
    if (scopePage && (pageIds.length !== 1 || pageIds[0] !== scopePage.id)) {
      throw new BusinessException('SOURCE_INVALID');
    }
    if (scopeFolder) {
      const folders = await this.readSelectedFolders(tx, spaceId, scopeFolder.id, []);
      const pages = await tx.page.findMany({
        where: { id: { in: pageIds }, spaceId, deletedAt: null, folderId: { in: folders.map((folder) => folder.id) } },
        select: { id: true },
        take: pageIds.length,
      });
      if (pages.length !== pageIds.length) throw new BusinessException('SOURCE_INVALID');
    }
    const pages = await tx.page.findMany({
      where: { id: { in: pageIds }, spaceId, deletedAt: null },
      select: { id: true, title: true, sortOrder: true, folderId: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      take: pageIds.length,
    });
    if (pages.length !== pageIds.length) throw new BusinessException('SOURCE_INVALID');
    return { pageIds, scopePage, scopeFolder, pages };
  }

  async discoverExistingFolderPages(
    tx: Prisma.TransactionClient,
    spaceId: string,
    folderId: string,
  ): Promise<Array<{ pageId: string; title: string }>> {
    const root = await tx.folder.findFirst({
      where: { id: folderId, spaceId, deletedAt: null }, select: { id: true },
    });
    if (!root) throw new BusinessException('SOURCE_INVALID');
    const folders = await this.readSelectedFolders(tx, spaceId, folderId, []);
    const pages = await tx.page.findMany({
      where: {
        spaceId, deletedAt: null,
        folderId: { in: folders.map((folder) => folder.id) },
      },
      select: { id: true, title: true, folderId: true, sortOrder: true },
      orderBy: [{ folderId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      take: COMPOSITE_TEMPLATE_LIMITS.pages + 1,
    });
    if (pages.length > COMPOSITE_TEMPLATE_LIMITS.pages) throw new BusinessException('SOURCE_TOO_LARGE');
    return pages.map((page) => ({ pageId: page.id, title: page.title }));
  }

  private async prepare(
    tx: Prisma.TransactionClient,
    spaceId: string,
    rootFolderId: string,
    selectionInput: FolderTemplateSnapshotSelection,
  ): Promise<PreparedSnapshot> {
    const selection = normalizeSelection(selectionInput);
    const space = await tx.space.findUnique({
      where: { id: spaceId, deletedAt: null },
      select: { contentTreeRevision: true },
    });
    if (!space) throw new BusinessException('SOURCE_INVALID');
    const root = await tx.folder.findFirst({
      where: { id: rootFolderId, spaceId, deletedAt: null },
      select: { id: true, spaceId: true, parentId: true, name: true, sortOrder: true, updatedAt: true },
    });
    if (!root) throw new BusinessException('SOURCE_INVALID');
    if (selection.excludedFolderIds.includes(rootFolderId)) {
      throw new BusinessException('SOURCE_INVALID');
    }
    await this.assertExcludedFolders(tx, spaceId, rootFolderId, selection.excludedFolderIds);
    const folders = await this.readSelectedFolders(
      tx, spaceId, rootFolderId, selection.excludedFolderIds,
    );
    const pages = await this.readSelectedPages(
      tx, spaceId, folders, selection.excludedPageIds,
    );
    assertRoleOverrides(selection.roleSlotsByPage ?? [], pages);
    const bindings = await tx.pageAgentBinding.findMany({
      where: { spaceId, pageId: { in: pages.map((page) => page.id) } },
      select: { pageId: true, agentId: true, roleSlotKey: true, updatedAt: true },
      orderBy: { pageId: 'asc' },
      take: COMPOSITE_TEMPLATE_LIMITS.pages,
    });
    const source: FolderSnapshotSource = {
      locale: selection.locale,
      nodes: [
        ...folders.map((folder) => ({
          sourceId: folder.id,
          parentSourceId: folder.id === rootFolderId ? null : folder.parentId,
          kind: 'folder' as const,
          order: folder.sortOrder,
          name: folder.name,
        })),
        ...pages.map((page) => ({
          sourceId: page.id,
          parentSourceId: page.folderId!,
          kind: 'page' as const,
          order: page.sortOrder,
          title: page.title,
          content: page.content,
          sourceSyncPath: page.syncPath,
        })),
      ],
      bindings: bindings.map((binding) => ({
        pageId: binding.pageId,
        hasAgent: true,
        roleSlotKey: binding.roleSlotKey,
        agentId: binding.agentId,
      })),
    };
    const workflowSource = await this.prepareWorkflowSource(
      tx, spaceId, rootFolderId, selection.source,
    );
    source.workflow = workflowSource.workflow;
    const definition = snapshotDefinition(source, selection.source, selection.roleSlotsByPage);
    const warningResolution = await this.markdownResources.resolveReferencedAttachmentsBatch(
      pages.map((page) => ({
        spaceId, sourceSyncPath: page.syncPath, body: page.content,
      })),
      tx,
    );
    const attachmentPageIds = pages.flatMap((page, index) => {
      const resolved = warningResolution[index];
      return resolved && (resolved.attachmentIds.length > 0
        || resolved.references.length > 0
        || resolved.errors.length > 0) ? [page.id] : [];
    });
    const warnings: FolderTemplateSnapshotWarning[] = [
      ...(attachmentPageIds.length > 0 ? [{
        code: 'ATTACHMENTS_NOT_COPIED' as const,
        affectedPageIds: attachmentPageIds,
        message: 'Attachments are not copied. Existing image references are preserved and may still point to original Space resources.',
      }] : []),
      {
        code: 'SOURCE_CONTENT_REVIEW_REQUIRED',
        affectedPageIds: pages.map((page) => page.id),
        message: 'Review saved Markdown and remove project-specific details before reusing this template.',
      },
    ];
    const pageStates = [];
    for (const page of pages) {
      const matching = await tx.pageVersion.findFirst({
        where: { pageId: page.id, title: page.title, content: page.content },
        select: { id: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      pageStates.push({
        pageId: page.id,
        updatedAt: page.updatedAt.toISOString(),
        titleHash: sha256(page.title),
        contentHash: sha256(page.content),
        matchingPageVersionId: matching?.id ?? null,
      });
    }
    const tokenManifest = {
      spaceId,
      rootFolderId,
      treeRevision: space.contentTreeRevision.toString(),
      selection,
      folders: folders.map((folder) => ({
        id: folder.id, parentId: folder.id === rootFolderId ? null : folder.parentId,
        name: folder.name, sortOrder: folder.sortOrder, updatedAt: folder.updatedAt.toISOString(),
      })),
      pages: pageStates,
      workflowSource: workflowSource.token,
      definitionHash: hashCompositeDefinition(definition),
    };
    const sourceToken: FolderTemplateSourceToken = {
      digest: sha256(stableJson(tokenManifest)),
      treeRevision: space.contentTreeRevision.toString(),
      pages: pageStates,
      workflowSource: workflowSource.token,
    };
    return {
      definition,
      tree: definition.nodes,
      roles: definition.collaboration?.workflow.roleSlots ?? [],
      warnings,
      sourceToken,
      tokenManifest,
    };
  }

  private async readSelectedFolders(
    tx: Prisma.TransactionClient,
    spaceId: string,
    rootFolderId: string,
    excludedFolderIds: string[],
  ): Promise<SnapshotFolderRow[]> {
    const exclusion = excludedFolderIds.length > 0
      ? Prisma.sql`AND child."id" NOT IN (${Prisma.join(excludedFolderIds)})`
      : Prisma.empty;
    const rows = await tx.$queryRaw<SnapshotFolderRow[]>(Prisma.sql`
      WITH RECURSIVE selected AS (
        SELECT folder."id", folder."parentId", folder."name", folder."sortOrder",
               folder."updatedAt", 1::integer AS depth
        FROM "Folder" AS folder
        WHERE folder."id" = ${rootFolderId}
          AND folder."spaceId" = ${spaceId}
          AND folder."deletedAt" IS NULL
        UNION ALL
        SELECT child."id", child."parentId", child."name", child."sortOrder",
               child."updatedAt", selected.depth + 1
        FROM "Folder" AS child
        INNER JOIN selected ON selected."id" = child."parentId"
        WHERE child."spaceId" = ${spaceId}
          AND child."deletedAt" IS NULL
          AND selected.depth < ${COMPOSITE_TEMPLATE_LIMITS.depth + 1}
          ${exclusion}
      )
      SELECT "id", "parentId", "name", "sortOrder", "updatedAt", depth
      FROM selected
      ORDER BY depth ASC, "sortOrder" ASC, "id" ASC
      LIMIT ${COMPOSITE_TEMPLATE_LIMITS.nodes + 1}
    `);
    if (rows.length === 0 || rows.length > COMPOSITE_TEMPLATE_LIMITS.nodes
      || rows.some((row) => row.depth > COMPOSITE_TEMPLATE_LIMITS.depth)) {
      throw new BusinessException('PAGE_TEMPLATE_INVALID');
    }
    return rows;
  }

  private async readSelectedPages(
    tx: Prisma.TransactionClient,
    spaceId: string,
    folders: SnapshotFolderRow[],
    excludedPageIds: string[],
  ): Promise<SnapshotPageRow[]> {
    const folderIds = folders.map((folder) => folder.id);
    if (excludedPageIds.length > 0) {
      const excluded = await tx.page.findMany({
        where: { id: { in: excludedPageIds }, spaceId, deletedAt: null },
        select: { id: true, folderId: true },
        take: excludedPageIds.length,
      });
      const selectedFolders = new Set(folderIds);
      if (excluded.length !== excludedPageIds.length
        || excluded.some((page) => !page.folderId || !selectedFolders.has(page.folderId))) {
        throw new BusinessException('SOURCE_INVALID');
      }
    }
    const metadata = await tx.page.findMany({
      where: {
        spaceId,
        deletedAt: null,
        folderId: { in: folderIds },
        ...(excludedPageIds.length > 0 ? { id: { notIn: excludedPageIds } } : {}),
      },
      select: {
        id: true, folderId: true, title: true, format: true, syncPath: true,
        sortOrder: true, updatedAt: true,
      },
      orderBy: [{ folderId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      take: COMPOSITE_TEMPLATE_LIMITS.pages + 1,
    });
    if (metadata.length === 0 || metadata.length > COMPOSITE_TEMPLATE_LIMITS.pages
      || folders.length + metadata.length > COMPOSITE_TEMPLATE_LIMITS.nodes
      || metadata.some((page) => page.format !== 'markdown')) {
      throw new BusinessException('PAGE_TEMPLATE_INVALID');
    }
    const depthByFolder = new Map(folders.map((folder) => [folder.id, folder.depth]));
    if (metadata.some((page) => !page.folderId
      || (depthByFolder.get(page.folderId) ?? COMPOSITE_TEMPLATE_LIMITS.depth)
        >= COMPOSITE_TEMPLATE_LIMITS.depth)) {
      throw new BusinessException('PAGE_TEMPLATE_INVALID');
    }
    const pages: SnapshotPageRow[] = [];
    let retainedBytes = folders.reduce((total, folder) => total + Buffer.byteLength(folder.name), 0);
    for (const item of metadata) {
      const current = await tx.page.findUnique({
        where: { id: item.id },
        select: {
          id: true, folderId: true, title: true, content: true, format: true,
          syncPath: true, sortOrder: true, updatedAt: true, spaceId: true, deletedAt: true,
        },
      });
      if (!current || current.spaceId !== spaceId || current.deletedAt
        || current.folderId !== item.folderId || current.format !== 'markdown') {
        throw new BusinessException('SOURCE_INVALID');
      }
      retainedBytes += Buffer.byteLength(current.title) + Buffer.byteLength(current.content);
      if (retainedBytes > COMPOSITE_TEMPLATE_LIMITS.totalTextBytes) {
        throw new BusinessException('PAGE_TEMPLATE_INVALID');
      }
      pages.push(current);
    }
    return pages;
  }

  private async assertExcludedFolders(
    tx: Prisma.TransactionClient,
    spaceId: string,
    rootFolderId: string,
    excludedFolderIds: string[],
  ): Promise<void> {
    if (excludedFolderIds.length === 0) return;
    const descendants = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH RECURSIVE ancestors AS (
        SELECT "id", "parentId", "id" AS "originId", 1::integer AS depth
        FROM "Folder"
        WHERE "id" IN (${Prisma.join(excludedFolderIds)})
          AND "spaceId" = ${spaceId}
          AND "deletedAt" IS NULL
        UNION ALL
        SELECT parent."id", parent."parentId", ancestors."originId", ancestors.depth + 1
        FROM "Folder" AS parent
        INNER JOIN ancestors ON parent."id" = ancestors."parentId"
        WHERE parent."spaceId" = ${spaceId}
          AND parent."deletedAt" IS NULL
          AND ancestors.depth < ${COMPOSITE_TEMPLATE_LIMITS.depth}
      )
      SELECT DISTINCT "originId" AS "id"
      FROM ancestors
      WHERE "id" = ${rootFolderId}
      LIMIT ${excludedFolderIds.length}
    `);
    if (descendants.length !== excludedFolderIds.length) {
      throw new BusinessException('SOURCE_INVALID');
    }
  }

  private async prepareWorkflowSource(
    tx: Prisma.TransactionClient,
    spaceId: string,
    rootFolderId: string,
    policy: FolderTemplateWorkflowSource,
  ): Promise<{
      workflow?: FolderSnapshotSource['workflow'];
      token: Record<string, unknown>;
    }> {
    if (policy.kind === 'structure_only' || policy.kind === 'simple_pages') {
      return { token: { kind: policy.kind } };
    }
    if (policy.kind === 'legacy_workflow') {
      const legacy = await tx.collaborationTemplate.findFirst({
        where: {
          id: policy.templateId,
          version: policy.version,
          archivedAt: null,
          OR: [{ system: true, spaceId: null }, { system: false, spaceId, scopeKey: spaceId }],
        },
        select: { id: true, version: true, definition: true },
      });
      if (!legacy) throw new BusinessException('SOURCE_INVALID');
      const parsed = CollaborationTemplateDefinitionSchema.safeParse(structuredClone(legacy.definition));
      if (!parsed.success || validateCollaborationTemplate(parsed.data).length > 0) {
        throw new BusinessException('SOURCE_INVALID');
      }
      const definitionHash = hashCollaborationTemplate(parsed.data);
      return {
        workflow: { definition: parsed.data, taskTargets: structuredClone(policy.taskTargets) },
        token: {
          kind: policy.kind, templateId: legacy.id, version: legacy.version, definitionHash,
        },
      };
    }

    const version = await tx.pageTemplateVersion.findFirst({
      where: {
        id: policy.versionId,
        template: { OR: [{ scope: 'system' }, { scope: 'space', spaceId }] },
      },
      select: {
        id: true, version: true, definition: true, schemaVersion: true, definitionHash: true,
        template: { select: { id: true, sourceLocale: true } },
      },
    });
    if (!version || version.definition === null || version.schemaVersion !== 1 || !version.definitionHash) {
      throw new BusinessException('SOURCE_INVALID');
    }
    const parsed = CompositeTemplateDefinitionSchema.safeParse(structuredClone(version.definition));
    if (!parsed.success || validateCompositeDefinition(parsed.data).length > 0
      || hashCompositeDefinition(parsed.data) !== version.definitionHash
      || !parsed.data.collaboration) {
      throw new BusinessException('SOURCE_INVALID');
    }
    const rootNode = parsed.data.nodes.find((node) => node.parentNodeId === null);
    if (!rootNode || rootNode.kind !== 'folder') throw new BusinessException('SOURCE_INVALID');
    const instantiation = await tx.templateInstantiation.findFirst({
      where: {
        spaceId,
        compositeTemplateVersionId: version.id,
        status: 'completed',
        nodes: {
          some: { templateNodeId: rootNode.nodeId, kind: 'folder', folderId: rootFolderId },
        },
      },
      select: {
        id: true,
        nodes: { select: { templateNodeId: true, kind: true, folderId: true, pageId: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!instantiation) throw new BusinessException('SOURCE_INVALID');
    const pageIdByTemplateNode = new Map(instantiation.nodes.flatMap((node) =>
      node.kind === 'page' && node.pageId ? [[node.templateNodeId, node.pageId] as const] : []));
    const taskTargets = parsed.data.collaboration.taskTargets.map((target) => {
      const pageId = pageIdByTemplateNode.get(target.pageNodeId);
      if (!pageId) throw new BusinessException('SOURCE_INVALID');
      return { taskNodeId: target.taskNodeId, pageId };
    });
    return {
      workflow: { definition: parsed.data.collaboration.workflow, taskTargets },
      token: {
        kind: policy.kind,
        versionId: version.id,
        templateId: version.template.id,
        version: version.version,
        definitionHash: version.definitionHash,
        instantiationId: instantiation.id,
      },
    };
  }

  private async assertCanManage(
    tx: Prisma.TransactionClient,
    principal: Principal,
    spaceId: string,
  ): Promise<void> {
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
  }

  private publicPreview(prepared: PreparedSnapshot): FolderTemplateSnapshotPreview {
    return {
      definition: prepared.definition,
      tree: prepared.tree,
      roles: prepared.roles,
      warnings: prepared.warnings,
      sourceToken: prepared.sourceToken,
    };
  }
}

function normalizeSelection(input: FolderTemplateSnapshotSelection): FolderTemplateSnapshotSelection {
  if (!input || !Array.isArray(input.excludedFolderIds) || !Array.isArray(input.excludedPageIds)
    || (input.roleSlotsByPage !== undefined && !Array.isArray(input.roleSlotsByPage))
    || !input.source || typeof input.source !== 'object' || Array.isArray(input.source)) {
    throw new BusinessException('PAGE_TEMPLATE_INVALID');
  }
  const excludedFolderIds = normalizeIds(input.excludedFolderIds);
  const excludedPageIds = normalizeIds(input.excludedPageIds);
  if (excludedFolderIds.length > COMPOSITE_TEMPLATE_LIMITS.nodes
    || excludedPageIds.length > COMPOSITE_TEMPLATE_LIMITS.pages) {
    throw new BusinessException('PAGE_TEMPLATE_INVALID');
  }
  const locale = PageTemplateLocaleSchema.parse(input.locale);
  const roleSlotsByPage = input.roleSlotsByPage?.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new BusinessException('PAGE_TEMPLATE_INVALID');
    }
    assertExactKeys(item, ['pageId', 'roleSlotKey']);
    return {
      pageId: requireId(item.pageId),
      roleSlotKey: item.roleSlotKey === null ? null : requireId(item.roleSlotKey),
    };
  });
  if (roleSlotsByPage && (roleSlotsByPage.length > COMPOSITE_TEMPLATE_LIMITS.pages
    || new Set(roleSlotsByPage.map((item) => item.pageId)).size !== roleSlotsByPage.length)) {
    throw new BusinessException('PAGE_TEMPLATE_INVALID');
  }
  const source = structuredClone(input.source);
  if (source.kind === 'template') {
    assertExactKeys(source, ['kind', 'versionId']);
    requireId(source.versionId);
  }
  else if (source.kind === 'legacy_workflow') {
    assertExactKeys(source, ['kind', 'taskTargets', 'templateId', 'version']);
    requireId(source.templateId);
    if (!Number.isInteger(source.version) || source.version < 1 || !Array.isArray(source.taskTargets)
      || source.taskTargets.length > COMPOSITE_TEMPLATE_LIMITS.nodes) {
      throw new BusinessException('PAGE_TEMPLATE_INVALID');
    }
    source.taskTargets = source.taskTargets.map((target) => {
      if (!target || typeof target !== 'object' || Array.isArray(target)) {
        throw new BusinessException('PAGE_TEMPLATE_INVALID');
      }
      assertExactKeys(target, ['pageId', 'taskNodeId']);
      return { taskNodeId: requireId(target.taskNodeId), pageId: requireId(target.pageId) };
    });
  } else if (source.kind === 'structure_only' || source.kind === 'simple_pages') {
    assertExactKeys(source, ['kind']);
  } else {
    throw new BusinessException('PAGE_TEMPLATE_INVALID');
  }
  return { excludedFolderIds, excludedPageIds, locale, roleSlotsByPage, source };
}

function assertExactKeys(value: object, expected: string[]): void {
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    throw new BusinessException('PAGE_TEMPLATE_INVALID');
  }
}

function normalizeIds(values: readonly string[]): string[] {
  const normalized = values.map(requireId).sort();
  if (new Set(normalized).size !== normalized.length) {
    throw new BusinessException('PAGE_TEMPLATE_INVALID');
  }
  return normalized;
}

function requireId(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new BusinessException('PAGE_TEMPLATE_INVALID');
  }
  return value;
}

function assertRoleOverrides(
  overrides: ReadonlyArray<{ pageId: string; roleSlotKey: string | null }>,
  pages: readonly SnapshotPageRow[],
): void {
  const pageIds = new Set(pages.map((page) => page.id));
  if (overrides.some((override) => !pageIds.has(override.pageId))) {
    throw new BusinessException('SOURCE_INVALID');
  }
}

function selectedPageRoles(
  pageIds: readonly string[],
  bindings: ReadonlyMap<string, { roleSlotKey: string | null }>,
  overrides: readonly { pageId: string; roleSlotKey: string | null }[] | undefined,
): Array<{ pageId: string; roleSlotKey: string | null }> {
  if (overrides !== undefined && !Array.isArray(overrides)) {
    throw new BusinessException('PAGE_TEMPLATE_INVALID');
  }
  const explicit = new Map((overrides ?? []).map((item) => [requireId(item.pageId), item.roleSlotKey]));
  if (explicit.size !== (overrides?.length ?? 0)
    || [...explicit.keys()].some((pageId) => !pageIds.includes(pageId))) {
    throw new BusinessException('SOURCE_INVALID');
  }
  return pageIds.flatMap((pageId) => {
    if (explicit.has(pageId)) {
      const value = explicit.get(pageId);
      return [{ pageId, roleSlotKey: value === null ? null : requireId(value!) }];
    }
    const binding = bindings.get(pageId);
    return binding ? [{ pageId, roleSlotKey: binding.roleSlotKey ?? 'owner' }] : [];
  });
}

function selectedPageRole(
  pageId: string,
  bindings: ReadonlyMap<string, { roleSlotKey: string | null }>,
  overrides: readonly { pageId: string; roleSlotKey: string | null }[] | undefined,
): string | null {
  const override = overrides?.find((item) => item.pageId === pageId);
  if (override) return override.roleSlotKey;
  const binding = bindings.get(pageId);
  return binding ? binding.roleSlotKey ?? 'owner' : null;
}

function assertAcknowledgedWarnings(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 10
    || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 128)
    || new Set(value).size !== value.length) {
    throw new BusinessException('PAGE_TEMPLATE_INVALID');
  }
}

function validSourceToken(value: FolderTemplateSourceToken): boolean {
  return !!value
    && typeof value.digest === 'string'
    && /^[a-f0-9]{64}$/u.test(value.digest)
    && typeof value.treeRevision === 'string'
    && Array.isArray(value.pages)
    && value.workflowSource !== null
    && typeof value.workflowSource === 'object';
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortObject(value));
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
