import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/collaboration',
})
export class CollaborationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  private logger = new Logger('CollaborationGateway');

  constructor(private jwtService: JwtService) {}

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

  emitAssistStream(pageId: string, taskId: string, chunk: string) {
    this.server.to(pageId).emit('assistStream', { taskId, chunk });
  }

  emitAssistComplete(pageId: string, taskId: string) {
    this.server.to(pageId).emit('assistComplete', { taskId });
  }

  emitAssistError(pageId: string, taskId: string, error: string) {
    this.server.to(pageId).emit('assistError', { taskId, error });
  }
}
