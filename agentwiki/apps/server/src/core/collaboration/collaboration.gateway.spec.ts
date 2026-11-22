import { CollaborationGateway } from './collaboration.gateway';
import { TASKBOARD_CHANNEL } from '../../project-taskboard/taskboard-core';
import { createHash } from 'crypto';

describe('CollaborationGateway authentication', () => {
  const jwt = { verify: jest.fn().mockReturnValue({ sub: 'user-1' }) } as any;
  const auth = { validateJwtUser: jest.fn().mockResolvedValue({ userId: 'user-1', name: 'Alice', authVersion: 0 }) } as any;
  const authorization = { assertPageAccess: jest.fn().mockResolvedValue({ id: 'page-1', spaceId: 'space-1' }) } as any;
  const redis = {
    subscribe: jest.fn().mockResolvedValue(() => undefined),
    publish: jest.fn().mockResolvedValue(undefined),
  } as any;
  const runs = { getHumanRun: jest.fn().mockResolvedValue({ id: 'run-1' }) } as any;
  const prisma = { assistTask: { findUnique: jest.fn() } } as any;
  const gateway = new CollaborationGateway(jwt, redis, auth, authorization, runs, prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    auth.nativeJwtRevocationEnabled = false;
    prisma.assistTask.findUnique.mockResolvedValue({ id: 'task-1', pageId: 'page-1', spaceId: 'space-1', requestedByUserId: 'user-1' });
    jwt.verify.mockReturnValue({ sub: 'user-1', authVersion: 0 });
    auth.validateJwtUser.mockResolvedValue({ userId: 'user-1', name: 'Alice', authVersion: 0 });
    authorization.assertPageAccess.mockResolvedValue({ id: 'page-1', spaceId: 'space-1' });
    runs.getHumanRun.mockResolvedValue({ id: 'run-1' });
    process.env.PROCESS_ROLE = 'api';
    (gateway as any).activeUsers.clear();
    (gateway as any).collaborationRates.clear();
    (gateway as any).userSockets.clear();
    (gateway as any).revocableSockets.clear();
    (gateway as any).roomAuthorizationCheckedAt.clear();
    (gateway as any).roomPruneInFlight.clear();
    (gateway as any).server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      in: jest.fn().mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([]) }),
    };
  });

  it('accepts a socket with a valid signed token', async () => {
    const client = { id: 'socket-valid', connected: true, handshake: { auth: { token: 'signed-token' } }, data: {}, disconnect: jest.fn() } as any;
    await gateway.handleConnection(client);
    expect(jwt.verify).toHaveBeenCalledWith('signed-token');
    expect(auth.validateJwtUser).toHaveBeenCalledWith('user-1');
    expect(client.data.user).toEqual(expect.objectContaining({ userId: 'user-1', name: 'Alice' }));
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('denies a revoked UniHub session during the socket handshake', async () => {
    jwt.verify.mockReturnValueOnce({ sub: 'user-1', authVersion: 0, unihubSid: 'revoked' });
    auth.validateJwtUser.mockImplementation(async (_userId: string, sid?: string) =>
      sid === 'revoked' ? null : { userId: 'user-1', name: 'Alice', authVersion: 0 });
    const client = {
      id: 'socket-revoked-handshake', connected: true, handshake: { auth: { token: 'signed-token' } },
      data: {}, disconnect: jest.fn(),
    } as any;

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.data.user).toBeUndefined();
  });

  it('denies a native JWT that was revoked before the socket handshake', async () => {
    const token = 'native-token';
    const revokedId = createHash('sha256').update(token).digest('hex');
    auth.nativeJwtRevocationEnabled = true;
    auth.validateJwtUser.mockImplementation(async (userId: string, _sid?: string, fingerprint?: string) =>
      fingerprint === revokedId ? null : { userId, authVersion: 0 });
    const client = {
      id: 'revoked-native-socket', connected: true, data: {}, disconnect: jest.fn(),
      handshake: { auth: { token } },
    } as any;

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.data.user).toBeUndefined();
  });

  it('denies a run-room join when the socket session is revoked after connection', async () => {
    let revoked = false;
    jwt.verify.mockReturnValueOnce({ sub: 'user-1', authVersion: 0, unihubSid: 'revocable' });
    auth.validateJwtUser.mockImplementation(async (_userId: string, sid?: string) =>
      sid === 'revocable' && revoked ? null : { userId: 'user-1', name: 'Alice', authVersion: 0 });
    const client = {
      id: 'socket-revoked-session', connected: true, handshake: { auth: { token: 'signed-token' } }, data: {},
      rooms: new Set(), join: jest.fn(), emit: jest.fn(), disconnect: jest.fn(),
    } as any;
    await gateway.handleConnection(client);
    revoked = true;

    await gateway.handleJoinCollaborationRun(client, { spaceId: 'space-1', runId: 'run-1' });

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('waits for asynchronous connection authentication before handling a run-room join', async () => {
    let resolvePrincipal!: (value: any) => void;
    auth.validateJwtUser.mockReturnValueOnce(new Promise((resolve) => { resolvePrincipal = resolve; }));
    runs.getHumanRun.mockResolvedValueOnce({ id: 'run-1', spaceId: 'space-1', eventSequence: 41 });
    const client = {
      id: 'socket-auth-race',
      connected: true,
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

  it('leaves the socket quota available when a client disconnects during UniHub authentication', async () => {
    const principal = { userId: 'user-1', name: 'Alice', authVersion: 0 };
    jwt.verify.mockReturnValue({ sub: principal.userId, authVersion: 0, unihubSid: 'active' });
    const createSocket = (id: string) => ({
      id, connected: true, data: {}, handshake: { auth: { token: 'signed-token' } }, disconnect: jest.fn(),
    });
    let finishAuthentication!: (value: typeof principal) => void;
    auth.validateJwtUser.mockReturnValueOnce(new Promise((resolve) => { finishAuthentication = resolve; }));
    const closed = createSocket('closed');
    const authentication = gateway.handleConnection(closed as any);
    closed.connected = false;
    gateway.handleDisconnect(closed as any);
    finishAuthentication(principal);
    await authentication;

    const liveSockets = Array.from({ length: 20 }, (_, index) => createSocket(`live-${index}`));
    for (const socket of liveSockets) await gateway.handleConnection(socket as any);

    expect(liveSockets[19].disconnect).not.toHaveBeenCalled();
    expect(closed.data).not.toHaveProperty('user');
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
      id: `connection-${index}`, connected: true,
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

  it.each(['page', 'run', 'taskboard'])('evicts only the revoked session for the same user before %s broadcasts', async (roomKind) => {
    const makeSocket = (id: string, socketUniHubSid: string) => ({
      id,
      data: { user: { userId: 'user-1', authVersion: 0 }, socketUniHubSid, socketAuthVersion: 0 },
      disconnect: jest.fn(), leave: jest.fn(),
    });
    const allowed = makeSocket('allowed', 'active');
    const revoked = makeSocket('revoked', 'revoked');
    auth.validateJwtUser.mockImplementation(async (_userId: string, sid?: string) =>
      sid === 'revoked' ? null : { userId: 'user-1', authVersion: 0 });
    (gateway as any).server.in.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([allowed, revoked]) });

    if (roomKind === 'page') {
      await (gateway as any).pruneUnauthorizedRoomMembers('page-1', true);
    } else if (roomKind === 'run') {
      await (gateway as any).relayCollaborationRunHint({ spaceId: 'space-1', runId: 'run-1', eventSequence: 1 });
    } else {
      await gateway.onModuleInit();
      const [, listener] = redis.subscribe.mock.calls.find(([channel]: [string]) =>
        channel === TASKBOARD_CHANNEL);
      listener(JSON.stringify({ spaceId: 'space-1', eventSequence: 1 }));
      await new Promise((resolve) => setImmediate(resolve));
      await gateway.onModuleDestroy();
    }

    expect(revoked.disconnect).toHaveBeenCalledWith(true);
    expect(allowed.disconnect).not.toHaveBeenCalled();
  });

  it('rechecks distinct native JWTs independently for two sockets of the same user', async () => {
    auth.nativeJwtRevocationEnabled = true;
    let revokedId: string | undefined;
    auth.validateJwtUser.mockImplementation(async (userId: string, _sid?: string, fingerprint?: string) =>
      revokedId && fingerprint === revokedId ? null : { userId, authVersion: 0 });
    const createSocket = (id: string) => ({
      id, connected: true, data: {}, disconnect: jest.fn(), rooms: new Set(['page-1']),
      handshake: { auth: { token: id } },
    }) as any;
    const allowed = createSocket('active-native-token');
    const revoked = createSocket('revoked-native-token');
    await gateway.handleConnection(allowed);
    await gateway.handleConnection(revoked);
    revokedId = createHash('sha256').update('revoked-native-token').digest('hex');
    (gateway as any).server.in.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([allowed, revoked]) });

    await (gateway as any).pruneUnauthorizedRoomMembers('page-1', true);

    expect(revoked.disconnect).toHaveBeenCalledWith(true);
    expect(allowed.disconnect).not.toHaveBeenCalled();
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

  it('discards an older same-sender page update that finishes verification after a newer update', async () => {
    const pageId = 'page-1';
    const broadcast = jest.fn();
    const rooms = new Set<string>();
    const sender = {
      id: 'editing-socket', connected: true, data: {}, rooms, handshake: { auth: { token: 'signed-token' } },
      join: (room: string) => rooms.add(room), emit: jest.fn(), disconnect: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: broadcast }),
    } as any;
    jwt.verify.mockReturnValue({ sub: 'user-1', authVersion: 0, unihubSid: 'active' });
    await gateway.handleConnection(sender);
    await gateway.handleJoinPage(sender, { pageId });
    broadcast.mockClear();

    let startVerification!: () => void;
    let finishVerification!: (value: object) => void;
    const checkingFirst = new Promise<void>((resolve) => { startVerification = resolve; });
    auth.validateJwtUser.mockImplementationOnce(() => {
      startVerification();
      return new Promise((resolve) => { finishVerification = resolve; });
    });

    const first = gateway.handleContentChange(sender, { pageId, content: 'first', version: 1 });
    await checkingFirst;
    await gateway.handleContentChange(sender, { pageId, content: 'second', version: 2 });
    finishVerification({ userId: 'user-1', name: 'Alice', authVersion: 0 });
    await first;

    expect(broadcast.mock.calls).toEqual([
      ['contentUpdated', { content: 'second', version: 2, userId: sender.id }],
    ]);
  });

  it.each([
    ['UniHub', 'recipient'], ['UniHub', 'sender'], ['native', 'recipient'], ['native', 'sender'],
  ])('rechecks a revoked %s %s before content delivery with a warm room lease', async (credentialKind, revokedRole) => {
    const sockets: ReturnType<typeof createSocket>[] = [];
    const pageId = 'page-1';
    function createSocket(id: string) {
      const rooms = new Set([id]);
      const socket = {
        id, rooms, connected: true, data: {}, handshake: { auth: { token: id } }, emit: jest.fn(),
        join: jest.fn((room: string) => rooms.add(room)),
        leave: jest.fn((room: string) => rooms.delete(room)),
        disconnect: jest.fn(() => {
          socket.connected = false;
          rooms.clear();
          gateway.handleDisconnect(socket as any);
        }),
        to: jest.fn((room: string) => {
          const emit = (event: string, payload: unknown, excluded: string[] = []) => {
            for (const recipient of sockets) {
              if (recipient.id !== id && recipient.rooms.has(room) && !excluded.includes(recipient.id)) {
                recipient.emit(event, payload);
              }
            }
          };
          return {
            emit,
            except: (excluded: string[]) => ({ emit: (event: string, payload: unknown) => emit(event, payload, excluded) }),
          };
        }),
      };
      return socket;
    }

    const sender = createSocket('sender');
    const recipient = createSocket('recipient');
    const legacy = createSocket('legacy');
    sockets.push(sender, recipient, legacy);
    auth.nativeJwtRevocationEnabled = credentialKind === 'native';
    const revokedId = createHash('sha256').update(revokedRole).digest('hex');
    jwt.verify.mockImplementation((id: string) => ({
      sub: id, authVersion: 0, unihubSid: credentialKind === 'UniHub' && id === revokedRole ? 'revocable' : undefined,
    }));
    let revoked = false;
    auth.validateJwtUser.mockImplementation(async (userId: string, sid?: string, fingerprint?: string) =>
      revoked && (sid === 'revocable' || fingerprint === revokedId) ? null : { userId, name: userId, authVersion: 0 });
    (gateway as any).server.in.mockReturnValue({
      fetchSockets: jest.fn(async () => sockets.filter((socket) => socket.rooms.has(pageId))),
    });

    for (const socket of sockets) {
      await gateway.handleConnection(socket as any);
      await gateway.handleJoinPage(socket as any, { pageId });
    }
    await gateway.handleContentChange(sender as any, { pageId, content: 'before', version: 1 });
    expect(recipient.emit).toHaveBeenCalledWith('contentUpdated', { content: 'before', version: 1, userId: 'sender' });
    jest.clearAllMocks();
    revoked = true;

    await gateway.handleContentChange(sender as any, { pageId, content: 'after', version: 2 });

    expect(gateway.server.in).not.toHaveBeenCalled();
    expect((revokedRole === 'sender' ? sender : recipient).disconnect).toHaveBeenCalledWith(true);
    expect(recipient.emit).not.toHaveBeenCalledWith('contentUpdated', expect.anything());
    if (revokedRole === 'sender') {
      expect(legacy.emit).not.toHaveBeenCalledWith('contentUpdated', expect.anything());
    } else {
      expect(legacy.emit).toHaveBeenCalledWith('contentUpdated', { content: 'after', version: 2, userId: 'sender' });
    }
  });

  const assistSocket = (userId: string) => ({
    id: `socket-${userId}`, data: { user: { userId, authVersion: 0 }, socketAuthVersion: 0 },
    rooms: new Set(['page-1']), emit: jest.fn(), disconnect: jest.fn(), leave: jest.fn(),
  });

  it.each(['stream', 'complete', 'error'])('suppresses session %s messages on legacy sockets', async (kind) => {
    const requester = assistSocket('user-1');
    (gateway as any).server.in.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([requester]) });
    prisma.assistTask.findUnique.mockResolvedValue({ pageId: 'page-1', spaceId: 'space-1', requestedByUserId: 'user-1', sessionId: 'session1' });
    await (gateway as any).relayAssistMessage({ kind, pageId: 'page-1', taskId: 'task-1', chunk: 'private references', error: 'failure' });
    expect(requester.emit).not.toHaveBeenCalled();
  });

  it.each(['stream', 'complete', 'error'])('relays private assist %s only to its requester among same-page users', async (kind) => {
    const requester = assistSocket('user-1');
    const other = assistSocket('user-2');
    (gateway as any).server.in.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([requester, other]) });
    auth.validateJwtUser.mockImplementation(async (userId: string) => ({ userId, authVersion: 0 }));
    await (gateway as any).relayAssistMessage({ kind, pageId: 'page-1', taskId: 'task-1', chunk: 'private draft', error: 'private error' });
    expect(requester.emit).toHaveBeenCalledWith(kind === 'stream' ? 'assistStream' : kind === 'complete' ? 'assistComplete' : 'assistError', expect.objectContaining({ taskId: 'task-1' }));
    expect(other.emit).not.toHaveBeenCalled();
    expect((gateway as any).server.to).not.toHaveBeenCalled();
  });

  it.each(['foreign-task-page', 'foreign-task-space', 'missing-task', 'revoked-page'])('drops %s assist relay', async (reason) => {
    const requester = assistSocket('user-1');
    (gateway as any).server.in.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([requester]) });
    if (reason === 'foreign-task-page') prisma.assistTask.findUnique.mockResolvedValue({ pageId: 'page-other', spaceId: 'space-1', requestedByUserId: 'user-1' });
    if (reason === 'foreign-task-space') prisma.assistTask.findUnique.mockResolvedValue({ pageId: 'page-1', spaceId: 'space-2', requestedByUserId: 'user-1' });
    if (reason === 'missing-task') prisma.assistTask.findUnique.mockResolvedValue(null);
    if (reason === 'revoked-page') authorization.assertPageAccess.mockRejectedValue(new Error('revoked'));
    await (gateway as any).relayAssistMessage({ kind: 'stream', pageId: 'page-1', taskId: 'task-1', chunk: 'private' });
    expect(requester.emit).not.toHaveBeenCalled();
    expect((gateway as any).server.to).not.toHaveBeenCalled();
  });

  it('keeps delayed chunk A, chunk B and complete in Redis arrival order for a task', async () => {
    const requester = assistSocket('user-1');
    (gateway as any).server.in.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([requester]) });
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstStarted!: () => void;
    const firstEntered = new Promise<void>((resolve) => { firstStarted = resolve; });
    authorization.assertPageAccess.mockImplementationOnce(async () => {
      firstStarted();
      await firstPending;
      return { id: 'page-1', spaceId: 'space-1' };
    });
    const first = (gateway as any).relayAssistMessage({ kind: 'stream', pageId: 'page-1', taskId: 'task-1', chunk: 'A' });
    await firstEntered;
    const second = (gateway as any).relayAssistMessage({ kind: 'stream', pageId: 'page-1', taskId: 'task-1', chunk: 'B' });
    const complete = (gateway as any).relayAssistMessage({ kind: 'complete', pageId: 'page-1', taskId: 'task-1' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(requester.emit).not.toHaveBeenCalled();
    releaseFirst();
    await Promise.all([first, second, complete]);
    expect(requester.emit.mock.calls).toEqual([
      ['assistStream', { taskId: 'task-1', chunk: 'A' }],
      ['assistStream', { taskId: 'task-1', chunk: 'B' }],
      ['assistComplete', { taskId: 'task-1' }],
    ]);
    expect(authorization.assertPageAccess).toHaveBeenCalledTimes(3);
    expect((gateway as any).assistRelayChains.size).toBe(0);
  });

  it('continues later task events after a relay failure and removes its drained chain', async () => {
    const requester = assistSocket('user-1');
    (gateway as any).server.in.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([requester]) });
    prisma.assistTask.findUnique.mockRejectedValueOnce(new Error('transient DB error'));
    const first = (gateway as any).relayAssistMessage({ kind: 'stream', pageId: 'page-1', taskId: 'task-1', chunk: 'lost' });
    const firstFailure = expect(first).rejects.toThrow('transient DB error');
    const errorEvent = (gateway as any).relayAssistMessage({ kind: 'error', pageId: 'page-1', taskId: 'task-1', error: 'failed' });
    await Promise.all([firstFailure, errorEvent]);
    expect(requester.emit.mock.calls).toEqual([['assistError', { taskId: 'task-1', error: 'failed' }]]);
    expect((gateway as any).assistRelayChains.size).toBe(0);
  });

  it('rechecks authorization for queued events after an earlier chunk is delivered', async () => {
    const requester = assistSocket('user-1');
    requester.emit.mockImplementationOnce(() => {
      authorization.assertPageAccess.mockRejectedValue(new Error('revoked after A'));
    });
    (gateway as any).server.in.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([requester]) });
    await Promise.all([
      (gateway as any).relayAssistMessage({ kind: 'stream', pageId: 'page-1', taskId: 'task-1', chunk: 'A' }),
      (gateway as any).relayAssistMessage({ kind: 'stream', pageId: 'page-1', taskId: 'task-1', chunk: 'B' }),
      (gateway as any).relayAssistMessage({ kind: 'complete', pageId: 'page-1', taskId: 'task-1' }),
    ]);
    expect(requester.emit.mock.calls).toEqual([['assistStream', { taskId: 'task-1', chunk: 'A' }]]);
    expect(authorization.assertPageAccess).toHaveBeenCalledTimes(3);
    expect((gateway as any).assistRelayChains.size).toBe(0);
  });

  it('does not hold unrelated task delivery behind a delayed task', async () => {
    const requester = assistSocket('user-1');
    (gateway as any).server.in.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([requester]) });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    authorization.assertPageAccess.mockImplementationOnce(async () => {
      entered();
      await pending;
      return { id: 'page-1', spaceId: 'space-1' };
    });
    const delayed = (gateway as any).relayAssistMessage({ kind: 'stream', pageId: 'page-1', taskId: 'task-1', chunk: 'A' });
    await started;
    await (gateway as any).relayAssistMessage({ kind: 'complete', pageId: 'page-1', taskId: 'task-2' });
    expect(requester.emit.mock.calls).toEqual([['assistComplete', { taskId: 'task-2' }]]);
    release();
    await delayed;
    expect((gateway as any).assistRelayChains.size).toBe(0);
  });

});
