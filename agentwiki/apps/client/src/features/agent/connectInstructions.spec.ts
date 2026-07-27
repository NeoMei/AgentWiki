import { describe, expect, it } from 'vitest';
import { buildAgentConnectInstructions } from './connectInstructions';

const base = {
  baseUrl: 'http://localhost:3000/api',
  apiKey: 'agk_testkey123',
  agentName: 'opencode-local',
  scopes: ['pages:read', 'pages:write', 'graph:read'],
};

describe('buildAgentConnectInstructions', () => {
  it('zh: contains endpoint, credential, scopes, tools and self-verify steps', () => {
    const text = buildAgentConnectInstructions(base, true);
    expect(text).toContain('http://localhost:3000/api/mcp');
    expect(text).toContain('Bearer agk_testkey123');
    expect(text).toContain('opencode-local');
    expect(text).toContain('pages:read, pages:write, graph:read');
    expect(text).toContain('search_pages');
    expect(text).toContain('propose_page');
    expect(text).toContain('initialize');
    expect(text).toContain('ChangeSet');
    expect(text).toContain('报告');
  });

  it('en: contains endpoint, credential, scopes, tools and self-verify steps', () => {
    const text = buildAgentConnectInstructions(base, false);
    expect(text).toContain('http://localhost:3000/api/mcp');
    expect(text).toContain('Bearer agk_testkey123');
    expect(text).toContain('opencode-local');
    expect(text).toContain('pages:read, pages:write, graph:read');
    expect(text).toContain('initialize');
    expect(text).toContain('ChangeSet');
    expect(text).toContain('Report');
  });

  it('strips trailing slash from baseUrl', () => {
    const text = buildAgentConnectInstructions({ ...base, baseUrl: 'http://x.test/api/' }, false);
    expect(text).toContain('http://x.test/api/mcp');
    expect(text).not.toContain('api//mcp');
  });

  it('omits tool hints gracefully when scopes have no mapping', () => {
    const text = buildAgentConnectInstructions({ ...base, scopes: ['runs:read'] }, false);
    expect(text).toContain('runs:read');
    expect(text).toContain('Call the tools allowed by your scopes');
  });
});
