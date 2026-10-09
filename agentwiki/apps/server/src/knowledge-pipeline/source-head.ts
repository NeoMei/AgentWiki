import { Prisma } from '@prisma/client';
import { BusinessException } from '../core/filters/business-error';
import { AuthorizationService, Principal } from '../core/authorization/authorization.service';
import { SpaceRevisionWriterService } from '../core/sync/space-revision-writer.service';

export type SourceHead = { sourceId: string; sourceVersionId: string; generation: number };
export function sourceVersionConflict(): never {
  throw new BusinessException('SOURCE_VERSION_CONFLICT', '来源已变化或候选缺少固定输入，请重新生成 / Source input changed; regenerate the candidate');
}

/** Caller holds identity -> Space advisory -> Space row before taking Source locks. */
export async function lockSourceHead(tx: Prisma.TransactionClient, sourceId: string, spaceId: string): Promise<SourceHead | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "Source" WHERE "id" = ${sourceId} AND "spaceId" = ${spaceId} FOR NO KEY UPDATE
  `);
  if (rows.length !== 1) sourceVersionConflict();
  const source = await tx.source.findUnique({ where: { id: sourceId } });
  if (!source || source.spaceId !== spaceId || source.status !== 'active' || source.archivedAt) sourceVersionConflict();
  if (!source.currentSourceVersionId) return null;
  if (!Number.isInteger(source.currentSourceGeneration) || source.currentSourceGeneration <= 0) sourceVersionConflict();
  const version = await tx.sourceVersion.findFirst({ where: { id: source.currentSourceVersionId, sourceId }, select: { id: true } });
  if (!version) sourceVersionConflict();
  return { sourceId, sourceVersionId: version.id, generation: source.currentSourceGeneration };
}

export function assertSourceHeadMatches(head: SourceHead | null, input: { sourceId: string; sourceVersionId: string | null; generation: number | null }): void {
  // Historical inputs remain untracked; deleting a tracked head cannot revive a pinned Run.
  if (!head) { if (input.generation != null) sourceVersionConflict(); return; }
  if (head.sourceId !== input.sourceId || head.sourceVersionId !== input.sourceVersionId || head.generation !== input.generation) sourceVersionConflict();
}

export function nextSourceGeneration(current: number, sameCurrentVersion: boolean): number {
  if (!Number.isInteger(current) || current < 0 || current > 2147483647 || (!sameCurrentVersion && current === 2147483647)) sourceVersionConflict();
  return sameCurrentVersion ? current : current + 1;
}

export async function lockSourceMutationSpace(tx: Prisma.TransactionClient, principal: Principal, spaceId: string, scopes: string[], authorization: AuthorizationService, revisions: SpaceRevisionWriterService) {
  let locked;
  if (principal.agentId) {
    locked = await authorization.lockLiveAgentWriteAccessAcrossSpaceBoundary(tx, principal, spaceId, scopes, () => revisions.lockSyncSpace(tx, spaceId));
  } else {
    await authorization.lockLiveHumanPrincipal(tx, principal);
    await authorization.lockLiveHumanPersonalCredential(tx, principal);
    locked = await revisions.lockSyncSpace(tx, spaceId);
    await authorization.assertLiveHumanSpaceAccess(tx, principal, spaceId, ['owner', 'editor']);
    await authorization.assertLiveHumanCredential(tx, principal, scopes);
  }
  if (!locked) throw new BusinessException('SPACE_ACCESS_DENIED');
  return locked;
}

/** Validate the entire accepted set before any Approval/Page mutation, including relation-only Runs. */
export async function validateSourcePublication(tx: Prisma.TransactionClient, changeSet: { runId?: string | null; spaceId: string }, items: Array<{ id: string; type: string; payload: unknown }>, autoPublish: boolean): Promise<Map<string, SourceHead>> {
  const run = changeSet.runId ? await tx.ingestRun.findUnique({ where: { id: changeSet.runId } }) : null;
  if (changeSet.runId && (!run || run.spaceId !== changeSet.spaceId)) sourceVersionConflict();
  const sources = new Set<string>(run ? [run.sourceId] : []);
  for (const item of items) {
    const payload = item.payload as any;
    if (payload?.before && Object.prototype.hasOwnProperty.call(payload.before, 'sourceGeneration')) sourceVersionConflict();
    if (payload?.changes && ['sourceGeneration', 'sourceId', 'sourceVersionId', 'sourcePath'].some(key => Object.prototype.hasOwnProperty.call(payload.changes, key))) sourceVersionConflict();
    if (payload?.sourceId) sources.add(payload.sourceId);
  }
  const heads = new Map<string, SourceHead | null>();
  for (const id of [...sources].sort()) heads.set(id, await lockSourceHead(tx, id, changeSet.spaceId));
  if (run) {
    const head = heads.get(run.sourceId) ?? null;
    assertSourceHeadMatches(head, { sourceId: run.sourceId, sourceVersionId: run.inputSourceVersionId, generation: run.inputSourceGeneration });
    if (head && autoPublish) throw new BusinessException('APPROVAL_REQUIRED', 'Tracked source updates require human review');
  }
  const validated = new Map<string, SourceHead>();
  for (const item of items) {
    const payload = item.payload as any;
    if (!['create_page', 'update_page', 'archive_page'].includes(item.type)) continue;
    const runHead = run ? heads.get(run.sourceId) : null;
    const head = payload?.sourceId ? heads.get(payload.sourceId) : null;
    if (head || runHead) {
      if (!run || !head || payload.sourceId !== run.sourceId || payload.sourceVersionId !== run.inputSourceVersionId || payload.sourceGeneration !== run.inputSourceGeneration) sourceVersionConflict();
      assertSourceHeadMatches(head, { sourceId: payload.sourceId, sourceVersionId: payload.sourceVersionId, generation: payload.sourceGeneration });
      validated.set(item.id, head);
    } else if (payload?.sourceGeneration != null) sourceVersionConflict();
    if (payload?.sourceVersionId) {
      if (!payload.sourceId || !await tx.sourceVersion.findFirst({ where: { id: payload.sourceVersionId, sourceId: payload.sourceId }, select: { id: true } })) sourceVersionConflict();
    }
  }
  return validated;
}
