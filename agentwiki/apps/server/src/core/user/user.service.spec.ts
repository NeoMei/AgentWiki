import { createHash, randomBytes } from 'crypto';
import { UserService } from './user.service';

describe('UserService personal token retrieval', () => {
  const credentials = { findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() };
  const tx = { $queryRaw: jest.fn(), user: { findUnique: jest.fn() }, apiKeyCredential: credentials };
  const service = new UserService({
    apiKeyCredential: credentials,
    $transaction: (operation: (client: typeof tx) => unknown) => operation(tx),
  } as any);
  const originalSeed = process.env.AGENTWIKI_DEPLOYMENT_SEED;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AGENTWIKI_DEPLOYMENT_SEED = randomBytes(32).toString('base64');
    tx.user.findUnique.mockResolvedValue({ id: 'user-1' });
    credentials.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    if (originalSeed === undefined) delete process.env.AGENTWIKI_DEPLOYMENT_SEED;
    else process.env.AGENTWIKI_DEPLOYMENT_SEED = originalSeed;
  });

  it('stores an encrypted copy and retrieves the same Key without changing credentials', async () => {
    const token = await service.regenerateApiKey('user-1');
    const [{ data }] = credentials.create.mock.calls[0];
    expect(data.keyHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(typeof data.encryptedKey).toBe('string');
    expect(data.encryptedKey).not.toContain(token);
    credentials.findFirst.mockResolvedValue(data);

    await expect(service.revealApiKey('user-1')).resolves.toBe(token);
    await expect(service.revealApiKey('user-1')).resolves.toBe(token);
    expect(credentials.create).toHaveBeenCalledTimes(1);
    expect(credentials.updateMany).not.toHaveBeenCalled();
  });

  it('reports legacy Keys as unavailable without issuing a replacement', async () => {
    credentials.findFirst.mockResolvedValue({ keyHash: 'legacy-hash', encryptedKey: null });
    await expect(service.revealApiKey('user-1')).rejects.toMatchObject({ businessCode: 'PERSONAL_TOKEN_LEGACY' });
    expect(credentials.create).not.toHaveBeenCalled();
  });
});

describe('UserService account deletion safeguards', () => {
  const tx = {
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn(), count: jest.fn(), update: jest.fn() },
    spaceMember: { count: jest.fn() },
    apiKeyCredential: { updateMany: jest.fn() },
    agentCredential: { updateMany: jest.fn() },
    agent: { updateMany: jest.fn() },
  } as any;
  const prisma = {
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const service = new UserService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    tx.user.findUnique.mockResolvedValue({ id: 'user-1', type: 'human', platformRole: 'user' });
    tx.$queryRaw.mockResolvedValue([{ id: 'locked' }]);
    tx.spaceMember.count.mockResolvedValue(0);
    tx.user.count.mockResolvedValue(1);
    tx.user.update.mockResolvedValue({ id: 'user-1', deletedAt: new Date() });
  });

  it('refuses deletion until every owned Space is transferred', async () => {
    tx.spaceMember.count.mockResolvedValue(1);
    await expect(service.remove('user-1')).rejects.toThrow('Transfer ownership');
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('refuses deletion of the final active super admin', async () => {
    tx.user.findUnique.mockResolvedValue({ id: 'user-1', type: 'human', platformRole: 'super_admin' });
    tx.user.count.mockResolvedValue(0);
    await expect(service.remove('user-1')).rejects.toThrow('last active super admin');
  });

  it('revokes credentials and Agents atomically before soft deletion', async () => {
    await service.remove('user-1');
    const lockedTables = tx.$queryRaw.mock.calls.map(([query]: any[]) => query.strings.join(' '));
    expect(lockedTables[0]).toContain('FROM "User"');
    expect(lockedTables[1]).toContain('FROM "Agent"');
    expect(tx.apiKeyCredential.updateMany).toHaveBeenCalled();
    expect(tx.agentCredential.updateMany).toHaveBeenCalled();
    expect(tx.agent.updateMany).toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ authVersion: { increment: 1 } }),
    }));
  });
});
