import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './core/filters/all-exceptions.filter';
import { json } from 'express';
import { randomUUID } from 'crypto';
import { isIP } from 'node:net';

type ApiListenApplication = {
  listen: (port: string | number, host?: string) => Promise<unknown>;
};

export function resolveApiListenHost(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length === 0 || value !== value.trim() || isIP(value) === 0) {
    throw new Error('AGENTWIKI_LISTEN_HOST must be an IPv4 or IPv6 address without whitespace');
  }
  return value;
}

export async function listenApi(
  app: ApiListenApplication,
  port: string | number,
  configuredHost: string | undefined,
): Promise<void> {
  const host = resolveApiListenHost(configuredHost);
  if (host === undefined) await app.listen(port);
  else await app.listen(port, host);
}

export async function bootstrap() {
  process.env.PROCESS_ROLE ||= 'api';
  const app = await NestFactory.create(AppModule);
  if (process.env.NODE_ENV === 'production') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }
  // Allow up to 11 MB JSON body (10 MB source content + JSON overhead)
  app.use(json({ limit: '11mb' }));
  app.use((request: any, response: any, next: () => void) => {
    request.requestId = request.headers['x-request-id'] || randomUUID();
    response.setHeader('x-request-id', request.requestId);
    next();
  });
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapterHost));

  await listenApi(app, process.env.PORT ?? 3000, process.env.AGENTWIKI_LISTEN_HOST);
  console.log('Server running on http://localhost:' + (process.env.PORT ?? 3000));
}
if (require.main === module) void bootstrap();
