import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  process.env.PROCESS_ROLE = 'worker';
  const worker = await NestFactory.createApplicationContext(WorkerModule);
  worker.enableShutdownHooks();
  console.log('AgentWiki ingestion worker started');
}

void bootstrap();
