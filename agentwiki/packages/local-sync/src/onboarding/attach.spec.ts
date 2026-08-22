import { describe, expect, it, vi } from 'vitest';
import { scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';

import { runAttachment, type AttachmentDependencies, type AttachCliInput } from './attach.js';

const input = (): AttachCliInput => ({
  home: '/tmp/agentwiki-attach-home',
  protocol: 'ndjson',
  serverBaseUrl: 'https://wiki.test/api',
  code: 'AW-ONE-TIME-CODE',
  requestedClient: 'codex',
});

function fixture(confirmed = true): { deps: AttachmentDependencies; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      detectClients: vi.fn(() => { calls.push('detect-client'); return ['codex'] as Array<'codex'>; }),
      selectClient: vi.fn(async () => 'codex' as const),
      analyzeConfig: vi.fn(async () => {
        calls.push('analyze-config');
        return { hash: 'config-hash', oldEntries: ['agentwiki-old'], hasConflict: false };
      }),
      confirm: vi.fn(async (plan) => {
        calls.push('confirm-plan');
        expect(plan).toEqual({
          client: 'codex',
          serverUrl: 'https://wiki.test/api',
          mcpName: 'agentwiki',
          oldEntries: ['agentwiki-old'],
          reloadRequired: false,
        });
        return confirmed;
      }),
      exchange: vi.fn(async () => {
        calls.push('exchange-code');
        return {
          apiKey: 'agk_attach_secret',
          agentId: 'agent-1',
          credentialId: 'credential-1',
          serverUrl: 'https://wiki.test/api',
          pluginVersion: '0.5.0' as const,
          scopes: scopesForAgentAccessRole('publisher'),
          role: 'publisher' as const,
          spaceId: 'space-1',
        };
      }),
      install: vi.fn(async (installInput) => {
        calls.push('install-gateway');
        expect(installInput).toMatchObject({
          home: '/tmp/agentwiki-attach-home',
          client: 'codex',
          expectedConfigHash: 'config-hash',
          expectedAgentId: 'agent-1',
          expectedSpaceId: 'space-1',
          expectedRole: 'publisher',
          expectedScopes: scopesForAgentAccessRole('publisher'),
          expectedPluginVersion: '0.5.0',
          exchange: { agentId: 'agent-1', credentialId: 'credential-1' },
        });
        return {
          connectionId: 'connection-1',
          configBackupPath: '/tmp/config-backup',
          manifestHash: 'manifest-hash',
        };
      }),
      complete: vi.fn(),
      fail: vi.fn(),
      close: vi.fn(),
    },
  };
}

describe('runAttachment', () => {
  it('confirms migration before consuming the code and installs one agentwiki gateway', async () => {
    const test = fixture();

    const result = await runAttachment(input(), test.deps);

    expect(test.calls).toEqual([
      'detect-client', 'analyze-config', 'confirm-plan', 'exchange-code', 'install-gateway',
    ]);
    expect(result).toEqual({
      connectionId: 'connection-1',
      agentId: 'agent-1',
      client: 'codex',
      mcpName: 'agentwiki',
      migratedEntries: ['agentwiki-old'],
      configBackupPath: '/tmp/config-backup',
      manifestHash: 'manifest-hash',
      reloadRequired: false,
    });
    expect(test.deps.close).toHaveBeenCalledOnce();
    expect(test.deps.fail).not.toHaveBeenCalled();
  });

  it('requests a client choice when auto detects more than one supported client', async () => {
    const test = fixture();
    vi.mocked(test.deps.detectClients).mockReturnValue(['codex', 'claude']);
    vi.mocked(test.deps.selectClient).mockImplementation(async (candidates) => {
      expect(candidates).toEqual(['codex', 'claude']);
      return 'claude';
    });
    vi.mocked(test.deps.analyzeConfig).mockResolvedValue({
      hash: 'config-hash', oldEntries: [], hasConflict: false,
    });
    vi.mocked(test.deps.confirm).mockResolvedValue(true);
    vi.mocked(test.deps.install).mockResolvedValue({
      connectionId: 'connection-1',
      configBackupPath: '/tmp/config-backup',
      manifestHash: 'manifest-hash',
    });

    const result = await runAttachment({ ...input(), requestedClient: 'auto' }, test.deps);

    expect(test.deps.selectClient).toHaveBeenCalledOnce();
    expect(test.deps.analyzeConfig).toHaveBeenCalledWith('claude', input().home, input().serverBaseUrl);
    expect(result.client).toBe('claude');
  });

  it('derives the same local connection id when the same code is replayed', async () => {
    const test = fixture();

    await runAttachment(input(), test.deps);
    await runAttachment(input(), test.deps);

    const ids = vi.mocked(test.deps.install).mock.calls.map(([installInput]) => installInput.connectionId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not exchange the one-time code when the user denies the migration', async () => {
    const test = fixture(false);

    await expect(runAttachment(input(), test.deps)).rejects.toMatchObject({ code: 'AUTH_DENIED' });

    expect(test.deps.exchange).not.toHaveBeenCalled();
    expect(test.deps.install).not.toHaveBeenCalled();
    expect(test.deps.fail).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTH_DENIED' }));
    expect(test.deps.close).toHaveBeenCalledOnce();
  });

  it('stops before confirmation when the fixed agentwiki name is occupied by an unknown entry', async () => {
    const test = fixture();
    vi.mocked(test.deps.analyzeConfig).mockResolvedValue({
      hash: 'config-hash', oldEntries: [], hasConflict: true,
    });

    await expect(runAttachment(input(), test.deps)).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });

    expect(test.deps.confirm).not.toHaveBeenCalled();
    expect(test.deps.exchange).not.toHaveBeenCalled();
    expect(test.deps.fail).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONFIG_CONFLICT' }));
    expect(test.deps.close).toHaveBeenCalledOnce();
  });

  it('emits a redacted terminal failure when installation fails', async () => {
    const test = fixture();
    vi.mocked(test.deps.install).mockRejectedValue(new Error('rejected agk_attach_secret for AW-ABCD-EFGH'));

    await expect(runAttachment(input(), test.deps)).rejects.toThrow('agk_attach_secret');

    expect(test.deps.fail).toHaveBeenCalledWith({
      code: 'SYNC_FAILED',
      message: 'rejected [REDACTED] for [REDACTED]',
      retryable: false,
    });
    expect(test.deps.close).toHaveBeenCalledOnce();
  });
});
