import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../core/auth/auth.module';
import { AuthorizationModule } from '../core/authorization/authorization.module';
import { SyncModule } from '../core/sync/sync.module';
import { DatabaseModule } from '../database/database.module';
import { loadAttachmentConfig, type AttachmentConfig } from './attachment.config';
import {
  AttachmentContentController,
  SpaceAttachmentController,
} from './attachment.controller';
import { ATTACHMENT_CONFIG, AttachmentService } from './attachment.service';
import { ATTACHMENT_STORAGE, type AttachmentStorage } from './attachment-storage';
import {
  AttachmentUploadStorage,
  PostgresAttachmentCapacityCoordinator,
} from './attachment-upload.storage';
import { PrismaService } from '../database/prisma.service';
import { LocalAttachmentStorage } from './local-attachment.storage';

@Module({
  imports: [ConfigModule],
  providers: [
    { provide: ATTACHMENT_CONFIG, useFactory: () => loadAttachmentConfig() },
    {
      provide: ATTACHMENT_STORAGE,
      inject: [ATTACHMENT_CONFIG],
      useFactory: (config: AttachmentConfig) => new LocalAttachmentStorage(config),
    },
  ],
  exports: [ATTACHMENT_CONFIG, ATTACHMENT_STORAGE],
})
export class AttachmentStorageModule {}

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    AuthorizationModule,
    SyncModule,
    AttachmentStorageModule,
    MulterModule.registerAsync({
      imports: [AttachmentStorageModule, DatabaseModule],
      inject: [ATTACHMENT_CONFIG, ATTACHMENT_STORAGE, PrismaService],
      useFactory: (
        config: AttachmentConfig,
        storage: AttachmentStorage,
        prisma: PrismaService,
      ) => ({
        storage: new AttachmentUploadStorage(
          storage,
          config,
          new PostgresAttachmentCapacityCoordinator(prisma),
        ),
        limits: {
          files: 1,
          fileSize: Number(config.maxFileBytes),
        },
      }),
    }),
  ],
  controllers: [SpaceAttachmentController, AttachmentContentController],
  providers: [AttachmentService],
  exports: [AttachmentService, AttachmentStorageModule],
})
export class AttachmentModule {}
