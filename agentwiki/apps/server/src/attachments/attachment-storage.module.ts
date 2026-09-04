import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  ATTACHMENT_CONFIG,
  loadAttachmentConfig,
  type AttachmentConfig,
} from './attachment.config';
import { ATTACHMENT_STORAGE } from './attachment-storage';
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
