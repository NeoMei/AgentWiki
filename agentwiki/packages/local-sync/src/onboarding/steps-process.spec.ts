import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';
const exec = promisify(execFile);
let server: Server, home: string, base: string;
let bootstrapCalls = 0,
  creations = 0,
  exchangeCalls = 0,
  accessFails = true,
  loseBootstrap = true;
const keys = new Set<string>(),
  unexpected: string[] = [];
const scopes = scopesForAgentAccessRole('editor');
let releaseBootstrap: (() => void) | undefined;
let enteredBootstrap: (() => void) | undefined;
const entry = resolve('dist/cli.js');
async function command(...args: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PATH: `${join(home, 'bin')}:${process.env.PATH}`,
  };
  delete env.CODEX_HOME;
  delete env.AGENTWIKI_E2E_CLI_FILE;
  const result = await exec(process.execPath, [entry, 'onboard', ...args, '--protocol', 'json'], {
    env,
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  expect(result.stderr).toBe('');
  const value = JSON.parse(result.stdout);
  expect(result.stdout).not.toMatch(/awd_|awo_|agk_|deviceCode|onboardingToken|apiKey/);
  return value;
}
async function reply(value: unknown) {
  const path = join(home, `reply-${Math.random()}.json`);
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
  return path;
}
beforeAll(async () => {
  await exec('pnpm', ['build'], { cwd: process.cwd(), timeout: 30_000 });
  home = await mkdtemp(join(tmpdir(), 'aw-steps-process-'));
  await mkdir(join(home, 'bin'));
  await writeFile(
    join(home, 'bin', 'codegraph'),
    '#!/bin/sh\nprintf scan-invoked > "$HOME/scan-invoked"\nexit 90\n',
    { mode: 0o700 },
  );
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const send = (value: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.url === '/api/onboard/device/start') {
      expect(body.purpose).toBe('agent-connect');
      return send({
        deviceCode: 'awd_private_fixture',
        userCode: 'CODE',
        verificationUri: `${base}/onboard`,
        verificationUriComplete: `${base}/onboard?userCode=CODE`,
        expiresIn: 600,
        interval: 0,
      });
    }
    if (req.url === '/api/onboard/device/poll')
      return send({ status: 'authorized', onboardingToken: 'awo_private_fixture', expiresIn: 600 });
    if (req.url === '/api/onboard/spaces') {
      expect(req.headers.authorization).toBe('Bearer awo_private_fixture');
      return send({ spaces: [{ id: 's1', name: 'Existing space' }] });
    }
    if (req.url === '/api/onboard/bootstrap') {
      bootstrapCalls++;
      const key = String(req.headers['idempotency-key']);
      if (!keys.has(key)) {
        keys.add(key);
        creations++;
      }
      if (enteredBootstrap) {
        enteredBootstrap();
        await new Promise<void>((r) => (releaseBootstrap = r));
        enteredBootstrap = undefined;
      }
      if (loseBootstrap) {
        loseBootstrap = false;
        req.socket.destroy();
        return;
      }
      return send({
        space: { id: 's1', name: 'Existing space' },
        agent: { id: 'a1', name: 'Test Agent' },
        grant: { role: 'editor', scopes },
        installation: {
          code: 'fixture-installation-code',
          installationId: 'i1',
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        },
      });
    }
    if (req.url === '/api/integrations/local-sync/exchange') {
      exchangeCalls++;
      return send({
        apiKey: 'agk_private_fixture',
        agentId: 'a1',
        credentialId: 'c1',
        spaceId: 's1',
        role: 'editor',
        serverUrl: base,
        pluginVersion: '0.9.1',
        scopes,
      });
    }
    if (req.url === '/api/mcp') return send({}, 404); // Real gateway can handshake with its static tools when remote discovery is unavailable.
    if (req.url === '/api/integrations/mcp') {
      if (accessFails) return send({}, 503);
      return send({
        access: [
          {
            id: 'a1',
            name: 'Test Agent',
            status: 'active',
            grants: [{ role: 'editor', space: { id: 's1', name: 'Existing space' } }],
            credentials: [
              {
                id: 'c1',
                active: true,
                authorization: {
                  id: 'auth1',
                  space: { id: 's1', name: 'Existing space' },
                  role: 'editor',
                  scopes,
                },
              },
            ],
          },
        ],
      });
    }
    unexpected.push(`${req.method} ${req.url}`);
    send({}, 500);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
}, 40_000);
afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
  if (home) await rm(home, { recursive: true, force: true });
});
it('resumes in independent processes, serializes concurrent continuation, retries lost bootstrap and retains configuration across verification failure without any scan/upload', async () => {
  const start = await command('start', '--server', base, '--client', 'claude');
  expect(start.status).toBe('authorization_required');
  const id = start.sessionId;
  const firstStatus = await command('status', '--session', id);
  expect(firstStatus.sessionId).toBe(id);
  const input = await command('continue', '--session', id);
  expect(input.status).toBe('input_required');
  const inputFile = await reply({
    requestId: input.requestId,
    values: { spaceMode: 'existing', spaceId: 's1', agentName: 'Test Agent', role: 'editor' },
  });
  const confirm = await command('continue', '--session', id, '--reply-file', inputFile);
  expect(confirm.status).toBe('confirmation_required');
  const confirmedFile = await reply({
    requestId: confirm.requestId,
    confirmed: true,
    planHash: confirm.planHash,
  });
  expect((await command('continue', '--session', id, '--reply-file', confirmedFile)).status).toBe(
    'configuration_pending',
  );
  const blocked = new Promise<void>((r) => (enteredBootstrap = r));
  const first = command('continue', '--session', id);
  await blocked;
  await expect(command('continue', '--session', id)).rejects.toMatchObject({
    stdout: expect.stringContaining('SESSION_BUSY'),
  });
  releaseBootstrap!();
  expect((await first).error.code).toBe('REMOTE_UNAVAILABLE');
  expect((await command('continue', '--session', id)).stage).toBe('install');
  expect(creations).toBe(1);
  expect(bootstrapCalls).toBe(2);
  const failed = await command('continue', '--session', id);
  expect(failed.connectionStatus).toBe('configured');
  expect(failed.gatewayVerification).toBe('failed');
  const config = await readFile(join(home, '.claude.json'), 'utf8');
  accessFails = false;
  const completed = await command('continue', '--session', id);
  expect(completed).toMatchObject({
    status: 'completed',
    connectionStatus: 'connected',
    gatewayVerification: 'passed',
    hostVerification: 'not_started',
    clientReloadRequired: true,
    knowledgeImport: 'not_started',
  });
  expect(await readFile(join(home, '.claude.json'), 'utf8')).toBe(config);
  expect(exchangeCalls).toBe(1);
  expect(creations).toBe(1);
  expect((await command('continue', '--session', id)).status).toBe('completed');
  await expect(command('continue', '--session', id, '--reply-file', confirmedFile)).rejects.toMatchObject({
    stdout: expect.stringContaining('REPLY_STALE'),
  });
  expect(unexpected).toEqual([]);
  await expect(readFile(join(home, 'scan-invoked'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readdir(join(home, '.agentwiki', 'spaces'))).toEqual([]);
}, 35_000);
