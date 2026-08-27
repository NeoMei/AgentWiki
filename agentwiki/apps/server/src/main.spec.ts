import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { bootstrap, listenApi, resolveApiListenHost } from './main';

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
