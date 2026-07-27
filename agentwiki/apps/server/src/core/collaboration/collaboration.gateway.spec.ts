import { CollaborationGateway } from './collaboration.gateway';

describe('CollaborationGateway authentication', () => {
  const jwt = { verify: jest.fn().mockReturnValue({ sub: 'user-1' }) } as any;
  const authorization = {} as any;
  const auth = { validateJwtUser: jest.fn() } as any;
  const gateway = new CollaborationGateway(jwt, authorization, auth);

  beforeEach(() => jest.clearAllMocks());

  it('disconnects a socket whose signed token belongs to a deleted user', async () => {
    auth.validateJwtUser.mockResolvedValue(null);
    const client = { handshake: { auth: { token: 'signed-token' } }, data: {}, disconnect: jest.fn() } as any;
    await gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.data.user).toBeUndefined();
  });

  it('uses the current database principal instead of trusting JWT identity fields', async () => {
    auth.validateJwtUser.mockResolvedValue({ userId: 'user-1', email: 'current@example.test', name: 'Current', type: 'human' });
    const client = { handshake: { auth: { token: 'signed-token' } }, data: {}, disconnect: jest.fn() } as any;
    await gateway.handleConnection(client);
    expect(client.data.user).toEqual({ userId: 'user-1', email: 'current@example.test', name: 'Current', type: 'human' });
    expect(client.disconnect).not.toHaveBeenCalled();
  });
});
