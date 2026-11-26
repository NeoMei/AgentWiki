import { createServer } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { bootstrap, jsonParser, listenApi, resolveApiListenHost } from './main';
import { syncDocumentLimitsMiddleware } from './integrations/obsidian/sync-document-limits';

jest.mock('@nestjs/core', () => {
  const actual = jest.requireActual<typeof import('@nestjs/core')>('@nestjs/core');
  return {
    ...actual,
    NestFactory: {
      ...actual.NestFactory,
      create: jest.fn(() => new Promise(() => undefined)),
    },
  };
});

describe('API listen address', () => {
  const originalPort = process.env.PORT;
  const originalListenHost = process.env.AGENTWIKI_LISTEN_HOST;

  afterEach(() => {
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
    if (originalListenHost === undefined) delete process.env.AGENTWIKI_LISTEN_HOST;
    else process.env.AGENTWIKI_LISTEN_HOST = originalListenHost;
  });

  it('does not bootstrap a server as a side effect of importing listen helpers', () => {
    expect(NestFactory.create).not.toHaveBeenCalled();
  });

  it('passes the configured address through the real bootstrap listen boundary', async () => {
    const listenCalls: unknown[][] = [];
    const fakeApp = {
      getHttpAdapter: () => ({ getInstance: () => ({ set: jest.fn() }) }),
      use: jest.fn(),
      enableCors: jest.fn(),
      setGlobalPrefix: jest.fn(),
      useGlobalPipes: jest.fn(),
      get: jest.fn(() => ({})),
      useGlobalFilters: jest.fn(),
      listen: async (...arguments_: unknown[]) => {
        listenCalls.push(arguments_);
      },
    };
    (NestFactory.create as jest.Mock).mockResolvedValueOnce(fakeApp);
    process.env.PORT = '13000';
    process.env.AGENTWIKI_LISTEN_HOST = '127.0.0.1';
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await bootstrap();
    } finally {
      log.mockRestore();
    }

    expect(listenCalls).toEqual([['13000', '127.0.0.1']]);
  });

  it('preserves the existing one-argument listen call when no address is configured', async () => {
    const calls: Array<Array<string | number>> = [];
    const app = {
      listen: async (...arguments_: [string | number, string?]) => {
        calls.push(arguments_ as Array<string | number>);
      },
    };

    await listenApi(app, '3000', undefined);

    expect(calls).toEqual([['3000']]);
  });

  it('binds a real socket only to the configured loopback address', async () => {
    const server = createServer((_request, response) => response.end('ok'));
    const app = {
      listen: (port: string | number, host?: string) => new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        if (host === undefined) server.listen(Number(port), resolve);
        else server.listen(Number(port), host, resolve);
      }),
    };

    try {
      await listenApi(app, 0, '127.0.0.1');
      const address = server.address() as AddressInfo;
      expect(address.address).toBe('127.0.0.1');
      expect(address.family).toBe('IPv4');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it.each([
    '',
    ' 127.0.0.1',
    '127.0.0.1 ',
    'localhost',
    'http://127.0.0.1',
    '127.0.0.1\n',
  ])('rejects unsafe or malformed configured address %j', (value) => {
    expect(() => resolveApiListenHost(value)).toThrow(
      'AGENTWIKI_LISTEN_HOST must be an IPv4 or IPv6 address without whitespace',
    );
  });
});

it('allows JSON escaping overhead for a 10 MiB document only on content write routes', async () => {
  const app = express();
  app.use(syncDocumentLimitsMiddleware);
  app.use(jsonParser);
  app.use((request, response) => response.json({ bytes: Buffer.byteLength(request.body.content) }));
  app.use((error: { status: number }, _request: Request, response: Response, _next: NextFunction) => {
    response.sendStatus(error.status);
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    const address = server.address() ?? await new Promise<AddressInfo>((resolve) => {
      server.once('listening', () => resolve(server.address() as AddressInfo));
    });
    const url = `http://127.0.0.1:${(address as AddressInfo).port}`;
    const body = JSON.stringify({ content: '\u0001'.repeat(10 * 1024 * 1024) });
    const init = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body };
    const page = await fetch(`${url}/api/pages/page-1`, init);
    expect(page.status).toBe(200);
    await expect(page.json()).resolves.toEqual({ bytes: 10 * 1024 * 1024 });

    const unrelated = await fetch(`${url}/api/other`, init);
    expect(unrelated.status).toBe(413);
    await unrelated.text();

    const syncBatch = `${url}/api/sync/v3/spaces/space-1/push-sessions/session-1/batches/0`;
    const syncHeaders = { 'Content-Type': 'application/json' };
    const syncBody = JSON.stringify({ content: '"'.repeat(6 * 1024 * 1024) });
    const oldClient = await fetch(syncBatch, { method: 'PUT', headers: syncHeaders, body: syncBody });
    expect(oldClient.status).toBe(413);
    await oldClient.text();
    const largeClient = await fetch(syncBatch, {
      method: 'PUT',
      headers: { ...syncHeaders, 'X-AgentWiki-Sync-Max-Page-Bytes': '10485760' },
      body: syncBody,
    });
    expect(largeClient.status).toBe(200);
    await expect(largeClient.json()).resolves.toEqual({ bytes: 6 * 1024 * 1024 });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}, 15_000);
