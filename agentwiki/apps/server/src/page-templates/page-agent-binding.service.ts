import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { agentRoleAllowsScope } from '@neomei/agentwiki-sync-protocol';
import {
  AuthorizationService,
  type Principal,
} from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import type { SpaceTreeLockedTransaction } from '../core/sync/space-revision-writer.service';
import { ContentTreeService } from '../content-tree/content-tree.service';
import { PrismaService } from '../database/prisma.service';

export type PageAgentBindingEdit = {
  pageId: string;
  agentId: string | null;
  roleSlotKey: string | null;
  expectedUpdatedAt: string | null;
};

export type PageAgentBindingSnapshot = {
  pageId: string;
  agentId: string | null;
  roleSlotKey: string | null;
  updatedAt: string | null;
};

export type PageAgentBindingScopeInput = {
  pageIds: string[];
  expectedTreeRevision: bigint;
  edits: PageAgentBindingEdit[];
};

type BindingRow = {
  pageId: string;
  agentId: string;
  roleSlotKey: string | null;
  updatedAt: Date;
};

@Injectable()
export class PageAgentBindingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly contentTree: ContentTreeService,
  ) {}

  async previewBindings(
    spaceId: string,
    pageIds: string[],
    principal: Principal,
  ): Promise<{ treeRevision: bigint; pages: PageAgentBindingSnapshot[] }> {
    assertExplicitPageIds(pageIds);
    return this.prisma.$transaction(async (tx) => {
      await this.authorization.assertLiveHumanSpaceAccess(
        tx, principal, spaceId, ['owner', 'editor'],
      );
      const space = await tx.space.findUnique({
        where: { id: spaceId, deletedAt: null },
        select: { contentTreeRevision: true },
      });
      if (!space) throw new BusinessException('RESOURCE_NOT_FOUND');
      const pages = await this.readBindings(tx, spaceId, pageIds);
      return { treeRevision: space.contentTreeRevision, pages };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async setBindingsInScope(
    spaceId: string,
    input: PageAgentBindingScopeInput,
    principal: Principal,
  ): Promise<PageAgentBindingSnapshot[]> {
    assertScopeMatchesEdits(input.pageIds, input.edits);
    if (typeof input.expectedTreeRevision !== 'bigint' || input.expectedTreeRevision < 0n) {
      throw new BusinessException('PAGE_TEMPLATE_INVALID');
    }
    return this.prisma.$transaction(async (tx) => {
      // Preserve the repository-wide human -> Space-advisory lock prefix.
      await this.authorization.lockLiveHumanPrincipal(tx, principal);
      const lockedTx = await this.contentTree.lockPageMutationSpace(
        tx, spaceId, input.expectedTreeRevision,
      );
      return this.setBindings(lockedTx, spaceId, input.edits, principal);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Transaction primitive for template instantiation and other callers that
   * already own the Space content-tree lock in a serializable transaction. It
   * never starts a nested transaction and never advances the tree revision.
   */
  async setBindings(
    tx: Prisma.TransactionClient | SpaceTreeLockedTransaction,
    spaceId: string,
    edits: readonly PageAgentBindingEdit[],
    principal: Principal,
  ): Promise<PageAgentBindingSnapshot[]> {
    assertValidEdits(edits);
    await this.authorization.assertLiveHumanSpaceAccess(
      tx, principal, spaceId, ['owner', 'editor'],
    );
    const pageIds = edits.map((item) => item.pageId);
    await assertPagesBelongToSpace(tx, spaceId, pageIds);

    const agentIds = [...new Set(edits.flatMap((item) => item.agentId ? [item.agentId] : []))];
    await assertAgentsCanExecute(tx, spaceId, agentIds);
    const currentRows = await tx.pageAgentBinding.findMany({
      where: { pageId: { in: pageIds } },
      select: { pageId: true, agentId: true, roleSlotKey: true, updatedAt: true },
    });
    const currentByPage = new Map(currentRows.map((row) => [row.pageId, row]));
    const results: PageAgentBindingSnapshot[] = [];

    for (const item of edits) {
      const before = currentByPage.get(item.pageId) as BindingRow | undefined;
      assertExpectedVersion(before, item.expectedUpdatedAt);
      if ((before?.agentId ?? null) === item.agentId
        && (before?.roleSlotKey ?? null) === item.roleSlotKey) {
        results.push(snapshot(item.pageId, before));
        continue;
      }

      let updatedAt: Date | null;
      if (item.agentId === null) {
        if (!before) {
          results.push(snapshot(item.pageId, undefined));
          continue;
        }
        const deleted = await tx.pageAgentBinding.deleteMany({
          where: { pageId: item.pageId, spaceId, updatedAt: before.updatedAt },
        });
        if (deleted.count !== 1) throw new BusinessException('RESOURCE_CONFLICT');
        updatedAt = null;
      } else if (!before) {
        try {
          const created = await tx.pageAgentBinding.create({ data: {
            pageId: item.pageId,
            spaceId,
            agentId: item.agentId,
            roleSlotKey: item.roleSlotKey,
            assignedByUserId: principal.userId,
          } });
          updatedAt = created.updatedAt;
        } catch (error) {
          if (isUniqueConflict(error)) throw new BusinessException('RESOURCE_CONFLICT');
          throw error;
        }
      } else {
        updatedAt = monotonicTimestamp(before.updatedAt);
        const updated = await tx.pageAgentBinding.updateMany({
          where: { pageId: item.pageId, spaceId, updatedAt: before.updatedAt },
          data: {
            agentId: item.agentId,
            roleSlotKey: item.roleSlotKey,
            assignedByUserId: principal.userId,
            updatedAt,
          },
        });
        if (updated.count !== 1) throw new BusinessException('RESOURCE_CONFLICT');
      }

      await tx.pageAgentBindingEvent.create({ data: {
        pageId: item.pageId,
        spaceId,
        beforeAgentId: before?.agentId ?? null,
        afterAgentId: item.agentId,
        beforeRoleSlotKey: before?.roleSlotKey ?? null,
        afterRoleSlotKey: item.roleSlotKey,
        actorUserId: principal.userId,
      } });
      results.push({
        pageId: item.pageId,
        agentId: item.agentId,
        roleSlotKey: item.roleSlotKey,
        updatedAt: updatedAt?.toISOString() ?? null,
      });
    }
    return results;
  }

  private async readBindings(
    tx: Prisma.TransactionClient,
    spaceId: string,
    pageIds: string[],
  ): Promise<PageAgentBindingSnapshot[]> {
    await assertPagesBelongToSpace(tx, spaceId, pageIds);
    const rows = await tx.pageAgentBinding.findMany({
      where: { pageId: { in: pageIds } },
      select: { pageId: true, agentId: true, roleSlotKey: true, updatedAt: true },
    });
    const byPage = new Map(rows.map((row) => [row.pageId, row]));
    return pageIds.map((pageId) => snapshot(pageId, byPage.get(pageId)));
  }
}

function assertScopeMatchesEdits(pageIds: string[], edits: readonly PageAgentBindingEdit[]): void {
  assertExplicitPageIds(pageIds);
  assertValidEdits(edits);
  if (pageIds.length !== edits.length) throw new BusinessException('PAGE_TEMPLATE_INVALID');
  const editIds = new Set(edits.map((item) => item.pageId));
  if (editIds.size !== pageIds.length || pageIds.some((pageId) => !editIds.has(pageId))) {
    throw new BusinessException('PAGE_TEMPLATE_INVALID');
  }
}

function assertExplicitPageIds(pageIds: readonly string[]): void {
  if (pageIds.length === 0 || pageIds.some((pageId) => typeof pageId !== 'string' || !pageId.trim())
    || new Set(pageIds).size !== pageIds.length) {
    throw new BusinessException('PAGE_TEMPLATE_INVALID');
  }
}

function assertValidEdits(edits: readonly PageAgentBindingEdit[]): void {
  assertExplicitPageIds(edits.map((item) => item.pageId));
  for (const item of edits) {
    if ((item.agentId !== null && (typeof item.agentId !== 'string' || !item.agentId.trim()))
      || (item.roleSlotKey !== null && (typeof item.roleSlotKey !== 'string' || !item.roleSlotKey.trim()))
      || (item.agentId === null && item.roleSlotKey !== null)
      || (item.expectedUpdatedAt !== null && parseVersion(item.expectedUpdatedAt) === null)) {
      throw new BusinessException('PAGE_TEMPLATE_INVALID');
    }
  }
}

async function assertPagesBelongToSpace(
  tx: Prisma.TransactionClient,
  spaceId: string,
  pageIds: string[],
): Promise<void> {
  const pages = await tx.page.findMany({
    where: { id: { in: pageIds } },
    select: { id: true, spaceId: true, deletedAt: true },
  });
  const valid = new Set(pages
    .filter((page) => page.spaceId === spaceId && page.deletedAt === null)
    .map((page) => page.id));
  if (valid.size !== pageIds.length) throw new BusinessException('RESOURCE_NOT_FOUND');
}

async function assertAgentsCanExecute(
  tx: Prisma.TransactionClient,
  spaceId: string,
  agentIds: string[],
): Promise<void> {
  if (agentIds.length === 0) return;
  const grants = await tx.agentGrant.findMany({
    where: { spaceId, agentId: { in: agentIds } },
    include: {
      agent: {
        select: {
          id: true,
          status: true,
          revokedAt: true,
          owner: { select: { deletedAt: true, lockedAt: true } },
        },
      },
      space: { select: { deletedAt: true } },
    },
  });
  const byAgent = new Map(grants.map((grant) => [grant.agentId, grant]));
  for (const agentId of agentIds) {
    const grant = byAgent.get(agentId);
    if (!grant) throw new BusinessException('COLLABORATION_AGENT_CANNOT_EXECUTE');
    if (grant.agent.status !== 'active' || grant.agent.revokedAt
      || grant.agent.owner.deletedAt || grant.agent.owner.lockedAt
      || grant.space.deletedAt) {
      throw new BusinessException('COLLABORATION_AGENT_INACTIVE');
    }
    if (!agentRoleAllowsScope(grant.role, 'collaboration:execute')) {
      throw new BusinessException('COLLABORATION_AGENT_CANNOT_EXECUTE');
    }
  }
}

function assertExpectedVersion(before: BindingRow | undefined, expected: string | null): void {
  if (!before && expected === null) return;
  const parsed = expected === null ? null : parseVersion(expected);
  if (!before || !parsed || before.updatedAt.getTime() !== parsed.getTime()) {
    throw new BusinessException('RESOURCE_CONFLICT');
  }
}

function parseVersion(value: string): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monotonicTimestamp(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

function snapshot(pageId: string, row?: BindingRow): PageAgentBindingSnapshot {
  return {
    pageId,
    agentId: row?.agentId ?? null,
    roleSlotKey: row?.roleSlotKey ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
