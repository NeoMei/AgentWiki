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

  it('tracks active users when joining a page and broadcasts presence', async () => {
    const client = {
      id: 'socket-a',
      data: { user: { sub: 'user-1' } },
      handshake: { auth: { token: 'signed' } },
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      rooms: new Set(),
    } as any;
    const server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    } as any;
    (gateway as any).server = server;

    gateway.handleJoinPage(client, { pageId: 'page-1', userId: 'user-1', userName: 'Alice' });

    expect(client.join).toHaveBeenCalledWith('page-1');
    expect(client.emit).toHaveBeenCalledWith('currentUsers', [
      expect.objectContaining({ userId: 'user-1', userName: 'Alice' }),
    ]);
    expect(client.to).toHaveBeenCalledWith('page-1');
    const joinedEmit = client.to('page-1').emit;
    expect(joinedEmit).toHaveBeenCalledWith('userJoined', expect.objectContaining({ userId: 'user-1', userName: 'Alice' }));
  });

  it('forwards content changes to other users in the page room', async () => {
    const client = {
      id: 'socket-a',
      data: { user: { sub: 'user-1' } },
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      rooms: new Set(['page-1']),
    } as any;
    gateway.handleContentChange(client, { pageId: 'page-1', content: '# hello', version: 42 });

    expect(client.to).toHaveBeenCalledWith('page-1');
    const emit = client.to('page-1').emit;
    expect(emit).toHaveBeenCalledWith('contentUpdated', {
      content: '# hello',
      version: 42,
      userId: 'socket-a',
    });
  });

  it('removes the user from the room roster on leave', async () => {
    const client = {
      id: 'socket-a',
      data: { user: { sub: 'user-1' } },
      handshake: { auth: { token: 'signed' } },
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      rooms: new Set(),
    } as any;
    const to = jest.fn().mockReturnValue({ emit: jest.fn() });
    (gateway as any).server = { to };

    gateway.handleJoinPage(client, { pageId: 'page-1', userId: 'user-1', userName: 'Alice' });
    gateway.handleLeavePage(client, { pageId: 'page-1' });

    expect(client.leave).toHaveBeenCalledWith('page-1');
    const users = (gateway as any).activeUsers.get('page-1');
    expect(users.has('socket-a')).toBe(false);
  });
});
