import { describe, expect, it } from 'vitest';
import {
  STATIC_TOOLS,
  LEGACY_TOOL_NAMES,
  staticToolNames,
  manifestHash,
  isLegacyToolName,
  toRemoteGatewayName,
  fromRemoteGatewayName,
} from './manifest.js';

describe('gateway manifest', () => {
  it('declares the approved public tool names', () => {
    const names = staticToolNames();
    expect(names).toContain('onboard_status');
    expect(names).toContain('local_scan_sources');
    expect(names).toContain('local_read_artifacts');
    expect(names).toContain('knowledge_prepare');
    expect(names).toContain('knowledge_confirm_and_sync');
    expect(names).toContain('knowledge_pull');
  });

  it('does not register any legacy tool name', () => {
    for (const name of staticToolNames()) {
      expect(isLegacyToolName(name)).toBe(false);
    }
  });

  it('every tool has a unique name and a unique execution-plane binding', () => {
    const names = staticToolNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it('rejects legacy names via isLegacyToolName', () => {
    expect(isLegacyToolName('start_knowledge_job')).toBe(true);
    expect(isLegacyToolName('confirm_and_push')).toBe(true);
    expect(isLegacyToolName('local_sync_status')).toBe(true);
  });

  it('produces a stable deterministic manifest hash', () => {
    const a = manifestHash();
    const b = manifestHash();
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('remote tool name mapping is reversible', () => {
    expect(toRemoteGatewayName('list_pages')).toBe('wiki_list_pages');
    expect(fromRemoteGatewayName('wiki_list_pages')).toBe('list_pages');
    expect(fromRemoteGatewayName('local_scan_sources')).toBeNull();
  });
});
