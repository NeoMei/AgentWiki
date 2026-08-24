import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentPreparationApi } from './agentPreparationApi';
import {
  AgentPreparationFailure,
  prepareAgent,
  type PreparationStage,
} from './prepareAgent';

describe('prepareAgent', () => {
  const calls: string[] = [];
  let api: AgentPreparationApi;

  beforeEach(() => {
    calls.length = 0;
    api = {
      listAgents: vi.fn(async () => []),
      getAgent: vi.fn(async (id) => {
        calls.push('detail');
        return {
          id,
          name: 'Writer',
          status: 'active',
          grants: [],
          credentials: [],
        };
      }),
      createAgent: vi.fn(async (input) => {
        calls.push('create');
        return { id: 'new-1', name: input.name, status: 'active' };
      }),
      activateAgent: vi.fn(async (id) => {
        calls.push('activate');
        return { id, name: 'Writer', status: 'active' };
      }),
      upsertGrant: vi.fn(async () => {
        calls.push('grant');
        return {};
      }),
      createInstallation: vi.fn(async () => {
        calls.push('instruction');
        return {
          installationId: 'install-1',
          code: 'AW-CODE',
          expiresAt: '2030-01-01T00:10:00.000Z',
          instructions: 'onboard --code AW-CODE',
        };
      }),
    };
  });

  it('activates a paused existing Agent before granting and issuing instructions', async () => {
    const stages: PreparationStage[] = [];

    const result = await prepareAgent({
      candidate: {
        kind: 'existing',
        agent: { id: 'agent-1', name: 'Writer', status: 'paused', grants: [] },
      },
      spaceId: 'space-1',
      role: 'editor',
      now: Date.parse('2030-01-01T00:00:00.000Z'),
    }, api, (stage) => stages.push(stage));

    expect(calls).toEqual(['activate', 'grant', 'detail', 'instruction']);
    expect(stages).toEqual([
      'activating',
      'granting',
      'checking_connection',
      'issuing_instruction',
    ]);
    expect(result.connection.kind).toBe('waiting');
    expect(api.activateAgent).toHaveBeenCalledTimes(1);
    expect(api.upsertGrant).toHaveBeenCalledTimes(1);
    expect(api.getAgent).toHaveBeenCalledTimes(1);
    expect(api.createInstallation).toHaveBeenCalledTimes(1);
  });

  it('creates exactly one trimmed new Agent before granting it', async () => {
    const stages: PreparationStage[] = [];

    const result = await prepareAgent({
      candidate: {
        kind: 'new',
        name: '  New Writer  ',
        description: '  Drafts chapters  ',
      },
      spaceId: 'space-1',
      role: 'editor',
      now: Date.parse('2030-01-01T00:00:00.000Z'),
    }, api, (stage) => stages.push(stage));

    expect(result.agentId).toBe('new-1');
    expect(result.agentName).toBe('New Writer');
    expect(calls).toEqual(['create', 'grant', 'detail', 'instruction']);
    expect(stages).toEqual([
      'creating',
      'granting',
      'checking_connection',
      'issuing_instruction',
    ]);
    expect(api.createAgent).toHaveBeenCalledTimes(1);
    expect(api.createAgent).toHaveBeenCalledWith({
      name: 'New Writer',
      description: 'Drafts chapters',
    });
    expect(api.upsertGrant).toHaveBeenCalledTimes(1);
    expect(api.upsertGrant).toHaveBeenCalledWith('new-1', 'space-1', 'editor');
    expect(api.getAgent).toHaveBeenCalledTimes(1);
    expect(api.getAgent).toHaveBeenCalledWith('new-1');
    expect(api.createInstallation).toHaveBeenCalledTimes(1);
    expect(api.createInstallation).toHaveBeenCalledWith('new-1', 'space-1', 'editor');
  });

  it('preserves a selected publisher role through the successful preparation chain', async () => {
    const result = await prepareAgent({
      candidate: { kind: 'new', name: 'Publisher', description: 'Publishes pages' },
      spaceId: 'space-1',
      role: 'publisher',
      now: Date.parse('2030-01-01T00:00:00.000Z'),
    }, api);

    expect(result.role).toBe('publisher');
    expect(api.upsertGrant).toHaveBeenCalledTimes(1);
    expect(api.upsertGrant).toHaveBeenCalledWith('new-1', 'space-1', 'publisher');
    expect(api.getAgent).toHaveBeenCalledTimes(1);
    expect(api.getAgent).toHaveBeenCalledWith('new-1');
    expect(api.createInstallation).toHaveBeenCalledTimes(1);
    expect(api.createInstallation).toHaveBeenCalledWith('new-1', 'space-1', 'publisher');
  });

  it('reuses an active target-Space credential without issuing another instruction', async () => {
    vi.mocked(api.getAgent).mockImplementationOnce(async (id) => {
      calls.push('detail');
      return {
        id,
        name: 'Writer',
        status: 'active',
        grants: [],
        credentials: [{
          id: 'credential-1',
          expiresAt: null,
          revokedAt: null,
          authorization: {
            role: 'editor',
            space: { id: 'space-1', name: 'Space' },
          },
        }],
      };
    });

    const result = await prepareAgent({
      candidate: {
        kind: 'existing',
        agent: { id: 'agent-1', name: 'Writer', status: 'active', grants: [] },
      },
      spaceId: 'space-1',
      role: 'editor',
      now: Date.parse('2030-01-01T00:00:00.000Z'),
    }, api);

    expect(result.connection).toEqual({ kind: 'connected' });
    expect(calls).toEqual(['grant', 'detail']);
    expect(api.activateAgent).not.toHaveBeenCalled();
    expect(api.createInstallation).not.toHaveBeenCalled();
  });

  it('uses the injected time when deciding whether a target-Space credential is active', async () => {
    vi.mocked(api.getAgent).mockImplementationOnce(async (id) => {
      calls.push('detail');
      return {
        id,
        name: 'Writer',
        status: 'active',
        grants: [],
        credentials: [{
          id: 'credential-1',
          expiresAt: '2000-01-01T00:10:00.000Z',
          revokedAt: null,
          authorization: {
            role: 'editor',
            space: { id: 'space-1', name: 'Space' },
          },
        }],
      };
    });

    const result = await prepareAgent({
      candidate: {
        kind: 'existing',
        agent: { id: 'agent-1', name: 'Writer', status: 'active', grants: [] },
      },
      spaceId: 'space-1',
      role: 'editor',
      now: Date.parse('2000-01-01T00:00:00.000Z'),
    }, api);

    expect(result.connection).toEqual({ kind: 'connected' });
    expect(api.createInstallation).not.toHaveBeenCalled();
  });

  it('returns durable partial success when instruction issuance fails', async () => {
    vi.mocked(api.createInstallation).mockImplementationOnce(async () => {
      calls.push('instruction');
      throw new Error('redis unavailable');
    });

    const result = await prepareAgent({
      candidate: { kind: 'new', name: 'New Writer', description: '' },
      spaceId: 'space-1',
      role: 'editor',
      now: Date.parse('2030-01-01T00:00:00.000Z'),
    }, api);

    expect(result).toMatchObject({
      agentId: 'new-1',
      connection: { kind: 'instruction_failed' },
    });
    expect(calls).toEqual(['create', 'grant', 'detail', 'instruction']);
    expect(api.createAgent).toHaveBeenCalledTimes(1);
    expect(api.upsertGrant).toHaveBeenCalledTimes(1);
    expect(api.createInstallation).toHaveBeenCalledTimes(1);
  });

  it('throws a granting failure after creating a new Agent without checking or issuing', async () => {
    vi.mocked(api.upsertGrant).mockImplementationOnce(async () => {
      calls.push('grant');
      throw new Error('grant failed');
    });

    const promise = prepareAgent({
      candidate: { kind: 'new', name: 'New Writer', description: '' },
      spaceId: 'space-1',
      role: 'editor',
    }, api);

    await expect(promise).rejects.toBeInstanceOf(AgentPreparationFailure);
    await expect(promise).rejects.toMatchObject({ stage: 'granting' });
    expect(calls).toEqual(['create', 'grant']);
    expect(api.createAgent).toHaveBeenCalledTimes(1);
    expect(api.upsertGrant).toHaveBeenCalledTimes(1);
    expect(api.getAgent).not.toHaveBeenCalled();
    expect(api.createInstallation).not.toHaveBeenCalled();
  });

  it('exposes durable granting progress and resumes the same created Agent', async () => {
    vi.mocked(api.upsertGrant).mockImplementationOnce(async () => {
      calls.push('grant');
      throw new Error('grant failed');
    });

    let failure!: AgentPreparationFailure;
    try {
      await prepareAgent({
        candidate: { kind: 'new', name: 'New Writer', description: '' },
        spaceId: 'space-1',
        role: 'editor',
      }, api);
    } catch (error) {
      expect(error).toBeInstanceOf(AgentPreparationFailure);
      failure = error as AgentPreparationFailure;
    }

    expect(failure.progress).toEqual({
      agent: { id: 'new-1', name: 'New Writer', status: 'active' },
      resumeFrom: 'granting',
      role: 'editor',
      source: 'created',
      spaceId: 'space-1',
    });

    const result = await prepareAgent({
      resume: failure.progress!,
    }, api);

    expect(result.agentId).toBe('new-1');
    expect(calls).toEqual(['create', 'grant', 'grant', 'detail', 'instruction']);
    expect(api.createAgent).toHaveBeenCalledTimes(1);
    expect(api.upsertGrant).toHaveBeenCalledTimes(2);
    expect(api.upsertGrant).toHaveBeenNthCalledWith(2, 'new-1', 'space-1', 'editor');
  });

  it('throws a connection-check failure for a new Agent without issuing instructions', async () => {
    vi.mocked(api.getAgent).mockImplementationOnce(async () => {
      calls.push('detail');
      throw new Error('detail failed');
    });

    const promise = prepareAgent({
      candidate: { kind: 'new', name: 'New Writer', description: '' },
      spaceId: 'space-1',
      role: 'editor',
    }, api);

    await expect(promise).rejects.toBeInstanceOf(AgentPreparationFailure);
    await expect(promise).rejects.toMatchObject({ stage: 'checking_connection' });
    expect(calls).toEqual(['create', 'grant', 'detail']);
    expect(api.createAgent).toHaveBeenCalledTimes(1);
    expect(api.upsertGrant).toHaveBeenCalledTimes(1);
    expect(api.getAgent).toHaveBeenCalledTimes(1);
    expect(api.createInstallation).not.toHaveBeenCalled();
  });

  it('exposes durable connection-check progress without repeating create or Grant', async () => {
    vi.mocked(api.getAgent).mockImplementationOnce(async () => {
      calls.push('detail');
      throw new Error('detail failed');
    });

    let failure!: AgentPreparationFailure;
    try {
      await prepareAgent({
        candidate: { kind: 'new', name: 'New Writer', description: '' },
        spaceId: 'space-1',
        role: 'publisher',
      }, api);
    } catch (error) {
      expect(error).toBeInstanceOf(AgentPreparationFailure);
      failure = error as AgentPreparationFailure;
    }

    expect(failure.progress).toEqual({
      agent: { id: 'new-1', name: 'New Writer', status: 'active' },
      resumeFrom: 'checking_connection',
      role: 'publisher',
      source: 'created',
      spaceId: 'space-1',
    });

    const result = await prepareAgent({
      resume: failure.progress!,
    }, api);

    expect(result.agentId).toBe('new-1');
    expect(calls).toEqual(['create', 'grant', 'detail', 'detail', 'instruction']);
    expect(api.createAgent).toHaveBeenCalledTimes(1);
    expect(api.upsertGrant).toHaveBeenCalledTimes(1);
    expect(api.getAgent).toHaveBeenCalledTimes(2);
  });

  it('does not expose progress for create failure and permits a fresh create retry', async () => {
    vi.mocked(api.createAgent).mockImplementationOnce(async () => {
      calls.push('create');
      throw new Error('create failed');
    });

    let failure!: AgentPreparationFailure;
    try {
      await prepareAgent({
        candidate: { kind: 'new', name: 'New Writer', description: '' },
        spaceId: 'space-1',
        role: 'editor',
      }, api);
    } catch (error) {
      expect(error).toBeInstanceOf(AgentPreparationFailure);
      failure = error as AgentPreparationFailure;
    }

    expect(failure.progress).toBeUndefined();
    await prepareAgent({
      candidate: { kind: 'new', name: 'New Writer', description: '' },
      spaceId: 'space-1',
      role: 'editor',
    }, api);

    expect(api.createAgent).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: 'creation',
      expectedStage: 'creating' as const,
      arrange: (fake: AgentPreparationApi) => {
        vi.mocked(fake.createAgent).mockImplementationOnce(async () => {
          calls.push('create');
          throw new Error('create failed');
        });
      },
      candidate: { kind: 'new' as const, name: 'Writer', description: '' },
      expectedCalls: ['create'],
    },
    {
      name: 'activation',
      expectedStage: 'activating' as const,
      arrange: (fake: AgentPreparationApi) => {
        vi.mocked(fake.activateAgent).mockImplementationOnce(async () => {
          calls.push('activate');
          throw new Error('activate failed');
        });
      },
      candidate: {
        kind: 'existing' as const,
        agent: { id: 'agent-1', name: 'Writer', status: 'paused', grants: [] },
      },
      expectedCalls: ['activate'],
    },
    {
      name: 'grant for an active existing Agent',
      expectedStage: 'granting' as const,
      arrange: (fake: AgentPreparationApi) => {
        vi.mocked(fake.upsertGrant).mockImplementationOnce(async () => {
          calls.push('grant');
          throw new Error('grant failed');
        });
      },
      candidate: {
        kind: 'existing' as const,
        agent: { id: 'agent-1', name: 'Writer', status: 'active', grants: [] },
      },
      expectedCalls: ['grant'],
    },
    {
      name: 'detail check',
      expectedStage: 'checking_connection' as const,
      arrange: (fake: AgentPreparationApi) => {
        vi.mocked(fake.getAgent).mockImplementationOnce(async () => {
          calls.push('detail');
          throw new Error('detail failed');
        });
      },
      candidate: {
        kind: 'existing' as const,
        agent: { id: 'agent-1', name: 'Writer', status: 'active', grants: [] },
      },
      expectedCalls: ['grant', 'detail'],
    },
  ])('classifies a $name failure with its exact stage', async ({
    expectedStage,
    arrange,
    candidate,
    expectedCalls,
  }) => {
    arrange(api);

    const promise = prepareAgent({
      candidate,
      spaceId: 'space-1',
      role: 'publisher',
      now: Date.parse('2030-01-01T00:00:00.000Z'),
    }, api);

    await expect(promise).rejects.toMatchObject({
      name: 'Error',
      message: `Agent preparation failed during ${expectedStage}`,
      stage: expectedStage,
    });
    await expect(promise).rejects.toBeInstanceOf(AgentPreparationFailure);
    expect(calls).toEqual(expectedCalls);
    expect(api.createInstallation).not.toHaveBeenCalled();
  });

  it('returns a classified 403 installation status without throwing or repeating durable work', async () => {
    vi.mocked(api.createInstallation).mockImplementationOnce(async () => {
      calls.push('instruction');
      throw { response: { status: 403, data: { message: 'forbidden' } } };
    });

    const result = await prepareAgent({
      candidate: { kind: 'new', name: 'Writer', description: '' },
      spaceId: 'space-1',
      role: 'publisher',
      now: Date.parse('2030-01-01T00:00:00.000Z'),
    }, api);

    expect(result.connection).toEqual({ kind: 'instruction_failed', status: 403 });
    expect(calls).toEqual(['create', 'grant', 'detail', 'instruction']);
    expect(api.createAgent).toHaveBeenCalledTimes(1);
    expect(api.upsertGrant).toHaveBeenCalledTimes(1);
    expect(api.createInstallation).toHaveBeenCalledTimes(1);
  });
});
