import { BadRequestException } from '@nestjs/common';
import { AssistTask, Prisma } from '@prisma/client';
import { AGENT_DIRECTORY_LIMITS as LIMIT, AgentDirectoryContext, AgentDirectoryScope, AgentTurnRequest } from './assist-session.types';

export class InaccessibleDirectoryException extends BadRequestException {}
export class DirectoryLimitException extends BadRequestException {}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 128;

/** Shared by HTTP validation and the service boundary, including explicit null handling. */
export function validDirectoryRequest(value: unknown): value is NonNullable<AgentTurnRequest['directory']> {
  return object(value) && Object.keys(value).every(key => key === 'folderId' || key === 'recursive')
    && (value.folderId === null || id(value.folderId))
    && (value.recursive === undefined || typeof value.recursive === 'boolean');
}

export function validDirectoryContext(value: unknown): value is AgentDirectoryContext {
  if (!object(value) || !(value.folderId === null || id(value.folderId)) || typeof value.title !== 'string'
    || typeof value.recursive !== 'boolean' || !Array.isArray(value.documents) || value.documents.length > LIMIT.documents) return false;
  if (value.unavailableReason !== undefined && (typeof value.unavailableReason !== 'string' || !value.unavailableReason.trim()
    || value.unavailableReason.length > 1000 || value.documents.length !== 0)) return false;
  let characters = value.title.length;
  if (characters > LIMIT.characters) return false;
  const ids = new Set<string>();
  for (const document of value.documents) {
    if (!object(document) || !id(document.pageId) || ids.has(document.pageId)
      || typeof document.title !== 'string' || typeof document.content !== 'string'
      || typeof document.updatedAt !== 'string' || !Number.isFinite(Date.parse(document.updatedAt))
      || !(document.folderId === null || id(document.folderId))) return false;
    ids.add(document.pageId);
    characters += document.title.length + document.content.length + document.pageId.length + document.updatedAt.length;
    if (characters > LIMIT.characters) return false;
  }
  return true;
}

export function directoryScope(directory: AgentDirectoryContext): AgentDirectoryScope {
  return { folderId: directory.folderId, title: directory.title, recursive: directory.recursive, pageCount: directory.documents.length,
    ...(directory.unavailableReason ? { unavailableReason: directory.unavailableReason } : {}) };
}

type Folder = { id: string; name: string; parentId: string | null };
export async function readDirectoryTree(tx: Prisma.TransactionClient, spaceId: string): Promise<Folder[]> {
  const folders = await tx.folder.findMany({ where: { spaceId, deletedAt: null },
    select: { id: true, name: true, parentId: true }, orderBy: { id: 'asc' }, take: LIMIT.folders + 1 });
  if (folders.length > LIMIT.folders) throw new DirectoryLimitException(`Directory tree exceeds the limit of ${LIMIT.folders} folders; choose a smaller Space`);
  return folders;
}

function scopeFilter(tree: Folder[], folderId: string | null, recursive: boolean): { title: string; where: Prisma.PageWhereInput } {
  const children = new Map<string | null, Folder[]>();
  for (const folder of tree) {
    const siblings = children.get(folder.parentId) || [];
    siblings.push(folder); children.set(folder.parentId, siblings);
  }
  // Only folders connected to the live Space root are readable. This excludes
  // descendants of soft-deleted folders, orphaned nodes and cycles.
  const visible = new Set<string>();
  const pending: (string | null)[] = [null];
  for (let i = 0; i < pending.length; i += 1) {
    for (const child of children.get(pending[i]) || []) {
      if (!visible.has(child.id)) { visible.add(child.id); pending.push(child.id); }
    }
  }
  if (folderId !== null && !visible.has(folderId)) throw new InaccessibleDirectoryException('Selected directory is no longer available in this Space');
  const ids = new Set<string>();
  if (folderId !== null) ids.add(folderId);
  if (recursive) {
    const descendants: (string | null)[] = [folderId];
    for (let i = 0; i < descendants.length; i += 1) {
      for (const child of children.get(descendants[i]) || []) {
        if (visible.has(child.id) && !ids.has(child.id)) { ids.add(child.id); descendants.push(child.id); }
      }
    }
  }
  return { title: folderId === null ? 'Space root' : tree.find(folder => folder.id === folderId)!.name,
    where: folderId === null ? { OR: [{ folderId: null }, { folderId: { in: [...ids] } }] } : { folderId: { in: [...ids] } } };
}

/** Verify a single live ancestor chain without loading an oversized Space tree. */
async function directoryTitle(tx: Prisma.TransactionClient, spaceId: string, folderId: string | null): Promise<string> {
  let title = 'Space root';
  let current = folderId;
  const seen = new Set<string>();
  while (current !== null) {
    if (seen.has(current) || seen.size >= LIMIT.folders) throw new InaccessibleDirectoryException('Selected directory ancestry cannot be verified');
    seen.add(current);
    const folder = await tx.folder.findFirst({ where: { id: current, spaceId, deletedAt: null }, select: { id: true, name: true, parentId: true } });
    if (!folder) throw new InaccessibleDirectoryException('Selected directory is no longer available in this Space');
    if (current === folderId) title = folder.name;
    current = folder.parentId;
  }
  return title;
}

export async function unavailableDirectory(tx: Prisma.TransactionClient, spaceId: string,
  request: NonNullable<AgentTurnRequest['directory']>, error: DirectoryLimitException): Promise<AgentDirectoryContext> {
  return { folderId: request.folderId, title: await directoryTitle(tx, spaceId, request.folderId),
    recursive: request.recursive ?? true, documents: [], unavailableReason: error.message };
}

/** Called only after the human principal and Space have been locked/authorized. */
export async function captureDirectory(tx: Prisma.TransactionClient, spaceId: string,
  request: NonNullable<AgentTurnRequest['directory']>): Promise<AgentDirectoryContext> {
  const recursive = request.recursive ?? true;
  const scope = scopeFilter(await readDirectoryTree(tx, spaceId), request.folderId, recursive);
  const where = { spaceId, deletedAt: null, ...scope.where };
  const count = await tx.page.count({ where });
  if (count > LIMIT.documents) throw new DirectoryLimitException(`Directory exceeds the limit of ${LIMIT.documents} documents; choose a smaller directory or disable recursive access`);
  const directory: AgentDirectoryContext = { folderId: request.folderId, title: scope.title, recursive, documents: [] };
  let characters = JSON.stringify(directory).length;
  const assertSize = () => {
    if (characters > LIMIT.characters) throw new DirectoryLimitException(`Directory is too large (maximum ${LIMIT.characters} characters); choose a smaller directory or disable recursive access`);
  };
  assertSize();
  // The Space lock makes offset pages stable. Never load the full set of bodies
  // before checking the budget: each batch holds at most 25 page bodies.
  const batchSize = 25;
  for (let skip = 0; skip < count; skip += batchSize) {
    const pages = await tx.page.findMany({ where,
      select: { id: true, title: true, content: true, updatedAt: true, folderId: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: Math.min(batchSize, count - skip), skip });
    if (pages.length !== Math.min(batchSize, count - skip)) throw new InaccessibleDirectoryException('Directory changed while capturing its documents; retry the request');
    for (const page of pages) {
      const document = { pageId: page.id, title: page.title, content: page.content, updatedAt: page.updatedAt.toISOString(), folderId: page.folderId ?? null };
      characters += JSON.stringify(document).length + (directory.documents.length ? 1 : 0);
      assertSize();
      directory.documents.push(document);
    }
  }
  return directory;
}

/** Revalidate identifiers and live membership without fetching current document bodies. */
export async function assertDirectoryReadable(tx: Prisma.TransactionClient, spaceId: string,
  directory: AgentDirectoryContext, tree?: Folder[]): Promise<void> {
  if (directory.unavailableReason) { await directoryTitle(tx, spaceId, directory.folderId); return; }
  const scope = scopeFilter(tree ?? await readDirectoryTree(tx, spaceId), directory.folderId, directory.recursive);
  if (!directory.documents.length) return;
  const count = await tx.page.count({ where: { id: { in: directory.documents.map(document => document.pageId) }, spaceId, deletedAt: null, ...scope.where } });
  if (count !== directory.documents.length) throw new InaccessibleDirectoryException('Session directory documents are no longer available in the selected directory');
}

/** Keep directory bodies inside PostgreSQL during history, listing and authorization. */
export async function readSessionTurnMetadata(tx: Prisma.TransactionClient, sessionId: string, take: number): Promise<AssistTask[]> {
  return tx.$queryRaw<AssistTask[]>(Prisma.sql`
    SELECT t."id", t."status", t."intent", t."pageSnapshot", t."sessionId", t."clientRequestId", t."mode",
      CASE WHEN jsonb_typeof(t."context") = 'object'
          AND jsonb_typeof(t."context"->'directory') = 'object'
          AND jsonb_typeof(t."context"#>'{directory,documents}') = 'array'
        THEN jsonb_set(t."context", '{directory,documents}', COALESCE((
          SELECT jsonb_agg(CASE WHEN jsonb_typeof(d.value) = 'object' AND jsonb_typeof(d.value->'content') = 'string'
            THEN jsonb_set(d.value, '{content}', '""'::jsonb) ELSE d.value END ORDER BY d.ordinal)
          FROM jsonb_array_elements(t."context"#>'{directory,documents}') WITH ORDINALITY AS d(value, ordinal)
        ), '[]'::jsonb)) ELSE t."context" END AS "context",
      t."progressText", t."progressVersion", t."result", t."error", t."attempts", t."maxAttempts",
      t."spaceId", t."pageId", t."requestedByUserId", t."lockedAt", t."leaseOwner", t."leaseExpiresAt",
      t."nextAttemptAt", t."createdAt", t."updatedAt", t."completedAt"
    FROM "AssistTask" t WHERE t."sessionId" = ${sessionId}
    ORDER BY t."createdAt" ASC, t."id" ASC LIMIT ${take}
  `);
}
