import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AgentService } from '../core/agent/agent.service';
import {
  BootstrapDto,
  DeviceDecisionDto,
  PollDeviceDto,
  StartDeviceDto,
} from './onboard.dto';
import {
  hashServerPlan,
  normalizeServerPlan,
  PERMISSION_PRESETS,
  type NormalizedServerPlan,
  type ServerPlan,
} from './onboard.types';

async function validationErrors<T extends object>(
  target: new () => T,
  value: object,
) {
  return validate(plainToInstance(target, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

const createPlan: ServerPlan = {
  space: { mode: 'create', name: '研发知识库' },
  agentName: 'Codex',
  permissionPreset: 'editor',
  approvalMode: 'always-review',
  packageVersion: '0.3.7',
};

describe('onboarding DTO contract', () => {
  it.each(['0.3.7'] as const)(
    'accepts supported package version %s from every client',
    async (packageVersion) => {
      for (const clientType of ['codex', 'claude', 'opencode'] as const) {
        await expect(validationErrors(StartDeviceDto, {
          packageVersion,
          clientType,
          purpose: 'full-onboarding',
        })).resolves.toEqual([]);
      }
    },
  );

  it.each([
    { packageVersion: '0.3.3', clientType: 'codex', purpose: 'full-onboarding' },
    { packageVersion: 'v0.3.0', clientType: 'codex', purpose: 'full-onboarding' },
    { packageVersion: '0.3.0', clientType: 'cursor', purpose: 'full-onboarding' },
    { packageVersion: '0.3.0', clientType: 'codex', purpose: 'device-auth' },
  ])('rejects unsupported start input %#', async (input) => {
    await expect(validationErrors(StartDeviceDto, input)).resolves.not.toEqual([]);
  });

  it('rejects requestedCapabilities and every other unknown start field', async () => {
    const errors = await validationErrors(StartDeviceDto, {
      packageVersion: createPlan.packageVersion,
      clientType: 'codex',
      purpose: 'full-onboarding',
      requestedCapabilities: ['bootstrap'],
      extra: true,
    });

    expect(errors.map((error) => error.property).sort()).toEqual([
      'extra',
      'requestedCapabilities',
    ]);
  });

  it('validates poll and decision inputs and rejects unknown fields', async () => {
    await expect(validationErrors(PollDeviceDto, { deviceCode: 'device-code' }))
      .resolves.toEqual([]);
    await expect(validationErrors(DeviceDecisionDto, {
      userCode: 'user-code',
      decision: 'approve',
    })).resolves.toEqual([]);
    await expect(validationErrors(DeviceDecisionDto, {
      userCode: 'user-code',
      decision: 'deny',
    })).resolves.toEqual([]);

    await expect(validationErrors(PollDeviceDto, {
      deviceCode: 'device-code',
      extra: true,
    })).resolves.not.toEqual([]);
    await expect(validationErrors(DeviceDecisionDto, {
      userCode: 'user-code',
      decision: 'later',
    })).resolves.not.toEqual([]);
  });

  it.each([
    createPlan,
    {
      ...createPlan,
      space: { mode: 'existing' as const, id: 'space-id' },
      permissionPreset: 'full' as const,
      approvalMode: 'scoped-auto-publish' as const,
    },
  ])('accepts create and existing Space plans %#', async (serverPlan) => {
    await expect(validationErrors(BootstrapDto, {
      serverPlan,
      serverPlanHash: 'a'.repeat(64),
    })).resolves.toEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['array', []],
  ])('rejects a %s serverPlan', async (_label, serverPlan) => {
    const input = serverPlan === undefined
      ? { serverPlanHash: 'a'.repeat(64) }
      : { serverPlan, serverPlanHash: 'a'.repeat(64) };

    await expect(validationErrors(BootstrapDto, input)).resolves.not.toEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['array', []],
  ])('rejects a %s Space selection', async (_label, space) => {
    const { space: _ignored, ...planWithoutSpace } = createPlan;
    const serverPlan = space === undefined
      ? planWithoutSpace
      : { ...createPlan, space };

    await expect(validationErrors(BootstrapDto, {
      serverPlan,
      serverPlanHash: 'a'.repeat(64),
    })).resolves.not.toEqual([]);
  });

  it.each([
    { ...createPlan, permissionPreset: 'viewer' },
    { ...createPlan, approvalMode: 'auto-publish' },
    { ...createPlan, packageVersion: '0.3.3' },
    { ...createPlan, space: { mode: 'create', id: 'space-id' } },
    { ...createPlan, space: { mode: 'existing', name: '研发知识库' } },
  ])('rejects invalid bootstrap plan %#', async (serverPlan) => {
    await expect(validationErrors(BootstrapDto, {
      serverPlan,
      serverPlanHash: 'a'.repeat(64),
    })).resolves.not.toEqual([]);
  });

  it('rejects client-supplied scopes and unknown bootstrap fields', async () => {
    const errors = await validationErrors(BootstrapDto, {
      serverPlan: { ...createPlan, scopes: ['pages:read'] },
      serverPlanHash: 'a'.repeat(64),
      extra: true,
    });

    expect(errors.map((error) => error.property)).toContain('extra');
    expect(errors.find((error) => error.property === 'serverPlan')?.children)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ property: 'scopes' }),
      ]));
  });

  it.each(['not-a-hash', 'A'.repeat(64), 'a'.repeat(63)])(
    'rejects a non-canonical server plan hash: %s',
    async (serverPlanHash) => {
      await expect(validationErrors(BootstrapDto, {
        serverPlan: createPlan,
        serverPlanHash,
      })).resolves.not.toEqual([]);
    },
  );
});

describe('onboarding permission presets and canonical plan hashing', () => {
  it('defines the exact sorted editor and full scope sets', () => {
    expect(PERMISSION_PRESETS).toEqual({
      editor: [
        'graph:read', 'graph:write', 'pages:read', 'pages:write', 'review:read',
        'runs:read', 'runs:write', 'sources:read', 'sources:write', 'spaces:read',
      ],
      full: [
        'graph:read', 'graph:write', 'memory:read', 'memory:write', 'pages:read',
        'pages:write', 'review:auto-publish', 'review:read', 'runs:read', 'runs:write',
        'sources:read', 'sources:write', 'spaces:read',
      ],
    });

    for (const scopes of Object.values(PERMISSION_PRESETS)) {
      expect(() => AgentService.prototype.normalizeCredentialScopes.call(
        {} as AgentService,
        [...scopes],
      )).not.toThrow();
    }
  });

  it('normalizes editor always-review to an editor grant without auto-publish', () => {
    expect(normalizeServerPlan(createPlan)).toEqual({
      ...createPlan,
      scopes: [
        'graph:read', 'graph:write', 'pages:read', 'pages:write', 'review:read',
        'runs:read', 'runs:write', 'sources:read', 'sources:write', 'spaces:read',
      ],
      spaceRole: 'editor',
    });
  });

  it('adds auto-publish to editor only for scoped-auto-publish mode', () => {
    expect(normalizeServerPlan({
      ...createPlan,
      approvalMode: 'scoped-auto-publish',
    }).scopes).toEqual([
      'graph:read', 'graph:write', 'pages:read', 'pages:write',
      'review:auto-publish', 'review:read', 'runs:read', 'runs:write',
      'sources:read', 'sources:write', 'spaces:read',
    ]);
  });

  it('retains auto-publish in full even for always-review mode', () => {
    const normalized = normalizeServerPlan({
      ...createPlan,
      permissionPreset: 'full',
    });

    expect(normalized.spaceRole).toBe('editor');
    expect(normalized.scopes).toEqual(PERMISSION_PRESETS.full);
  });

  it('hashes canonical UTF-8 JSON with sorted object keys and scope arrays', () => {
    const normalized = normalizeServerPlan(createPlan);
    const reordered: NormalizedServerPlan = {
      spaceRole: 'editor',
      scopes: [...normalized.scopes].reverse(),
      packageVersion: createPlan.packageVersion,
      approvalMode: 'always-review',
      permissionPreset: 'editor',
      agentName: 'Codex',
      space: { name: '研发知识库', mode: 'create' },
    };

    expect(hashServerPlan(normalized)).toBe(hashServerPlan(reordered));
    expect(hashServerPlan(normalized)).toBe(
      'c63934685acad4520682e23d432997caacfe9736f0e4877cd78ff10834bc35b0',
    );
    expect(hashServerPlan(normalized)).toMatch(/^[0-9a-f]{64}$/);
  });
});
