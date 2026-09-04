import { CollaborationGateway } from './collaboration.gateway';

describe('CollaborationGateway authentication', () => {
  const jwt = { verify: jest.fn().mockReturnValue({ sub: 'user-1' }) } as any;
  const auth = { validateJwtUser: jest.fn().mockResolvedValue({ userId: 'user-1', name: 'Alice', authVersion: 0 }) } as any;
  const authorization = { assertPageAccess: jest.fn().mockResolvedValue({ id: 'page-1', spaceId: 'space-1' }) } as any;
  const redis = {
    subscribe: jest.fn().mockResolvedValue(() => undefined),
    publish: jest.fn().mockResolvedValue(undefined),
  } as any;
  const runs = { getHumanRun: jest.fn().mockResolvedValue({ id: 'run-1' }) } as any;
  const gateway = new CollaborationGateway(jwt, redis, auth, authorization, runs);

  beforeEach(() => {
    jest.clearAllMocks();
    jwt.verify.mockReturnValue({ sub: 'user-1', authVersion: 0 });
    auth.validateJwtUser.mockResolvedValue({ userId: 'user-1', name: 'Alice', authVersion: 0 });
    authorization.assertPageAccess.mockResolvedValue({ id: 'page-1', spaceId: 'space-1' });
    runs.getHumanRun.mockResolvedValue({ id: 'run-1' });
    process.env.PROCESS_ROLE = 'api';
    (gateway as any).activeUsers.clear();
    (gateway as any).collaborationRates.clear();
    (gateway as any).userSockets.clear();
    (gateway as any).roomAuthorizationCheckedAt.clear();
    (gateway as any).roomPruneInFlight.clear();
    (gateway as any).server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      in: jest.fn().mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([]) }),
    };
  });

  it('accepts a socket with a valid signed token', async () => {
    const client = { id: 'socket-valid', handshake: { auth: { token: 'signed-token' } }, data: {}, disconnect: jest.fn() } as any;
    await gateway.handleConnection(client);
    expect(jwt.verify).toHaveBeenCalledWith('signed-token');
    expect(auth.validateJwtUser).toHaveBeenCalledWith('user-1');
    expect(client.data.user).toEqual(expect.objectContaining({ userId: 'user-1', name: 'Alice' }));
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('waits for asynchronous connection authentication before handling a run-room join', async () => {
    let resolvePrincipal!: (value: any) => void;
    auth.validateJwtUser.mockReturnValueOnce(new Promise((resolve) => { resolvePrincipal = resolve; }));
    runs.getHumanRun.mockResolvedValueOnce({ id: 'run-1', spaceId: 'space-1', eventSequence: 41 });
    const client = {
      id: 'socket-auth-race',
      handshake: { auth: { token: 'signed-token' } },
      data: {},
      rooms: new Set(['socket-auth-race']),
      join: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
    } as any;

    const connection = gateway.handleConnection(client);
    const join = gateway.handleJoinCollaborationRun(client, { spaceId: 'space-1', runId: 'run-1' });
    await Promise.resolve();
    expect(client.join).not.toHaveBeenCalled();

    resolvePrincipal({ userId: 'user-1', name: 'Alice', authVersion: 0 });
    await Promise.all([connection, join]);

    expect(client.join).toHaveBeenCalledWith('collaboration:run:run-1');
    expect(client.emit).toHaveBeenCalledWith('collaborationRunChanged', {
      spaceId: 'space-1', runId: 'run-1', eventSequence: 41,
    });
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

  it('caps parallel sockets for the same user', async () => {
    const clients = Array.from({ length: 21 }, (_, index) => ({
      id: `connection-${index}`,
      handshake: { auth: { token: 'signed-token' } }, data: {}, disconnect: jest.fn(),
    })) as any[];

    for (const client of clients) await gateway.handleConnection(client);

    expect(clients[19].disconnect).not.toHaveBeenCalled();
    expect(clients[20].disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects an established socket after its JWT expiry time', async () => {
    const client = {
      id: 'expired-socket',
      data: {
        user: { userId: 'user-1', name: 'Alice', authVersion: 0 },
        socketAuthVersion: 0,
        socketExpiresAt: Date.now() - 1,
      },
      disconnect: jest.fn(), emit: jest.fn(), join: jest.fn(), rooms: new Set(['expired-socket']),
    } as any;

    await gateway.handleJoinPage(client, { pageId: 'page-1' });

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(authorization.assertPageAccess).not.toHaveBeenCalled();
  });

  it('subscribes to the assist bridge channel on init and unsubscribes on destroy', async () => {
    const assistUnsub = jest.fn();
    const runUnsub = jest.fn();
    redis.subscribe.mockResolvedValueOnce(assistUnsub).mockResolvedValueOnce(runUnsub);
    await gateway.onModuleInit();
    expect(redis.subscribe).toHaveBeenCalledWith('agentwiki:collab:assist', expect.any(Function));
    expect(redis.subscribe).toHaveBeenCalledWith('agentwiki:collaboration:runs', expect.any(Function));
    await gateway.onModuleDestroy();
    expect(assistUnsub).toHaveBeenCalled();
    expect(runUnsub).toHaveBeenCalled();
  });

  it('defaults to API relay subscriptions when PROCESS_ROLE is unset', async () => {
    const previousRole = process.env.PROCESS_ROLE;
    delete process.env.PROCESS_ROLE;
    try {
      await gateway.onModuleInit();

      expect(redis.subscribe).toHaveBeenCalledWith('agentwiki:collab:assist', expect.any(Function));
      expect(redis.subscribe).toHaveBeenCalledWith('agentwiki:collaboration:runs', expect.any(Function));
    } finally {
      await gateway.onModuleDestroy();
      if (previousRole === undefined) delete process.env.PROCESS_ROLE;
      else process.env.PROCESS_ROLE = previousRole;
    }
  });

  it('does not subscribe to socket relay channels in a worker process', async () => {
    process.env.PROCESS_ROLE = 'worker';
    (gateway as any).server = null;

    await gateway.onModuleInit();

    expect(redis.subscribe).not.toHaveBeenCalled();
  });

  it('publishes assist events from a worker without subscribing to relay channels', async () => {
    process.env.PROCESS_ROLE = 'worker';
    (gateway as any).server = null;

    await gateway.onModuleInit();
    gateway.emitAssistStream('page-1', 'task-1', 'chunk-1');
    gateway.emitAssistComplete('page-1', 'task-1');
    gateway.emitAssistError('page-1', 'task-1', 'failed');

    expect(redis.subscribe).not.toHaveBeenCalled();
    expect(redis.publish).toHaveBeenNthCalledWith(1, 'agentwiki:collab:assist', JSON.stringify({
      kind: 'stream', pageId: 'page-1', taskId: 'task-1', chunk: 'chunk-1',
    }));
    expect(redis.publish).toHaveBeenNthCalledWith(2, 'agentwiki:collab:assist', JSON.stringify({
      kind: 'complete', pageId: 'page-1', taskId: 'task-1',
    }));
    expect(redis.publish).toHaveBeenNthCalledWith(3, 'agentwiki:collab:assist', JSON.stringify({
      kind: 'error', pageId: 'page-1', taskId: 'task-1', error: 'failed',
    }));
  });

  it('joins an authorized workflow room and relays refresh hints only', async () => {
    let runListener: ((raw: string) => void) | undefined;
    redis.subscribe.mockImplementation(async (channel: string, listener: (raw: string) => void) => {
      if (channel === 'agentwiki:collaboration:runs') runListener = listener;
      return () => undefined;
    });
    await gateway.onModuleInit();
    const client = {
      id: 'socket-run', data: { user: { userId: 'user-1', name: 'Alice', authVersion: 0 }, socketAuthVersion: 0 },
      join: jest.fn(), leave: jest.fn(), emit: jest.fn(), disconnect: jest.fn(), rooms: new Set(['socket-run']),
    } as any;
    runs.getHumanRun.mockResolvedValueOnce({ id: 'run-1', spaceId: 'space-1', eventSequence: 41 });
    await gateway.handleJoinCollaborationRun(client, { spaceId: 'space-1', runId: 'run-1' });
    expect(runs.getHumanRun).toHaveBeenCalledWith('space-1', 'run-1', expect.objectContaining({ userId: 'user-1' }));
    expect(client.join).toHaveBeenCalledWith('collaboration:run:run-1');
    expect(client.emit).toHaveBeenCalledWith('collaborationRunChanged', {
      spaceId: 'space-1', runId: 'run-1', eventSequence: 41,
    });

    runListener?.(JSON.stringify({ spaceId: 'space-1', runId: 'run-1', eventSequence: 42, secret: 'ignored' }));
    await new Promise((resolve) => setImmediate(resolve));
    const room = (gateway as any).server.to;
    expect(room).toHaveBeenCalledWith('collaboration:run:run-1');
    const emitted = room('collaboration:run:run-1').emit;
    expect(emitted).toHaveBeenCalledWith('collaborationRunChanged', {
      spaceId: 'space-1', runId: 'run-1', eventSequence: 42,
    });
  });

  it('removes sockets that lost workflow access before relaying refresh hints', async () => {
    let runListener: ((raw: string) => void) | undefined;
    redis.subscribe.mockImplementation(async (channel: string, listener: (raw: string) => void) => {
      if (channel === 'agentwiki:collaboration:runs') runListener = listener;
      return () => undefined;
    });
    const allowedSocket = {
      id: 'socket-allowed',
      data: { user: { userId: 'user-1', name: 'Alice', authVersion: 0 }, socketAuthVersion: 0 },
      leave: jest.fn(), disconnect: jest.fn(),
    } as any;
    const revokedSocket = {
      id: 'socket-revoked',
      data: { user: { userId: 'user-2', name: 'Bob', authVersion: 0 }, socketAuthVersion: 0 },
      leave: jest.fn(), disconnect: jest.fn(),
    } as any;
    auth.validateJwtUser.mockImplementation(async (userId: string) => ({
      userId, name: userId === 'user-1' ? 'Alice' : 'Bob', authVersion: 0,
    }));
    runs.getHumanRun.mockImplementation(async (_spaceId: string, _runId: string, principal: any) => {
      if (principal.userId === 'user-2') throw new Error('revoked');
      return { id: 'run-1' };
    });
    const emitted = jest.fn();
    (gateway as any).server = {
      in: jest.fn().mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([allowedSocket, revokedSocket]) }),
      to: jest.fn().mockReturnValue({ emit: emitted }),
    };

    await gateway.onModuleInit();
    runListener?.(JSON.stringify({ spaceId: 'space-1', runId: 'run-1', eventSequence: 43 }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(revokedSocket.leave).toHaveBeenCalledWith('collaboration:run:run-1');
    expect(allowedSocket.leave).not.toHaveBeenCalled();
    expect(emitted).toHaveBeenCalledWith('collaborationRunChanged', {
      spaceId: 'space-1', runId: 'run-1', eventSequence: 43,
    });
  });

  it('tracks active users only after checking page read access', async () => {
    const client = {
      id: 'socket-a',
      data: { user: { userId: 'user-1', name: 'Alice' } },
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

    await gateway.handleJoinPage(client, { pageId: 'page-1', userId: 'forged', userName: 'Forged' });

    expect(authorization.assertPageAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }), 'page-1',
      ['owner', 'admin', 'editor', 'viewer'], 'pages:read',
    );
    expect(client.join).toHaveBeenCalledWith('page-1');
    expect(client.emit).toHaveBeenCalledWith('currentUsers', [
      expect.objectContaining({ userId: 'user-1', userName: 'Alice' }),
    ]);
    expect(client.to).toHaveBeenCalledWith('page-1');
    const joinedEmit = client.to('page-1').emit;
    expect(joinedEmit).toHaveBeenCalledWith('userJoined', expect.objectContaining({ userId: 'user-1', userName: 'Alice' }));
  });

  it('forwards bounded content changes only after checking page write access', async () => {
    const client = {
      id: 'socket-a',
      data: { user: { userId: 'user-1', name: 'Alice' } },
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      rooms: new Set(['page-1']),
    } as any;
    await gateway.handleContentChange(client, { pageId: 'page-1', content: '# hello', version: 42 });

    expect(authorization.assertPageAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }), 'page-1',
      ['owner', 'editor'], 'pages:write',
    );
    expect(client.to).toHaveBeenCalledWith('page-1');
    const emit = client.to('page-1').emit;
    expect(emit).toHaveBeenCalledWith('contentUpdated', {
      content: '# hello',
      version: 42,
      userId: 'socket-a',
    });
  });

  it('denies unauthorized room joins without allocating room state', async () => {
    authorization.assertPageAccess.mockRejectedValueOnce(new Error('denied'));
    const client = {
      id: 'socket-denied', data: { user: { userId: 'user-1', name: 'Alice' } },
      join: jest.fn(), emit: jest.fn(), rooms: new Set(),
    } as any;

    await gateway.handleJoinPage(client, { pageId: 'page-secret' });

    expect(client.join).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('collaborationError', { code: 'PAGE_ACCESS_DENIED' });
    expect((gateway as any).activeUsers.has('page-secret')).toBe(false);
  });

  it('rate-limits repeated room joins before they can fan out database checks', async () => {
    authorization.assertPageAccess.mockRejectedValue(new Error('denied'));
    const client = {
      id: 'socket-rate', data: { user: { userId: 'user-1', name: 'Alice' } },
      join: jest.fn(), emit: jest.fn(), rooms: new Set(['socket-rate']),
    } as any;

    for (let index = 0; index < 31; index += 1) {
      await gateway.handleJoinPage(client, { pageId: `page-${index}` });
    }

    expect(authorization.assertPageAccess).toHaveBeenCalledTimes(30);
    expect(client.emit).toHaveBeenCalledWith('collaborationError', { code: 'EVENT_RATE_LIMITED' });
  });

  it('removes the user and empty room state on leave', async () => {
    const client = {
      id: 'socket-a',
      data: { user: { userId: 'user-1', name: 'Alice' } },
      handshake: { auth: { token: 'signed' } },
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      rooms: new Set(),
    } as any;
    const to = jest.fn().mockReturnValue({ emit: jest.fn() });
    (gateway as any).server = { to };

    await gateway.handleJoinPage(client, { pageId: 'page-1', userId: 'user-1', userName: 'Alice' });
    await gateway.handleLeavePage(client, { pageId: 'page-1' });

    expect(client.leave).toHaveBeenCalledWith('page-1');
    expect((gateway as any).activeUsers.has('page-1')).toBe(false);
  });

  it('keeps one logical presence when the same user has two page sockets', async () => {
    const roomEmit = jest.fn();
    const makeClient = (id: string) => ({
      id,
      data: { user: { userId: 'user-1', name: 'Alice' } },
      handshake: { auth: { token: 'signed' } },
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: roomEmit }),
      rooms: new Set([id]),
    }) as any;
    const first = makeClient('socket-first');
    const second = makeClient('socket-second');
    (gateway as any).server = { to: jest.fn().mockReturnValue({ emit: roomEmit }) };

    await gateway.handleJoinPage(first, { pageId: 'page-1' });
    await gateway.handleJoinPage(second, { pageId: 'page-1' });
    const currentUsers = second.emit.mock.calls.find((call: any[]) => call[0] === 'currentUsers')?.[1];
    expect(currentUsers).toHaveLength(1);

    roomEmit.mockClear();
    await gateway.handleLeavePage(first, { pageId: 'page-1' });
    expect(roomEmit).not.toHaveBeenCalledWith('userLeft', { userId: 'user-1' });
    expect((gateway as any).activeUsers.get('page-1').size).toBe(1);
  });

  it('shares join throttling across reconnects for the same user', async () => {
    authorization.assertPageAccess.mockRejectedValue(new Error('denied'));
    for (let index = 0; index < 31; index += 1) {
      const client = {
        id: `socket-${index}`,
        data: { user: { userId: 'user-1', name: 'Alice', authVersion: 0 }, socketAuthVersion: 0 },
        join: jest.fn(), emit: jest.fn(), disconnect: jest.fn(), rooms: new Set([`socket-${index}`]),
      } as any;
      await gateway.handleJoinPage(client, { pageId: `page-${index}` });
      if (index === 30) {
        expect(client.emit).toHaveBeenCalledWith('collaborationError', { code: 'EVENT_RATE_LIMITED' });
      }
    }
    expect(authorization.assertPageAccess).toHaveBeenCalledTimes(30);
    expect(auth.validateJwtUser).toHaveBeenCalledTimes(30);
  });

  it('enforces the page-room cap across parallel sockets for one user', async () => {
    for (let index = 0; index < 11; index += 1) {
      const client = {
        id: `parallel-${index}`,
        data: { user: { userId: 'user-1', name: 'Alice', authVersion: 0 }, socketAuthVersion: 0 },
        join: jest.fn(), leave: jest.fn(), emit: jest.fn(), disconnect: jest.fn(),
        to: jest.fn().mockReturnValue({ emit: jest.fn() }), rooms: new Set([`parallel-${index}`]),
      } as any;
      await gateway.handleJoinPage(client, { pageId: `room-${index}` });
      if (index === 10) {
        expect(client.join).not.toHaveBeenCalled();
        expect(client.emit).toHaveBeenCalledWith('collaborationError', { code: 'ROOM_LIMIT_EXCEEDED' });
      }
    }
    expect((gateway as any).activeUsers.size).toBe(10);
  });

  it('evicts a passive socket before relaying assistant output after account revocation', async () => {
    const client = {
      id: 'revoked-socket',
      data: { user: { userId: 'user-1', name: 'Alice', authVersion: 0 }, socketAuthVersion: 0 },
      disconnect: jest.fn(), leave: jest.fn(), rooms: new Set(['page-1']),
    } as any;
    (gateway as any).activeUsers.set('page-1', new Map([[
      client.id,
      { userId: 'user-1', userName: 'Alice', position: { line: 0, ch: 0 }, color: '#000' },
    ]]));
    auth.validateJwtUser.mockResolvedValueOnce(null);
    (gateway as any).server.in.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([client]) });

    await (gateway as any).relayAssistMessage({ kind: 'stream', pageId: 'page-1', taskId: 'task-1', chunk: 'secret' });

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect((gateway as any).activeUsers.has('page-1')).toBe(false);
  });

  it('coalesces concurrent room authorization scans', async () => {
    const fetchSockets = jest.fn().mockResolvedValue([]);
    (gateway as any).server.in.mockReturnValue({ fetchSockets });

    await Promise.all([
      (gateway as any).pruneUnauthorizedRoomMembers('page-1'),
      (gateway as any).pruneUnauthorizedRoomMembers('page-1'),
      (gateway as any).pruneUnauthorizedRoomMembers('page-1'),
    ]);

    expect(fetchSockets).toHaveBeenCalledTimes(1);
  });

  it('revalidates each logical user only once when pruning a room with parallel sockets', async () => {
    const makeSocket = (id: string, userId: string) => ({
      id,
      data: {
        user: { userId, name: userId, authVersion: 0 },
        socketAuthVersion: 0,
      },
      disconnect: jest.fn(),
      leave: jest.fn(),
      rooms: new Set(['page-1']),
    }) as any;
    const sockets = [
      makeSocket('user-1-a', 'user-1'),
      makeSocket('user-1-b', 'user-1'),
      makeSocket('user-1-c', 'user-1'),
      makeSocket('user-2-a', 'user-2'),
      makeSocket('user-2-b', 'user-2'),
    ];
    auth.validateJwtUser.mockImplementation(async (userId: string) => ({
      userId, name: userId, authVersion: 0,
    }));
    (gateway as any).server.in.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue(sockets) });

    await (gateway as any).pruneUnauthorizedRoomMembers('page-1', true);

    expect(auth.validateJwtUser).toHaveBeenCalledTimes(2);
    expect(auth.validateJwtUser).toHaveBeenCalledWith('user-1');
    expect(auth.validateJwtUser).toHaveBeenCalledWith('user-2');
    expect(authorization.assertPageAccess).toHaveBeenCalledTimes(2);
  });

  it('rate-limits content before DB work and reuses short authorization leases', async () => {
    const client = {
      id: 'content-flood',
      data: { user: { userId: 'user-1', name: 'Alice', authVersion: 0 }, socketAuthVersion: 0 },
      rooms: new Set(['page-1']), disconnect: jest.fn(), leave: jest.fn(), emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    } as any;
    (gateway as any).activeUsers.set('page-1', new Map([[
      client.id,
      { userId: 'user-1', userName: 'Alice', position: { line: 0, ch: 0 }, color: '#000' },
    ]]));
    (gateway as any).server.in.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([client]) });

    for (let index = 0; index < 11; index += 1) {
      await gateway.handleContentChange(client, { pageId: 'page-1', content: `value-${index}`, version: index });
    }

    expect(auth.validateJwtUser).toHaveBeenCalledTimes(1);
    expect(authorization.assertPageAccess).toHaveBeenCalledTimes(2);
    expect(client.emit).toHaveBeenCalledWith('collaborationError', { code: 'EVENT_RATE_LIMITED' });
  });
});
