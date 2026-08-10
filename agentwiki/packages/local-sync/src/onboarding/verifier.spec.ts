import { describe, expect, it } from 'vitest';
import { verifyGateway } from './verifier.js';
import { staticToolNames, manifestHash } from '../gateway/manifest.js';

describe('verifyGateway', () => {
  it('passes when all static tools are present', async () => {
    const result = await verifyGateway({
      command: ['echo'],
      listToolsImpl: async () => staticToolNames(),
      deadlineMs: 5_000,
    });
    expect(result.ok).toBe(true);
    expect(result.toolNames).toContain('onboard_status');
    expect(result.manifestHash).toBe(manifestHash());
    expect(result.errors).toEqual([]);
  });

  it('fails when required tools are missing', async () => {
    const result = await verifyGateway({
      command: ['echo'],
      listToolsImpl: async () => ['onboard_status', 'local_scan_sources'],
      deadlineMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('missing tools');
  });

  it('reports a timeout error', async () => {
    const result = await verifyGateway({
      command: ['echo'],
      listToolsImpl: async () => {
        await new Promise((r) => setTimeout(r, 5_000));
        return [];
      },
      deadlineMs: 200,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('timed out');
  }, 5_000);

  it('reports a spawn error', async () => {
    const result = await verifyGateway({
      command: ['echo'],
      listToolsImpl: async () => {
        throw new Error('spawn ENOENT');
      },
      deadlineMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('ENOENT');
  });
});
