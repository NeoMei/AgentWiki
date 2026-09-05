import { Prisma } from '@prisma/client';
import { BusinessException } from '../core/filters/business-error';
import type { SpaceTreeLockedTransaction } from '../core/sync/space-revision-writer.service';
import {
  PageAgentBindingService,
  type PageAgentBindingEdit,
} from './page-agent-binding.service';

const principal = { userId: 'human-1', platformRole: 'user' as const };
const firstVersion = new Date('2026-09-05T00:00:00.000Z');

function edit(overrides: Partial<PageAgentBindingEdit> = {}): PageAgentBindingEdit {
  return {
    pageId: 'page-1',
    agentId: 'agent-1',
    roleSlotKey: 'writer',
    expectedUpdatedAt: null,
    ...overrides,
  };
}

function makeHarness() {
  const pages = [
    { id: 'page-1', spaceId: 'space-1', deletedAt: null },
    { id: 'page-2', spaceId: 'space-1', deletedAt: null },
    { id: 'foreign-page', spaceId: 'space-2', deletedAt: null },
  ];
  const bindings = new Map<string, any>();
  const events: any[] = [];
  const tx: any = Object.assign({
    space: {
      findUnique: jest.fn().mockResolvedValue({ contentTreeRevision: 7n }),
    },
    page: {
      findMany: jest.fn(async ({ where }: any) => pages.filter((page) => where.id.in.includes(page.id))),
    },
    agentGrant: {
      findMany: jest.fn(async ({ where }: any) => where.agentId.in.map((agentId: string) => ({
        id: `grant-${agentId}`,
        agentId,
        spaceId: where.spaceId,
        role: agentId === 'reader-agent' ? 'reader' : 'editor',
        agent: {
          id: agentId,
          status: agentId === 'inactive-agent' ? 'inactive' : 'active',
          revokedAt: agentId === 'revoked-agent' ? firstVersion : null,
          owner: {
            deletedAt: agentId === 'deleted-owner-agent' ? firstVersion : null,
            lockedAt: agentId === 'locked-owner-agent' ? firstVersion : null,
          },
        },
        space: { deletedAt: null },
      }))),
    },
    pageAgentBinding: {
      findMany: jest.fn(async ({ where }: any) => where.pageId.in
        .map((pageId: string) => bindings.get(pageId)).filter(Boolean)),
      create: jest.fn(async ({ data }: any) => {
        const value = { id: `binding-${data.pageId}`, ...data, createdAt: firstVersion, updatedAt: firstVersion };
        bindings.set(data.pageId, value);
        return value;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const before = bindings.get(where.pageId);
        if (!before || before.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
        bindings.set(where.pageId, { ...before, ...data });
        return { count: 1 };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const before = bindings.get(where.pageId);
        if (!before || before.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
        bindings.delete(where.pageId);
        return { count: 1 };
      }),
    },
    pageAgentBindingEvent: {
      create: jest.fn(async ({ data }: any) => { events.push(data); return data; }),
    },
  }, { contentTreeRevision: 7n });
  const lockedTx = tx as SpaceTreeLockedTransaction;
  const prisma: any = {
    $transaction: jest.fn(async (callback: (transaction: any) => unknown, options: unknown) => {
      expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return callback(tx);
    }),
  };
  const authorization: any = {
    lockLiveHumanPrincipal: jest.fn().mockResolvedValue({ id: principal.userId }),
    assertLiveHumanSpaceAccess: jest.fn().mockResolvedValue({ role: 'editor' }),
  };
  const contentTree: any = {
    lockPageMutationSpace: jest.fn(async (_tx: unknown, _spaceId: string, revision?: bigint) => {
      if (revision !== undefined && revision !== tx.contentTreeRevision) throw new Error('tree-stale');
      return tx;
    }),
  };
  return {
    service: new PageAgentBindingService(prisma, authorization, contentTree),
    prisma, authorization, contentTree, tx, lockedTx, bindings, events,
  };
}

function compileOnlyRequiresSpaceTreeLock(service: PageAgentBindingService) {
  // @ts-expect-error The transaction primitive must reject an unbranded transaction.
  return service.setBindings({} as Prisma.TransactionClient, 'space-1', [edit()], principal);
}
void compileOnlyRequiresSpaceTreeLock;

describe('PageAgentBindingService', () => {
  it('rejects a human without current content-write permission', async () => {
    const h = makeHarness();
    h.authorization.assertLiveHumanSpaceAccess.mockRejectedValueOnce(
      new BusinessException('SPACE_ACCESS_DENIED'),
    );
    await expect(h.service.setBindings(h.lockedTx, 'space-1', [edit()], principal))
      .rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    expect(h.tx.pageAgentBinding.create).not.toHaveBeenCalled();
  });

  it('rejects a Page that actually belongs to another Space', async () => {
    const h = makeHarness();
    await expect(h.service.setBindings(
      h.lockedTx, 'space-1', [edit({ pageId: 'foreign-page' })], principal,
    )).rejects.toMatchObject({ businessCode: 'RESOURCE_NOT_FOUND' });
    expect(h.tx.agentGrant.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['inactive-agent', 'COLLABORATION_AGENT_INACTIVE'],
    ['revoked-agent', 'COLLABORATION_AGENT_INACTIVE'],
    ['deleted-owner-agent', 'COLLABORATION_AGENT_INACTIVE'],
    ['locked-owner-agent', 'COLLABORATION_AGENT_INACTIVE'],
    ['reader-agent', 'COLLABORATION_AGENT_CANNOT_EXECUTE'],
  ])('rejects non-compliant Agent %s', async (agentId, code) => {
    const h = makeHarness();
    await expect(h.service.setBindings(
      h.lockedTx, 'space-1', [edit({ agentId })], principal,
    )).rejects.toMatchObject({ businessCode: code });
    expect(h.tx.pageAgentBinding.create).not.toHaveBeenCalled();
  });

  it('binds an authorized Agent without requiring a realtime session', async () => {
    const h = makeHarness();
    await expect(h.service.setBindings(h.lockedTx, 'space-1', [edit()], principal)).resolves.toEqual([{
      pageId: 'page-1', agentId: 'agent-1', roleSlotKey: 'writer',
      updatedAt: firstVersion.toISOString(),
    }]);
    expect(h.tx).not.toHaveProperty('agentSession');
    expect(h.events).toEqual([{
      pageId: 'page-1', spaceId: 'space-1', beforeAgentId: null,
      afterAgentId: 'agent-1', beforeRoleSlotKey: null, afterRoleSlotKey: 'writer',
      actorUserId: 'human-1',
    }]);
  });

  it('rejects a stale binding version and preserves the current relationship', async () => {
    const h = makeHarness();
    h.bindings.set('page-1', {
      id: 'binding-1', pageId: 'page-1', spaceId: 'space-1', agentId: 'agent-1',
      roleSlotKey: 'writer', assignedByUserId: 'human-1', createdAt: firstVersion,
      updatedAt: firstVersion,
    });
    await expect(h.service.setBindings(h.lockedTx, 'space-1', [edit({
      agentId: 'agent-2', expectedUpdatedAt: '2026-09-04T00:00:00.000Z',
    })], principal)).rejects.toMatchObject({ businessCode: 'RESOURCE_CONFLICT' });
    expect(h.bindings.get('page-1').agentId).toBe('agent-1');
    expect(h.events).toEqual([]);
  });

  it('does not update or audit an exact no-op', async () => {
    const h = makeHarness();
    h.bindings.set('page-1', {
      id: 'binding-1', pageId: 'page-1', spaceId: 'space-1', agentId: 'agent-1',
      roleSlotKey: 'writer', assignedByUserId: 'human-1', createdAt: firstVersion,
      updatedAt: firstVersion,
    });
    await expect(h.service.setBindings(h.lockedTx, 'space-1', [edit({
      expectedUpdatedAt: firstVersion.toISOString(),
    })], principal)).resolves.toEqual([{
      pageId: 'page-1', agentId: 'agent-1', roleSlotKey: 'writer',
      updatedAt: firstVersion.toISOString(),
    }]);
    expect(h.tx.pageAgentBinding.updateMany).not.toHaveBeenCalled();
    expect(h.events).toEqual([]);
  });

  it('advances the CAS version monotonically across same-millisecond updates', async () => {
    const h = makeHarness();
    h.bindings.set('page-1', {
      id: 'binding-1', pageId: 'page-1', spaceId: 'space-1', agentId: 'agent-1',
      roleSlotKey: 'writer', assignedByUserId: 'human-1', createdAt: firstVersion,
      updatedAt: firstVersion,
    });
    const clock = jest.spyOn(Date, 'now').mockReturnValue(firstVersion.getTime());
    try {
      const first = await h.service.setBindings(h.lockedTx, 'space-1', [edit({
        agentId: 'agent-2', expectedUpdatedAt: firstVersion.toISOString(),
      })], principal);
      const second = await h.service.setBindings(h.lockedTx, 'space-1', [edit({
        agentId: 'agent-2', roleSlotKey: 'reviewer', expectedUpdatedAt: first[0].updatedAt,
      })], principal);
      expect(first[0].updatedAt).toBe('2026-09-05T00:00:00.001Z');
      expect(second[0].updatedAt).toBe('2026-09-05T00:00:00.002Z');
    } finally {
      clock.mockRestore();
    }
  });

  it('unbinds only the current relationship and retains immutable audit evidence', async () => {
    const h = makeHarness();
    h.bindings.set('page-1', {
      id: 'binding-1', pageId: 'page-1', spaceId: 'space-1', agentId: 'agent-1',
      roleSlotKey: 'writer', assignedByUserId: 'human-1', createdAt: firstVersion,
      updatedAt: firstVersion,
    });
    await expect(h.service.setBindings(h.lockedTx, 'space-1', [edit({
      agentId: null, roleSlotKey: null, expectedUpdatedAt: firstVersion.toISOString(),
    })], principal)).resolves.toEqual([{
      pageId: 'page-1', agentId: null, roleSlotKey: null, updatedAt: null,
    }]);
    expect(h.events).toEqual([{
      pageId: 'page-1', spaceId: 'space-1', beforeAgentId: 'agent-1',
      afterAgentId: null, beforeRoleSlotKey: 'writer', afterRoleSlotKey: null,
      actorUserId: 'human-1',
    }]);
    expect(h.tx).not.toHaveProperty('collaborationRunTask');
  });

  it('rejects duplicate Page IDs and scope drift before opening the binding transaction', async () => {
    const h = makeHarness();
    await expect(h.service.setBindingsInScope('space-1', {
      pageIds: ['page-1', 'page-1'], expectedTreeRevision: 7n,
      edits: [edit(), edit()],
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_INVALID' });
    await expect(h.service.setBindingsInScope('space-1', {
      pageIds: ['page-1', 'page-2'], expectedTreeRevision: 7n,
      edits: [edit()],
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_INVALID' });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('locks the explicit page scope at its preview tree revision without advancing it', async () => {
    const h = makeHarness();
    await h.service.setBindingsInScope('space-1', {
      pageIds: ['page-1'], expectedTreeRevision: 7n, edits: [edit()],
    }, principal);
    expect(h.authorization.lockLiveHumanPrincipal).toHaveBeenCalledWith(h.tx, principal);
    expect(h.contentTree.lockPageMutationSpace).toHaveBeenCalledWith(h.tx, 'space-1', 7n);
    expect(h.tx.contentTreeRevision).toBe(7n);
  });

  it('previews only explicit Page IDs under fresh read authorization', async () => {
    const h = makeHarness();
    h.bindings.set('page-1', {
      pageId: 'page-1', agentId: 'agent-1', roleSlotKey: 'writer', updatedAt: firstVersion,
    });
    await expect(h.service.previewBindings('space-1', ['page-1'], principal)).resolves.toEqual({
      treeRevision: 7n,
      pages: [{
        pageId: 'page-1', agentId: 'agent-1', roleSlotKey: 'writer',
        updatedAt: firstVersion.toISOString(),
      }],
    });
    expect(h.tx.page.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['page-1'] } },
    }));
  });
});
