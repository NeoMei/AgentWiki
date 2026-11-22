import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';
import api, { writeAuthSession } from '../../api/client';
import { agentPreparationApi } from './agentPreparationApi';
import { prepareAgent } from './prepareAgent';

const adapter = api.defaults.adapter;

beforeEach(() => {
  localStorage.clear();
  writeAuthSession('alice-token', { id: 'alice' });
});

afterEach(() => {
  api.defaults.adapter = adapter;
  localStorage.clear();
});

it.each([
  ['granting', ['/agents']],
  ['issuing_instruction', ['/agents', '/agents/agent-alice/grants/space-1', '/agents/agent-alice']],
] as const)('cancels the %s step after the Agent preparation session changes', async (switchAt, requests) => {
  const send = vi.fn(async (config: InternalAxiosRequestConfig) => ({
    status: 200, statusText: 'OK', data: {
      id: 'agent-alice', name: 'Writer', status: 'active', credentials: [],
      grants: [{ spaceId: 'space-1', role: 'editor' }],
    },
    headers: {}, config,
  }));
  api.defaults.adapter = send;
  const result = prepareAgent({
    candidate: { kind: 'new', name: 'Writer', description: '' }, spaceId: 'space-1', role: 'editor',
  }, agentPreparationApi, (stage) => {
    if (stage === switchAt) writeAuthSession('bob-token', { id: 'bob' });
  });

  await expect(result).rejects.toMatchObject({ cause: { code: 'ERR_CANCELED' } });
  expect(send.mock.calls.map(([config]) => [config.url, config.headers.get('Authorization')]))
    .toEqual(requests.map((url) => [url, 'Bearer alice-token']));
});
