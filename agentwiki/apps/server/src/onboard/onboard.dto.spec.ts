import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { readFileSync } from 'fs';
import { join } from 'path';
import { scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import {
  BootstrapDto,
  DeviceDecisionDto,
  PollDeviceDto,
  StartDeviceDto,
} from './onboard.dto';
import {
  hashServerPlan,
  normalizeServerPlan,
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
  role: 'editor',
  packageVersion: '0.6.1',
};

const planHashGolden = JSON.parse(readFileSync(join(
  __dirname,
  '../../../../packages/sync-protocol/test-vectors/onboarding-plan-hash-v1.json',
), 'utf8')) as { plan: ServerPlan; sha256: string };

describe('onboarding DTO contract', () => {
  it.each(['0.6.1'] as const)(
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
    { packageVersion: '0.4.0', clientType: 'codex', purpose: 'full-onboarding' },
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
      role: 'publisher' as const,
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
    { ...createPlan, role: 'viewer' },
    { ...createPlan, role: 'full' },
    { ...createPlan, packageVersion: '0.4.0' },
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

  it.each([
    { permissionPreset: 'editor' },
    { approvalMode: 'always-review' },
  ])('rejects removed legacy plan field %#', async (legacyField) => {
    await expect(validationErrors(BootstrapDto, {
      serverPlan: { ...createPlan, ...legacyField },
      serverPlanHash: 'a'.repeat(64),
    })).resolves.not.toEqual([]);
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

describe('onboarding roles and canonical plan hashing', () => {
  it('normalizes the role through the shared access contract', () => {
    expect(normalizeServerPlan(createPlan)).toEqual({
      ...createPlan,
      scopes: scopesForAgentAccessRole('editor'),
    });
  });

  it.each(['reader', 'editor', 'publisher'] as const)('derives %s scopes from the shared contract', (role) => {
    expect(normalizeServerPlan({ ...createPlan, role }).scopes)
      .toEqual(scopesForAgentAccessRole(role));
  });

  it('matches the shared raw-plan golden vector', () => {
    expect(hashServerPlan(planHashGolden.plan)).toBe(planHashGolden.sha256);
  });
});
