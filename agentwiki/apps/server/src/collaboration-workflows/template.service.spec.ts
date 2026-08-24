import { Prisma } from '@prisma/client';
import type { Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { TemplateService } from './template.service';

const principal: Principal = { userId: 'user-1' };
const validDefinition = () => ({
  schemaVersion: 1,
  inputs: [],
  roleSlots: [{ id: 'writer', name: 'Writer', required: true, description: 'Writes' }],
  nodes: [{
    kind: 'agent_task',
    id: 'draft',
    name: 'Draft',
    roleSlotId: 'writer',
    objective: 'Write',
    inputKeys: [],
    upstreamArtifacts: [],
    output: { key: 'draft', kind: 'markdown' },
    evidenceRequired: [],
    humanAcceptance: false,
    leaseSeconds: 300,
    maxExecutionSeconds: 3600,
    retryBudget: 1,
    repairBudget: 1,
    skippable: false,
    todos: [{ id: 'write', name: 'Write', required: true, evidenceKinds: [] }],
  }],
  dependencies: [],
  terminalNodeIds: ['draft'],
});

const definitionWithReviewer = (reviewerUserIds: string[]) => {
  const definition = validDefinition();
  return {
    ...definition,
    nodes: [...definition.nodes, {
      kind: 'human_review', id: 'review', name: 'Review', artifactTaskId: 'draft',
      minimumRole: 'editor', reviewerUserIds, approvalCriteria: ['Complete'],
      revisionTaskId: 'draft', allowTerminate: true,
    }],
    dependencies: [{ from: 'draft', to: 'review', mode: 'all' }],
    terminalNodeIds: ['review'],
  };
};

const templateRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'template-1',
  spaceId: 'space-1',
  scopeKey: 'space-1',
  slug: 'drafting',
  name: 'Drafting',
  description: '',
  version: 1,
  seedVersion: null,
  system: false,
  archivedAt: null,
  definition: validDefinition(),
  createdById: 'user-1',
  ...overrides,
});

describe('TemplateService', () => {
  const collaborationTemplate = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  };
  const prisma = {
    collaborationTemplate,
    spaceMember: { findMany: jest.fn() },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
  } as any;
  const authorization = {
    assertSpaceAccess: jest.fn(),
    assertLiveHumanSpaceAccess: jest.fn(),
  } as any;
  const config = { get: jest.fn().mockReturnValue('api') } as any;
  let service: TemplateService;

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockReturnValue('api');
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'owner' });
    authorization.assertLiveHumanSpaceAccess.mockResolvedValue({ role: 'owner' });
    collaborationTemplate.findMany.mockResolvedValue([]);
    collaborationTemplate.create.mockImplementation(async ({ data }: any) => ({ id: 'created-1', version: 1, ...data }));
    collaborationTemplate.findUniqueOrThrow.mockResolvedValue(templateRecord({ version: 2 }));
    collaborationTemplate.updateMany.mockResolvedValue({ count: 1 });
    prisma.spaceMember.findMany.mockResolvedValue([]);
    service = new TemplateService(prisma, authorization, config);
  });

  it('conditionally applies only a newer system seed without changing copied Space templates', async () => {
    collaborationTemplate.findUnique.mockResolvedValue({ id: 'system-1', seedVersion: 0, system: true });
    await service.seedBuiltIns();
    expect(collaborationTemplate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'system-1', system: true, seedVersion: { lt: 1 } },
      data: expect.objectContaining({ seedVersion: 1 }),
    }));
    expect(collaborationTemplate.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: { system: false } }));
  });

  it('does not downgrade a newer seed during rollback or concurrent startup', async () => {
    collaborationTemplate.findUnique.mockResolvedValue({ id: 'system-1', seedVersion: 2, system: true });
    await service.seedBuiltIns();
    expect(collaborationTemplate.updateMany).not.toHaveBeenCalled();
    expect(collaborationTemplate.create).not.toHaveBeenCalled();
  });

  it('seeds only in API/all process roles', async () => {
    const spy = jest.spyOn(service, 'seedBuiltIns').mockResolvedValue(undefined);
    config.get.mockReturnValue('worker');
    await service.onModuleInit();
    expect(spy).not.toHaveBeenCalled();
    config.get.mockReturnValue('all');
    await service.onModuleInit();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('lists system and current Space templates after read authorization', async () => {
    collaborationTemplate.findMany.mockResolvedValue([templateRecord()]);
    await expect(service.list('space-1', principal)).resolves.toHaveLength(1);
    expect(authorization.assertSpaceAccess).toHaveBeenCalledWith(
      principal, 'space-1', ['owner', 'admin', 'editor', 'viewer'],
    );
    expect(collaborationTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ archivedAt: null }),
    }));
  });

  it('creates and copies independent validated Space definitions', async () => {
    const sourceDefinition = validDefinition();
    collaborationTemplate.findUnique.mockResolvedValue(templateRecord({
      id: 'system-1', spaceId: null, scopeKey: 'system', slug: 'coding', system: true, definition: sourceDefinition,
    }));
    collaborationTemplate.findFirst.mockResolvedValue(null);

    await service.createSpaceTemplate('space-1', {
      name: 'Custom', slug: 'custom', description: 'Custom workflow', definition: validDefinition(),
    }, principal);
    await service.copySystemTemplate('space-1', 'system-1', 'Coding copy', principal);

    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledWith(
      prisma, principal, 'space-1', ['owner', 'admin'],
    );
    const copied = collaborationTemplate.create.mock.calls[1][0].data.definition;
    expect(copied).toEqual(sourceDefinition);
    expect(copied).not.toBe(sourceDefinition);
  });

  it('rejects designated reviewers who are not current Space members', async () => {
    const definition = definitionWithReviewer(['member-1', 'missing-user']);
    prisma.spaceMember.findMany.mockResolvedValue([{ userId: 'member-1', role: 'editor' }]);

    const error = await service.createSpaceTemplate('space-1', {
      name: 'Reviewed', slug: 'reviewed', description: '', definition,
    }, principal).catch((caught) => caught) as BusinessException;
    expect(error).toMatchObject({ businessCode: 'COLLABORATION_TEMPLATE_INVALID' });
    expect(error.getResponse()).toMatchObject({
      details: { issues: [expect.objectContaining({ code: 'REVIEWER_NOT_SPACE_MEMBER', message: 'missing-user' })] },
    });
    expect(prisma.spaceMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        user: { type: 'human', deletedAt: null, lockedAt: null },
      }),
    }));
    expect(collaborationTemplate.create).not.toHaveBeenCalled();
  });

  it('rejects designated reviewers below the Review minimum role', async () => {
    const definition = definitionWithReviewer(['viewer-user']);
    prisma.spaceMember.findMany.mockResolvedValue([{ userId: 'viewer-user', role: 'viewer' }]);

    const error = await service.createSpaceTemplate('space-1', {
      name: 'Reviewed', slug: 'reviewed', description: '', definition,
    }, principal).catch((caught) => caught) as BusinessException;
    expect(error).toMatchObject({ businessCode: 'COLLABORATION_TEMPLATE_INVALID' });
    expect(error.getResponse()).toMatchObject({
      details: { issues: [expect.objectContaining({ code: 'REVIEWER_ROLE_TOO_LOW', message: 'viewer-user' })] },
    });
  });

  it('increments version only when expectedVersion matches', async () => {
    collaborationTemplate.findUnique.mockResolvedValue(templateRecord());
    collaborationTemplate.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.updateSpaceTemplate('space-1', 'template-1', {
      expectedVersion: 3, name: 'Revised template', description: 'Revised', definition: validDefinition(),
    }, principal))
      .rejects.toMatchObject({ businessCode: 'COLLABORATION_TEMPLATE_VERSION_CONFLICT' });
  });

  it('updates editable metadata and definition in one optimistic write', async () => {
    collaborationTemplate.findUnique.mockResolvedValue(templateRecord());
    await service.updateSpaceTemplate('space-1', 'template-1', {
      expectedVersion: 1, name: 'Revised template', description: 'Revised description', definition: validDefinition(),
    }, principal);
    expect(collaborationTemplate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'template-1', version: 1 }),
      data: expect.objectContaining({
        name: 'Revised template', description: 'Revised description', version: { increment: 1 },
      }),
    }));
  });

  it('rejects editing a system template', async () => {
    collaborationTemplate.findUnique.mockResolvedValue(templateRecord({ id: 'system-1', spaceId: null, system: true }));
    await expect(service.updateSpaceTemplate('space-1', 'system-1', {
      expectedVersion: 1, name: 'System', description: '', definition: validDefinition(),
    }, principal))
      .rejects.toMatchObject({ businessCode: 'COLLABORATION_SYSTEM_TEMPLATE_IMMUTABLE' });
  });

  it('returns redacted validation issues and archives with optimistic versioning', async () => {
    const validation = await service.validateDefinition('space-1', { script: 'secret-value' }, principal);
    expect(validation.valid).toBe(false);
    expect(JSON.stringify(validation)).not.toContain('secret-value');

    collaborationTemplate.findUnique.mockResolvedValue(templateRecord());
    collaborationTemplate.updateMany.mockResolvedValue({ count: 1 });
    await service.archiveSpaceTemplate('space-1', 'template-1', 1, principal);
    expect(collaborationTemplate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'template-1', version: 1, system: false }),
      data: expect.objectContaining({ archivedAt: expect.any(Date), version: { increment: 1 } }),
    }));
  });

  it.each([
    ['create', () => service.createSpaceTemplate('space-1', {
      name: 'Custom', definition: validDefinition(),
    }, principal)],
    ['copy', () => service.copySystemTemplate('space-1', 'system-1', 'Copy', principal)],
    ['update', () => service.updateSpaceTemplate('space-1', 'template-1', {
      expectedVersion: 1, definition: validDefinition(),
    }, principal)],
    ['archive', () => service.archiveSpaceTemplate('space-1', 'template-1', 1, principal)],
  ])('rechecks live membership/platform role before %s mutation data access', async (_name, mutate) => {
    authorization.assertLiveHumanSpaceAccess.mockRejectedValueOnce(new BusinessException('SPACE_ACCESS_DENIED'));

    await expect(mutate()).rejects.toMatchObject({ businessCode: 'COLLABORATION_HUMAN_PERMISSION_DENIED' });

    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledWith(
      prisma, principal, 'space-1', ['owner', 'admin'],
    );
    expect(collaborationTemplate.findUnique).not.toHaveBeenCalled();
    expect(collaborationTemplate.findFirst).not.toHaveBeenCalled();
    expect(collaborationTemplate.create).not.toHaveBeenCalled();
    expect(collaborationTemplate.updateMany).not.toHaveBeenCalled();
    expect(collaborationTemplate.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('uses Serializable transactions for all human template mutations', async () => {
    collaborationTemplate.findFirst.mockResolvedValue(null);
    collaborationTemplate.findUnique.mockResolvedValueOnce(templateRecord({
      id: 'system-1', spaceId: null, scopeKey: 'system', system: true,
    })).mockResolvedValue(templateRecord());

    await service.createSpaceTemplate('space-1', { name: 'Custom', definition: validDefinition() }, principal);
    await service.copySystemTemplate('space-1', 'system-1', 'Copy', principal);
    await service.updateSpaceTemplate('space-1', 'template-1', {
      expectedVersion: 1, definition: validDefinition(),
    }, principal);
    await service.archiveSpaceTemplate('space-1', 'template-1', 1, principal);

    expect(prisma.$transaction).toHaveBeenCalledTimes(4);
    for (const call of prisma.$transaction.mock.calls) {
      expect(call[1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
  });
});
