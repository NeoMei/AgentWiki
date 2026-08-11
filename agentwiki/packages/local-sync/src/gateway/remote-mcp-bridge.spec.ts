import { describe, expect, it } from 'vitest';
import { toRemoteGatewayName, fromRemoteGatewayName } from './manifest.js';

describe('remote bridge name mapping', () => {
  it('maps remote names to gateway names', () => {
    expect(toRemoteGatewayName('list_pages')).toBe('wiki_list_pages');
    expect(fromRemoteGatewayName('wiki_list_pages')).toBe('list_pages');
  });

  it('rejects non-remote names in fromRemoteGatewayName', () => {
    expect(fromRemoteGatewayName('local_scan_sources')).toBeNull();
    expect(fromRemoteGatewayName('knowledge_prepare')).toBeNull();
  });
});
