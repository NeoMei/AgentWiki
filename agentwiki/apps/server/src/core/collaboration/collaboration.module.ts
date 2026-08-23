import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CollaborationGateway } from './collaboration.gateway';
import { RedisModule } from '../../database/redis.module';
import { DatabaseModule } from '../../database/database.module';
import { AuthService } from '../auth/auth.service';
import { AuthorizationModule } from '../authorization/authorization.module';
import { CollaborationRunAccessService } from './collaboration-run-access.service';

@Module({
  imports: [
    RedisModule,
    DatabaseModule,
    AuthorizationModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  // Keep the gateway usable by the HTTP-free worker process. Importing the
  // full AuthModule here would also instantiate its controllers and guards.
  providers: [AuthService, CollaborationRunAccessService, CollaborationGateway],
  exports: [CollaborationGateway, CollaborationRunAccessService],
})
export class CollaborationModule {}
