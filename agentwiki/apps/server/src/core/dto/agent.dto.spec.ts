import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateAgentDto,
  UpdateAgentDto,
  UpsertAgentGrantDto,
} from './agent.dto';

async function validationErrors<T extends object>(
  target: new () => T,
  value: object,
) {
  return validate(plainToInstance(target, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('Agent DTO role-only boundary', () => {
  it.each([
    { approvalMode: 'always-review' },
    { approvalMode: 'scoped-auto-publish' },
  ])('rejects legacy create input %#', async (legacyField) => {
    await expect(validationErrors(CreateAgentDto, {
      name: 'Role managed Agent',
      ...legacyField,
    })).resolves.not.toEqual([]);
  });

  it.each([
    { approvalMode: 'always-review' },
    { approvalMode: 'scoped-auto-publish' },
  ])('rejects legacy update input %#', async (legacyField) => {
    await expect(validationErrors(UpdateAgentDto, legacyField))
      .resolves.not.toEqual([]);
  });

  it.each([
    [UpsertAgentGrantDto, { role: 'viewer' }],
    [UpsertAgentGrantDto, { role: 'full' }],
    [UpsertAgentGrantDto, { role: 'editor', scopes: ['pages:read'] }],
  ] as const)('rejects legacy role or custom-scope input %#', async (target, input) => {
    await expect(validationErrors(target, input)).resolves.not.toEqual([]);
  });
});
