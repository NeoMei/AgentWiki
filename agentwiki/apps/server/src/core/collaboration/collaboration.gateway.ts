import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { RedisService } from '../../database/redis.service';
import { AuthService } from '../auth/auth.service';
import { AuthorizationService, type Principal } from '../authorization/authorization.service';
import { COLLABORATION_RUN_CHANNEL } from '../../collaboration-workflows/collaboration-events.service';
import { CollaborationRunAccessService } from './collaboration-run-access.service';

const ASSIST_CHANNEL = 'agentwiki:collab:assist';
const SOCKET_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const MAX_PAGE_ROOMS_PER_SOCKET = 10;
const MAX_PAGE_CONTENT_LENGTH = 200_000;
const MAX_SOCKETS_PER_USER = 20;
const ROOM_AUTHORIZATION_LEASE_MS = 1_000;

type AssistChannelMessage =
  | { kind: 'stream'; pageId: string; taskId: string; chunk: string }
  | { kind: 'complete'; pageId: string; taskId: string }
  | { kind: 'error'; pageId: string; taskId: string; error: string };

interface CursorPosition {
  userId: string;
  userName: string;
  position: { line: number; ch: number };
  color: string;
}

@WebSocketGateway({
  cors: {
    origin: SOCKET_ORIGINS,
    credentials: true,
  },
  maxHttpBufferSize: 256 * 1024,
  namespace: '/collaboration',
})
export class CollaborationGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server: Server;
  private logger = new Logger('CollaborationGateway');
  private unsubscribeRedis: (() => void) | null = null;
  private unsubscribeRuns: (() => void) | null = null;
  private activeUsers = new Map<string, Map<string, CursorPosition>>();
  private userSockets = new Map<string, Set<string>>();
  private roomAuthorizationCheckedAt = new Map<string, number>();
  private roomPruneInFlight = new Map<string, Promise<void>>();

  constructor(
    private jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly auth: AuthService,
    private readonly authorization: AuthorizationService,
    private readonly runs: CollaborationRunAccessService,
  ) {}

  async onModuleInit() {
    // Worker and API are separate processes. Assist tasks run in the worker,
    // whose socket.io server has no connected clients. Bridge streaming events
    // over Redis so the API process (which owns the client sockets) can relay
    // them into the page rooms.
    try {
      this.unsubscribeRedis = await this.redis.subscribe(ASSIST_CHANNEL, (raw) => {
        try {
          const msg = JSON.parse(raw) as AssistChannelMessage;
          void this.relayAssistMessage(msg).catch((error: any) => {
            this.logger.error(`Failed to relay assist message: ${error?.message || error}`);
          });
        } catch {
          /* ignore malformed bridge messages */
        }
      });
      this.unsubscribeRuns = await this.redis.subscribe(COLLABORATION_RUN_CHANNEL, (raw) => {
        try {
          const message = JSON.parse(raw) as { spaceId?: unknown; runId?: unknown; eventSequence?: unknown };
          if (
            !this.validRunId(message.spaceId)
            || !this.validRunId(message.runId)
            || !Number.isSafeInteger(message.eventSequence)
            || Number(message.eventSequence) < 0
          ) return;
          const hint = {
            spaceId: message.spaceId,
            runId: message.runId,
            eventSequence: Number(message.eventSequence),
          };
          void this.relayCollaborationRunHint(hint).catch((error: any) => {
            this.logger.error(`Failed to relay collaboration run hint: ${error?.message || error}`);
          });
        } catch {
          /* ignore malformed refresh hints */
        }
      });
    } catch (error: any) {
      this.logger.error(`Failed to subscribe to assist channel: ${error?.message || error}`);
    }
  }

  async onModuleDestroy() {
    this.unsubscribeRedis?.();
    this.unsubscribeRedis = null;
    this.unsubscribeRuns?.();
    this.unsubscribeRuns = null;
  }

  async handleConnection(client: Socket) {
    const token = String(client.handshake.auth?.token || '');
    try {
      const payload = this.jwtService.verify(token) as { sub?: string; authVersion?: number; exp?: number };
      const existingSockets = payload.sub ? this.userSockets.get(payload.sub) : undefined;
      if (existingSockets && existingSockets.size >= MAX_SOCKETS_PER_USER) {
        client.disconnect(true);
        return;
      }
      const principal = payload.sub ? await this.auth.validateJwtUser(payload.sub) : null;
      if (
        !principal || principal.mustChangePassword ||
        (payload.authVersion !== undefined && principal.authVersion !== undefined && payload.authVersion !== principal.authVersion)
      ) {
        throw new Error('Socket token is no longer valid');
      }
      client.data.user = principal;
      client.data.socketAuthVersion = payload.authVersion;
      client.data.socketExpiresAt = payload.exp ? payload.exp * 1_000 : undefined;
      const sockets = this.userSockets.get(principal.userId) || new Set<string>();
      if (sockets.size >= MAX_SOCKETS_PER_USER) {
        client.disconnect(true);
        return;
      }
      sockets.add(client.id);
      this.userSockets.set(principal.userId, sockets);
    } catch {
      client.disconnect(true);
      return;
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.activeUsers.forEach((users, pageId) => {
      if (users.has(client.id)) {
        this.removeClientFromPage(client, pageId);
      }
    });
    const userId = (client.data.user as Principal | undefined)?.userId;
    if (userId) {
      const sockets = this.userSockets.get(userId);
      sockets?.delete(client.id);
      if (!sockets?.size) this.userSockets.delete(userId);
    }
  }

  @SubscribeMessage('joinPage')
  async handleJoinPage(@ConnectedSocket() client: Socket, @MessageBody() body: { pageId: string; userId?: string; userName?: string }) {
    if (!this.validPageId(body?.pageId)) return;
    const cachedUserId = (client.data.user as Principal | undefined)?.userId;
    if (!cachedUserId || !this.allowEvent(cachedUserId, 'join', 30, 60_000)) {
      client.emit('collaborationError', { code: 'EVENT_RATE_LIMITED' });
      return;
    }
    const principal = await this.refreshSocketPrincipal(client);
    if (!principal?.userId) return;
    const alreadyJoinedByUser = this.userIsPresent(principal.userId, body.pageId);
    if (!alreadyJoinedByUser && this.joinedPageCount(principal.userId) >= MAX_PAGE_ROOMS_PER_SOCKET) {
      client.emit('collaborationError', { code: 'ROOM_LIMIT_EXCEEDED' });
      return;
    }
    try {
      await this.authorization.assertPageAccess(
        principal, body.pageId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read',
      );
    } catch {
      client.emit('collaborationError', { code: 'PAGE_ACCESS_DENIED' });
      return;
    }
    await this.pruneUnauthorizedRoomMembers(body.pageId, true);
    const currentPrincipal = await this.refreshSocketPrincipal(client);
    if (!currentPrincipal) return;
    try {
      await this.authorization.assertPageAccess(
        currentPrincipal, body.pageId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read',
      );
    } catch {
      client.emit('collaborationError', { code: 'PAGE_ACCESS_DENIED' });
      return;
    }
    await client.join(body.pageId);
    const userId = principal.userId;
    const userName = String(principal.name || '').slice(0, 200);
    if (!this.activeUsers.has(body.pageId)) {
      this.activeUsers.set(body.pageId, new Map());
    }
    const users = this.activeUsers.get(body.pageId)!;
    const alreadyPresent = [...users.values()].some((user) => user.userId === userId);
    users.set(client.id, {
      userId,
      userName,
      position: { line: 0, ch: 0 },
      color: this.getUserColor(client.id),
    });
    client.emit('currentUsers', this.uniqueUsers(users));
    if (!alreadyPresent) {
      client.to(body.pageId).emit('userJoined', {
        userId,
        userName,
        color: this.getUserColor(client.id),
      });
    }
    this.logger.log(`Socket ${client.id} joined page room ${body.pageId}`);
  }

  @SubscribeMessage('leavePage')
  async handleLeavePage(@ConnectedSocket() client: Socket, @MessageBody() body: { pageId: string }) {
    if (!this.validPageId(body?.pageId)) return;
    const cachedUserId = (client.data.user as Principal | undefined)?.userId;
    if (!cachedUserId || !this.allowEvent(cachedUserId, 'leave', 60, 60_000)) return;
    client.leave(body.pageId);
    this.removeClientFromPage(client, body.pageId);
    this.logger.log(`Socket ${client.id} left page room ${body.pageId}`);
  }

  @SubscribeMessage('joinCollaborationRun')
  async handleJoinCollaborationRun(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { spaceId: string; runId: string },
  ) {
    if (!this.validRunId(body?.spaceId) || !this.validRunId(body?.runId)) return;
    const principal = await this.refreshSocketPrincipal(client);
    if (!principal) return;
    const room = `collaboration:run:${body.runId}`;
    const joinedRunRooms = [...client.rooms].filter((name) => name.startsWith('collaboration:run:'));
    if (!client.rooms.has(room) && joinedRunRooms.length >= 20) {
      client.emit('collaborationError', { code: 'ROOM_LIMIT_EXCEEDED' });
      return;
    }
    try {
      await this.runs.getHumanRun(body.spaceId, body.runId, principal);
    } catch {
      client.emit('collaborationError', { code: 'COLLABORATION_RUN_ACCESS_DENIED' });
      return;
    }
    await client.join(room);
  }

  @SubscribeMessage('leaveCollaborationRun')
  async handleLeaveCollaborationRun(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { runId: string },
  ) {
    if (!this.validRunId(body?.runId)) return;
    await client.leave(`collaboration:run:${body.runId}`);
  }

  @SubscribeMessage('contentChange')
  async handleContentChange(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { pageId: string; content: string; version: number },
  ) {
    if (
      !this.validPageId(body?.pageId) || !client.rooms.has(body.pageId) ||
      typeof body.content !== 'string' || body.content.length > MAX_PAGE_CONTENT_LENGTH ||
      !Number.isSafeInteger(body.version) || body.version < 0
    ) return;
    const cachedUserId = (client.data.user as Principal | undefined)?.userId;
    if (!cachedUserId || !this.allowEvent(cachedUserId, 'content', 10, 1_000)) {
      client.emit('collaborationError', { code: 'EVENT_RATE_LIMITED' });
      return;
    }
    await this.pruneUnauthorizedRoomMembers(body.pageId);
    if (!client.rooms.has(body.pageId)) return;
    if (!await this.hasSocketWriteAccess(client, body.pageId)) {
      await client.leave(body.pageId);
      this.removeClientFromPage(client, body.pageId);
      client.emit('collaborationError', { code: 'PAGE_WRITE_DENIED' });
      return;
    }
    client.to(body.pageId).emit('contentUpdated', {
      content: body.content,
      version: body.version,
      userId: client.id,
    });
  }

  @SubscribeMessage('cursorMove')
  async handleCursorMove(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { pageId: string; position: { line: number; ch: number } },
  ) {
    if (
      !this.validPageId(body?.pageId) || !client.rooms.has(body.pageId) ||
      !body.position || !Number.isSafeInteger(body.position.line) || !Number.isSafeInteger(body.position.ch) ||
      body.position.line < 0 || body.position.ch < 0 || body.position.line > 1_000_000 || body.position.ch > 1_000_000
    ) return;
    const cachedUserId = (client.data.user as Principal | undefined)?.userId;
    if (!cachedUserId || !this.allowEvent(cachedUserId, 'cursor', 30, 1_000)) return;
    await this.pruneUnauthorizedRoomMembers(body.pageId);
    if (!client.rooms.has(body.pageId)) return;
    const users = this.activeUsers.get(body.pageId);
    if (users) {
      const user = users.get(client.id);
      if (user && body.position) {
        user.position = body.position;
        this.broadcastCursors(body.pageId);
      }
    }
  }

  emitAssistStream(pageId: string, taskId: string, chunk: string) {
    void this.redis.publish(ASSIST_CHANNEL, JSON.stringify({ kind: 'stream', pageId, taskId, chunk }));
  }

  emitAssistComplete(pageId: string, taskId: string) {
    void this.redis.publish(ASSIST_CHANNEL, JSON.stringify({ kind: 'complete', pageId, taskId }));
  }

  emitAssistError(pageId: string, taskId: string, error: string) {
    void this.redis.publish(ASSIST_CHANNEL, JSON.stringify({ kind: 'error', pageId, taskId, error }));
  }

  private broadcastCursors(pageId: string) {
    const users = this.activeUsers.get(pageId);
    if (users) {
      this.server.to(pageId).emit('cursorUpdate', this.uniqueUsers(users));
    }
  }

  private removeClientFromPage(client: Socket, pageId: string) {
    const users = this.activeUsers.get(pageId);
    if (!users) return;
    const user = users.get(client.id);
    if (!user) return;
    users.delete(client.id);
    if (users.size === 0) {
      this.activeUsers.delete(pageId);
      this.roomAuthorizationCheckedAt.delete(pageId);
    }
    const stillPresent = [...users.values()].some((candidate) => candidate.userId === user.userId);
    if (!stillPresent) this.server.to(pageId).emit('userLeft', { userId: user.userId });
    this.broadcastCursors(pageId);
  }

  private uniqueUsers(users: Map<string, CursorPosition>): CursorPosition[] {
    return [...new Map([...users.values()].map((user) => [user.userId, user])).values()];
  }

  private validPageId(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
  }

  private validRunId(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
  }

  private readonly collaborationRates = new Map<string, { startedAt: number; count: number }>();

  private allowEvent(userId: string, kind: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const key = `${userId}:${kind}`;
    const state = this.collaborationRates.get(key);
    if (!state || now - state.startedAt >= windowMs) {
      this.collaborationRates.set(key, { startedAt: now, count: 1 });
      this.compactCollaborationRates(now);
      return true;
    }
    state.count += 1;
    return state.count <= limit;
  }

  private compactCollaborationRates(now: number) {
    if (this.collaborationRates.size <= 10_000) return;
    for (const [key, state] of this.collaborationRates) {
      if (now - state.startedAt >= 60_000) this.collaborationRates.delete(key);
    }
  }

  private joinedPageCount(userId: string): number {
    let count = 0;
    for (const users of this.activeUsers.values()) {
      if ([...users.values()].some((user) => user.userId === userId)) count += 1;
    }
    return count;
  }

  private userIsPresent(userId: string, pageId: string): boolean {
    return [...(this.activeUsers.get(pageId)?.values() || [])].some((user) => user.userId === userId);
  }

  private async refreshSocketPrincipal(client: Socket): Promise<(Principal & { name?: string; authVersion?: number }) | null> {
    const previous = client.data.user as (Principal & { authVersion?: number }) | undefined;
    if (!previous?.userId) return null;
    const current = await this.auth.validateJwtUser(previous.userId);
    if (
      !current || current.mustChangePassword ||
      (client.data.socketExpiresAt !== undefined && Date.now() >= client.data.socketExpiresAt) ||
      (client.data.socketAuthVersion !== undefined && current.authVersion !== client.data.socketAuthVersion)
    ) {
      client.disconnect(true);
      return null;
    }
    client.data.user = current;
    return current;
  }

  private async pruneUnauthorizedRoomMembers(pageId: string, force = false) {
    if (!this.server?.in) return;
    const now = Date.now();
    if (!force && now - (this.roomAuthorizationCheckedAt.get(pageId) || 0) < ROOM_AUTHORIZATION_LEASE_MS) return;
    const existing = this.roomPruneInFlight.get(pageId);
    if (existing) return existing;
    const task = this.performRoomPrune(pageId, now).finally(() => {
      this.roomPruneInFlight.delete(pageId);
    });
    this.roomPruneInFlight.set(pageId, task);
    return task;
  }

  private async performRoomPrune(pageId: string, checkedAt: number) {
    const sockets = await this.server.in(pageId).fetchSockets();
    const socketsByUser = new Map<string, Socket[]>();
    for (const socket of sockets as unknown as Socket[]) {
      const previous = socket.data.user as (Principal & { authVersion?: number }) | undefined;
      if (!previous?.userId) {
        socket.disconnect(true);
        this.removeClientFromPage(socket, pageId);
        continue;
      }
      const userSockets = socketsByUser.get(previous.userId) || [];
      userSockets.push(socket);
      socketsByUser.set(previous.userId, userSockets);
    }

    for (const [userId, userSockets] of socketsByUser) {
      const current = await this.auth.validateJwtUser(userId);
      const eligibleSockets = userSockets.filter((socket) => {
        const expired = socket.data.socketExpiresAt !== undefined && Date.now() >= socket.data.socketExpiresAt;
        const versionChanged = current && socket.data.socketAuthVersion !== undefined &&
          current.authVersion !== socket.data.socketAuthVersion;
        if (!current || current.mustChangePassword || expired || versionChanged) {
          socket.disconnect(true);
          this.removeClientFromPage(socket, pageId);
          return false;
        }
        socket.data.user = current;
        return true;
      });
      if (!current || eligibleSockets.length === 0) continue;

      try {
        await this.authorization.assertPageAccess(
          current, pageId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read',
        );
      } catch {
        await Promise.all(eligibleSockets.map(async (socket) => {
          await socket.leave(pageId);
          this.removeClientFromPage(socket, pageId);
        }));
      }
    }
    if (this.activeUsers.has(pageId)) this.roomAuthorizationCheckedAt.set(pageId, checkedAt);
    else this.roomAuthorizationCheckedAt.delete(pageId);
  }

  private async relayAssistMessage(msg: AssistChannelMessage) {
    if (!this.validPageId(msg?.pageId)) return;
    await this.pruneUnauthorizedRoomMembers(msg.pageId, msg.kind !== 'stream');
    if (msg.kind === 'stream') {
      this.server.to(msg.pageId).emit('assistStream', { taskId: msg.taskId, chunk: msg.chunk });
    } else if (msg.kind === 'complete') {
      this.server.to(msg.pageId).emit('assistComplete', { taskId: msg.taskId });
    } else if (msg.kind === 'error') {
      this.server.to(msg.pageId).emit('assistError', { taskId: msg.taskId, error: msg.error });
    }
  }

  private async relayCollaborationRunHint(hint: { spaceId: string; runId: string; eventSequence: number }) {
    const room = `collaboration:run:${hint.runId}`;
    const sockets = await this.server.in(room).fetchSockets();
    const socketsByUser = new Map<string, Socket[]>();
    for (const socket of sockets as unknown as Socket[]) {
      const previous = socket.data.user as (Principal & { authVersion?: number }) | undefined;
      if (!previous?.userId) {
        socket.disconnect(true);
        continue;
      }
      const userSockets = socketsByUser.get(previous.userId) || [];
      userSockets.push(socket);
      socketsByUser.set(previous.userId, userSockets);
    }

    for (const [userId, userSockets] of socketsByUser) {
      const current = await this.auth.validateJwtUser(userId);
      const eligibleSockets = userSockets.filter((socket) => {
        const expired = socket.data.socketExpiresAt !== undefined && Date.now() >= socket.data.socketExpiresAt;
        const versionChanged = current && socket.data.socketAuthVersion !== undefined &&
          current.authVersion !== socket.data.socketAuthVersion;
        if (!current || current.mustChangePassword || expired || versionChanged) {
          socket.disconnect(true);
          return false;
        }
        socket.data.user = current;
        return true;
      });
      if (!current || eligibleSockets.length === 0) continue;

      try {
        await this.runs.getHumanRun(hint.spaceId, hint.runId, current);
      } catch {
        await Promise.all(eligibleSockets.map((socket) => socket.leave(room)));
      }
    }

    this.server.to(room).emit('collaborationRunChanged', hint);
  }

  private async hasSocketWriteAccess(client: Socket, pageId: string): Promise<boolean> {
    const leases = (client.data.pageWriteAuthorization ||= {}) as Record<
      string,
      { checkedAt?: number; inFlight?: Promise<boolean> }
    >;
    const lease = (leases[pageId] ||= {});
    if (lease.checkedAt && Date.now() - lease.checkedAt < ROOM_AUTHORIZATION_LEASE_MS) return true;
    if (lease.inFlight) return lease.inFlight;
    lease.inFlight = (async () => {
      const principal = client.data.user as Principal | undefined;
      if (!principal?.userId) return false;
      try {
        await this.authorization.assertPageAccess(
          principal, pageId, ['owner', 'editor'], 'pages:write',
        );
        lease.checkedAt = Date.now();
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      delete lease.inFlight;
    });
    return lease.inFlight;
  }

  private getUserColor(socketId: string): string {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];
    let hash = 0;
    for (let i = 0; i < socketId.length; i += 1) {
      hash = ((hash << 5) - hash + socketId.charCodeAt(i)) | 0;
    }
    return colors[Math.abs(hash) % colors.length];
  }
}
