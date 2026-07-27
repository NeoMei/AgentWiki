import { BadRequestException } from '@nestjs/common';
import { McpService } from './mcp.service';

describe('McpService transport security', () => {
  const config = { get: jest.fn().mockReturnValue('agentwiki.example,localhost') } as any;
  const dependency = {} as any;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const prisma = { agentAuditEvent: { create: jest.fn().mockResolvedValue({}) } } as any;
  const service = new McpService(
    config,
    dependency,
    dependency,
    dependency,
    dependency,
    dependency,
    dependency,
    dependency,
    dependency,
    dependency,
    audit,
    prisma,
  );

  it('accepts an explicitly allowlisted Host header', () => {
    expect(() => (service as any).validateHost({ headers: { host: 'agentwiki.example:443' } })).not.toThrow();
  });

  it('rejects DNS rebinding through an untrusted Host header', () => {
    expect(() => (service as any).validateHost({ headers: { host: 'attacker.example' } })).toThrow(BadRequestException);
  });

  it('records capability-level success without persisting argument values', async () => {
    await expect((service as any).executeMcpCall(
      'tool.search_pages',
      { userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1' },
      { ipAddress: '203.0.113.10', userAgent: 'test' },
      { query: 'secret search', spaceId: 'space-1' },
      async () => 'ok',
    )).resolves.toBe('ok');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mcp.tool.search_pages',
      outcome: 'success',
      metadata: { argumentNames: ['query', 'spaceId'], credentialId: 'credential-1' },
    }));
    expect(JSON.stringify(audit.record.mock.calls[0][0])).not.toContain('secret search');
    expect(prisma.agentAuditEvent.create).toHaveBeenCalled();
  });
});
