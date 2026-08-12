import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { RedisService } from '../../database/redis.service';

const ASSIST_CHANNEL = 'agentwiki:collab:assist';

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
    origin: '*',
  },
  namespace: '/collaboration',
})
export class CollaborationGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server: Server;
  private logger = new Logger('CollaborationGateway');
  private unsubscribeRedis: (() => void) | null = null;
  private activeUsers = new Map<string, Map<string, CursorPosition>>();

  constructor(
    private jwtService: JwtService,
    private readonly redis: RedisService,
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
          if (msg.kind === 'stream') {
            this.server.to(msg.pageId).emit('assistStream', { taskId: msg.taskId, chunk: msg.chunk });
          } else if (msg.kind === 'complete') {
            this.server.to(msg.pageId).emit('assistComplete', { taskId: msg.taskId });
          } else if (msg.kind === 'error') {
            this.server.to(msg.pageId).emit('assistError', { taskId: msg.taskId, error: msg.error });
          }
        } catch {
          /* ignore malformed bridge messages */
        }
      });
    } catch (error: any) {
      this.logger.error(`Failed to subscribe to assist channel: ${error?.message || error}`);
    }
  }

  async onModuleDestroy() {
    this.unsubscribeRedis?.();
    this.unsubscribeRedis = null;
  }

  async handleConnection(client: Socket) {
    const token = String(client.handshake.auth?.token || '');
    try {
      const payload = this.jwtService.verify(token);
      client.data.user = payload;
    } catch {
      client.disconnect(true);
      return;
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.activeUsers.forEach((users, pageId) => {
      if (users.has(client.id)) {
        const user = users.get(client.id);
        users.delete(client.id);
        this.server.to(pageId).emit('userLeft', { userId: user?.userId || client.id });
        this.broadcastCursors(pageId);
      }
    });
  }

  @SubscribeMessage('joinPage')
  handleJoinPage(@ConnectedSocket() client: Socket, @MessageBody() body: { pageId: string; userId?: string; userName?: string }) {
    if (!body?.pageId) return;
    client.join(body.pageId);
    const identity = client.data.user as { sub?: string; userId?: string } | undefined;
    const userId = String(identity?.userId || identity?.sub || body.userId || '');
    if (!this.activeUsers.has(body.pageId)) {
      this.activeUsers.set(body.pageId, new Map());
    }
    const users = this.activeUsers.get(body.pageId)!;
    users.set(client.id, {
      userId,
      userName: String(body.userName || ''),
      position: { line: 0, ch: 0 },
      color: this.getUserColor(client.id),
    });
    client.emit('currentUsers', Array.from(users.values()));
    client.to(body.pageId).emit('userJoined', {
      userId,
      userName: String(body.userName || ''),
      color: this.getUserColor(client.id),
    });
    this.logger.log(`Socket ${client.id} joined page room ${body.pageId}`);
  }

  @SubscribeMessage('leavePage')
  handleLeavePage(@ConnectedSocket() client: Socket, @MessageBody() body: { pageId: string }) {
    if (!body?.pageId) return;
    client.leave(body.pageId);
    const users = this.activeUsers.get(body.pageId);
    if (users) {
      const user = users.get(client.id);
      users.delete(client.id);
      this.broadcastCursors(body.pageId);
      client.to(body.pageId).emit('userLeft', { userId: user?.userId || client.id });
    }
    this.logger.log(`Socket ${client.id} left page room ${body.pageId}`);
  }

  @SubscribeMessage('contentChange')
  handleContentChange(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { pageId: string; content: string; version: number },
  ) {
    if (!body?.pageId || !client.rooms.has(body.pageId)) return;
    client.to(body.pageId).emit('contentUpdated', {
      content: body.content,
      version: body.version,
      userId: client.id,
    });
  }

  @SubscribeMessage('cursorMove')
  handleCursorMove(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { pageId: string; position: { line: number; ch: number } },
  ) {
    if (!body?.pageId || !client.rooms.has(body.pageId)) return;
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
      this.server.to(pageId).emit('cursorUpdate', Array.from(users.values()));
    }
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
