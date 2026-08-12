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
  }

  @SubscribeMessage('joinPage')
  handleJoinPage(@ConnectedSocket() client: Socket, @MessageBody() body: { pageId: string; userId?: string; userName?: string }) {
    if (!body?.pageId) return;
    client.join(body.pageId);
    this.logger.log(`Socket ${client.id} joined page room ${body.pageId}`);
  }

  @SubscribeMessage('leavePage')
  handleLeavePage(@ConnectedSocket() client: Socket, @MessageBody() body: { pageId: string }) {
    if (!body?.pageId) return;
    client.leave(body.pageId);
    this.logger.log(`Socket ${client.id} left page room ${body.pageId}`);
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
}
