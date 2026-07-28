import { BadRequestException } from '@nestjs/common';
import { AgentService } from './agent.service';

describe('AgentService grant scope validation', () => {
  const prisma = {
    agentGrant: { upsert: jest.fn() },
    agentAuditEvent: { create: jest.fn() },
  } as any;
  const service = new AgentService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('rejects invalid grant scopes before persisting the grant', async () => {
    await expect(service.upsertGrantForSpace(
      'agent-1',
      'space-1',
      'editor',
      ['pages:read', 'review:decide'],
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
  });

  it('deduplicates valid grant scopes before persisting the grant', async () => {
    prisma.agentGrant.upsert.mockResolvedValue({ id: 'grant-1' });
    prisma.agentAuditEvent.create.mockResolvedValue({});

    await service.upsertGrantForSpace(
      'agent-1',
      'space-1',
      'editor',
      ['pages:read', 'pages:read', 'pages:write'],
    );

    expect(prisma.agentGrant.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ scopes: ['pages:read', 'pages:write'] }),
      update: { role: 'editor', scopes: ['pages:read', 'pages:write'] },
    }));
  });
});
