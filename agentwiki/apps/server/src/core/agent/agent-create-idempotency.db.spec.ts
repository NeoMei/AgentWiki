import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { AgentService } from './agent.service';

const databaseUrl = safeCollaborationDatabaseUrl();
const dbIt = databaseUrl ? it : it.skip;

describe('Agent create idempotency', () => {
  dbIt('commits one Agent and one audit row for concurrent retries and rolls back an audit failure', async () => {
    const first = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = randomUUID();
    const ownerId = `agent-create-owner-${suffix}`;

    try {
      await first.user.create({ data: { id: ownerId, email: `${suffix}@agent-create.test` } });
      const input = {
        name: 'Idempotent Writer',
        description: 'Created exactly once',
        memoryEnabled: false,
        idempotencyKey: `create-agent-${suffix}`,
      };
      const [created, replayed] = await Promise.all([
        new AgentService(first as any).create(ownerId, input),
        new AgentService(second as any).create(ownerId, input),
      ]);

      expect(replayed.id).toBe(created.id);
      await expect(first.agent.count({ where: { ownerId, name: input.name } })).resolves.toBe(1);
      await expect(first.agentAuditEvent.count({
        where: { agentId: created.id, action: 'agent.create', outcome: 'success' },
      })).resolves.toBe(1);

      const failingPrisma = {
        agent: first.agent,
        $transaction: (operation: (tx: unknown) => Promise<unknown>) => first.$transaction((tx) => operation({
          agent: tx.agent,
          agentAuditEvent: {
            create: async () => { throw new Error('forced audit failure'); },
          },
        })),
      };
      await expect(new AgentService(failingPrisma as any).create(ownerId, {
        name: 'Must roll back',
        description: null,
        idempotencyKey: `create-agent-rollback-${suffix}`,
      } as any)).rejects.toThrow('forced audit failure');
      await expect(first.agent.count({ where: { ownerId, name: 'Must roll back' } })).resolves.toBe(0);
    } finally {
      await first.agent.deleteMany({ where: { ownerId } });
      await first.user.deleteMany({ where: { id: ownerId } });
      await Promise.all([first.$disconnect(), second.$disconnect()]);
    }
  }, 20_000);
});

function safeCollaborationDatabaseUrl(): string | undefined {
  const explicitTestUrl = process.env.COLLABORATION_TEST_DATABASE_URL;
  const runtimeUrl = process.env.DATABASE_URL;
  if (!explicitTestUrl || !runtimeUrl || explicitTestUrl !== runtimeUrl) return undefined;
  try {
    const parsed = new URL(runtimeUrl);
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
    const schema = parsed.searchParams.get('schema') ?? '';
    return databaseName.toLowerCase().includes('test')
      && /^collaboration_test_[a-z0-9_]+$/u.test(schema)
      ? runtimeUrl
      : undefined;
  } catch {
    return undefined;
  }
}
