import { CollaborationGateway } from './collaboration.gateway';

describe('CollaborationGateway authentication', () => {
  const jwt = { verify: jest.fn().mockReturnValue({ sub: 'user-1' }) } as any;
  const redis = {
    subscribe: jest.fn().mockResolvedValue(() => undefined),
    publish: jest.fn().mockResolvedValue(undefined),
  } as any;
  const gateway = new CollaborationGateway(jwt, redis);

  beforeEach(() => jest.clearAllMocks());

  it('accepts a socket with a valid signed token', async () => {
    const client = { handshake: { auth: { token: 'signed-token' } }, data: {}, disconnect: jest.fn() } as any;
    await gateway.handleConnection(client);
    expect(jwt.verify).toHaveBeenCalledWith('signed-token');
    expect(client.data.user).toEqual({ sub: 'user-1' });
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects a socket with an invalid or missing token', async () => {
    const badClient = { handshake: { auth: { token: 'bad' } }, data: {}, disconnect: jest.fn() } as any;
    jwt.verify.mockImplementationOnce(() => { throw new Error('jwt expired'); });
    await gateway.handleConnection(badClient);
    expect(badClient.disconnect).toHaveBeenCalledWith(true);

    const noToken = { handshake: { auth: {} }, data: {}, disconnect: jest.fn() } as any;
    jwt.verify.mockImplementationOnce(() => { throw new Error('no token'); });
    await gateway.handleConnection(noToken);
    expect(noToken.disconnect).toHaveBeenCalledWith(true);
  });

  it('subscribes to the assist bridge channel on init and unsubscribes on destroy', async () => {
    const unsub = jest.fn();
    redis.subscribe.mockResolvedValueOnce(unsub);
    await gateway.onModuleInit();
    expect(redis.subscribe).toHaveBeenCalledWith('agentwiki:collab:assist', expect.any(Function));
    await gateway.onModuleDestroy();
    expect(unsub).toHaveBeenCalled();
  });
});
