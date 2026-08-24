import { describe, expect, it } from 'vitest';
import { GATEWAY_MCP_NAME, GATEWAY_PACKAGE_VERSION, gatewayCommand, looksLikeAgentWikiEntry } from './plan.js';

describe('gateway command', () => {
  it('uses the exact pinned 0.6.1 package and gateway subcommand', () => {
    const cmd = gatewayCommand('conn-123');
    expect(cmd).toEqual([
      'npx',
      '--yes',
      '@neomei/agentwiki-local-sync@0.6.1',
      'gateway',
      '--connection',
      'conn-123',
    ]);
  });

  it('never includes mcp, --orchestrator, a URL, or credentials', () => {
    const cmd = gatewayCommand('conn-1').join(' ');
    expect(cmd).not.toContain('mcp ');
    expect(cmd).not.toContain('--orchestrator');
    expect(cmd).not.toContain('http');
    expect(cmd).not.toContain('awo_');
    expect(cmd).not.toContain('agk_');
  });

  it('uses the fixed gateway MCP name', () => {
    expect(GATEWAY_MCP_NAME).toBe('agentwiki');
    expect(GATEWAY_PACKAGE_VERSION).toBe('0.6.1');
  });
});

describe('looksLikeAgentWikiEntry', () => {
  it('detects legacy local-sync entries', () => {
    expect(looksLikeAgentWikiEntry('agentwiki-local', 'npx agentwiki-local-sync mcp')).toBe(true);
  });

  it('detects entries pointing at the server', () => {
    expect(looksLikeAgentWikiEntry(
      'my-wiki',
      'url = "https://wiki.test/api/mcp"',
      'https://wiki.test/api',
    )).toBe(true);
  });

  it('does not confuse a longer endpoint with the exact server MCP endpoint', () => {
    expect(looksLikeAgentWikiEntry(
      'proxy',
      'url = "https://wiki.test/api/mcp-proxy"',
      'https://wiki.test/api',
    )).toBe(false);
  });

  it('does not claim an unrelated helper merely because its name contains agentwiki', () => {
    expect(looksLikeAgentWikiEntry(
      'my-agentwiki-helper',
      'npx --yes @example/helper',
      'https://wiki.test/api',
    )).toBe(false);
  });

  it('does not flag the new gateway name itself', () => {
    expect(looksLikeAgentWikiEntry('agentwiki', 'npx agentwiki-local-sync@0.4.0 gateway')).toBe(false);
  });

  it('does not flag unrelated entries', () => {
    expect(looksLikeAgentWikiEntry('my-tool', 'npx my-tool run')).toBe(false);
  });
});
