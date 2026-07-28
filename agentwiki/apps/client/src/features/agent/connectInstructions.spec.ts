import { describe, expect, it } from 'vitest';
import { buildAgentConnectInstructions } from './connectInstructions';

const base = {
  baseUrl: 'http://localhost:3000/api',
  apiKey: 'agk_testkey123',
  agentName: 'opencode-local',
};

describe('buildAgentConnectInstructions', () => {
  it('zh: contains identity, endpoint, credential, and self-discovery endpoint', () => {
    const text = buildAgentConnectInstructions(base, true);
    expect(text).toContain('opencode-local');
    expect(text).toContain('http://localhost:3000/api/mcp');
    expect(text).toContain('Bearer agk_testkey123');
    expect(text).toContain('http://localhost:3000/api/integrations/mcp');
    expect(text).toContain('initialize');
    expect(text).toContain('授权由 AgentWiki 服务端统一判定');
  });

  it('en: contains identity, endpoint, credential, and self-discovery endpoint', () => {
    const text = buildAgentConnectInstructions(base, false);
    expect(text).toContain('opencode-local');
    expect(text).toContain('http://localhost:3000/api/mcp');
    expect(text).toContain('Bearer agk_testkey123');
    expect(text).toContain('http://localhost:3000/api/integrations/mcp');
    expect(text).toContain('initialize');
    expect(text).toContain('decided and enforced by the AgentWiki server');
  });

  it('points agents at the server for their authorization instead of embedding scope rules', () => {
    const text = buildAgentConnectInstructions(base, false);
    expect(text).toContain('/integrations/mcp');
    expect(text).toContain('list_spaces');
    expect(text).toContain('internal id');
  });

  it('strips trailing slash from baseUrl', () => {
    const text = buildAgentConnectInstructions({ ...base, baseUrl: 'http://x.test/api/' }, false);
    expect(text).toContain('http://x.test/api/mcp');
    expect(text).not.toContain('api//mcp');
  });

  it('uses a credential-specific MCP name and rejects stale AgentWiki connections', () => {
    const text = buildAgentConnectInstructions(base, true);

    expect(text).toContain('agentwiki-testkey1');
    expect(text).toContain('opencode mcp add agentwiki-testkey1');
    expect(text).toContain('不得复用已有的 AgentWiki 连接');
    expect(text).toContain('确认返回的 Agent 名称是「opencode-local」');
  });
});
