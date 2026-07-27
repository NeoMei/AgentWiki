import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { AuthorizationService } from '../authorization/authorization.service';
import { AuthService } from '../auth/auth.service';

interface CursorPosition {
  userId: string;
  userName: string;
  position: { line: number; ch: number };
  color: string;
}

@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000').split(','),
    credentials: true,
  },
  namespace: 'collaboration',
})
export class CollaborationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private activeUsers = new Map<string, Map<string, CursorPosition>>();

  constructor(
    private readonly jwt: JwtService,
    private readonly authorization: AuthorizationService,
    private readonly auth: AuthService,
  ) {}

  async handleConnection(client: Socket) {
    const token = String(client.handshake.auth?.token || '');
    try {
      const payload = this.jwt.verify(token);
      const principal = await this.auth.validateJwtUser(payload.sub);
      if (!principal) throw new Error('User account is unavailable');
      client.data.user = principal;
    } catch {
      client.disconnect(true);
      return;
    }
  }

  handleDisconnect(client: Socket) {
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
  async handleJoinPage(
    @MessageBody() data: { pageId: string; userName: string },
    @ConnectedSocket() client: Socket,
  ) {
    const identity = client.data.user;
    if (!identity) return;
    await this.authorization.assertPageAccess(identity.userId, data.pageId);
    client.join(data.pageId);
    if (!this.activeUsers.has(data.pageId)) {
      this.activeUsers.set(data.pageId, new Map());
    }
    const users = this.activeUsers.get(data.pageId)!;
    users.set(client.id, {
      userId: identity.userId,
      userName: identity.name || identity.email,
      position: { line: 0, ch: 0 },
      color: this.getUserColor(client.id),
    });
    client.emit('currentUsers', Array.from(users.values()));
    client.to(data.pageId).emit('userJoined', {
      userId: identity.userId,
      userName: identity.name || identity.email,
      color: this.getUserColor(client.id),
    });
  }

  @SubscribeMessage('cursorMove')
  async handleCursorMove(
    @MessageBody() data: { pageId: string; position: { line: number; ch: number } },
    @ConnectedSocket() client: Socket,
  ) {
    if (!client.rooms.has(data.pageId)) return;
    await this.authorization.assertPageAccess(client.data.user.userId, data.pageId);
    const users = this.activeUsers.get(data.pageId);
    if (users) {
      const user = users.get(client.id);
      if (user) {
        user.position = data.position;
        this.broadcastCursors(data.pageId);
      }
    }
  }

  @SubscribeMessage('contentChange')
  async handleContentChange(
    @MessageBody() data: { pageId: string; content: string; version: number },
    @ConnectedSocket() client: Socket,
  ) {
    if (!client.rooms.has(data.pageId)) return;
    await this.authorization.assertPageAccess(client.data.user.userId, data.pageId, ['owner', 'editor']);
    client.to(data.pageId).emit('contentUpdated', {
      content: data.content,
      version: data.version,
      userId: client.id,
    });
  }

  @SubscribeMessage('leavePage')
  handleLeavePage(
    @MessageBody() data: { pageId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(data.pageId);
    const users = this.activeUsers.get(data.pageId);
    if (users) {
      const user = users.get(client.id);
      users.delete(client.id);
      this.broadcastCursors(data.pageId);
      client.to(data.pageId).emit('userLeft', { userId: user?.userId || client.id });
    }
  }

  private broadcastCursors(pageId: string) {
    const users = this.activeUsers.get(pageId);
    if (users) {
      this.server.to(pageId).emit('cursorUpdate', Array.from(users.values()));
    }
  }

  private getUserColor(userId: string): string {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }
}
