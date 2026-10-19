import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { buildOnboardPrompt } from './onboardPrompt';

const hasZsh = spawnSync('zsh', ['--version']).status === 0;
it.skipIf(!hasZsh).each([
  'https://wiki.example/api',
  'http://[::1]:5198/api',
])('passes the server URL as one literal argument in zsh: %s', serverUrl => {
  for (const zh of [true, false]) {
    const prompt = buildOnboardPrompt(zh, 'codex', serverUrl);
    const command = prompt.split('\n').find(line => line.startsWith('npx '))!;
    // Shadow npx with a shell function: inspect argv without package execution or network access.
    const probe = `npx() { printf '%s\\0' "$@"; }\n${command}`;
    const args = execFileSync('zsh', ['-f', '-c', probe], {encoding:'utf8'}).split('\0').slice(0,-1);
    expect(args).toEqual(['--yes','@neomei/agentwiki-local-sync@0.13.4','onboard','start','--server',serverUrl,'--client','codex','--protocol','json']);
  }
});

it.each([true, false])('creates a private disposable WorkBuddy npm cache before startup (zh=%s)', zh => {
  for (const client of ['workbuddy', 'generic'] as const) {
    const prompt = buildOnboardPrompt(zh, client, 'https://wiki.example/api');
    const bootstrap = prompt.match(/^node -e "(.+)"$/m)?.[1];
    expect(bootstrap).toBeDefined();
    const root = mkdtempSync(join(tmpdir(), 'agentwiki-guide-test-'));
    const env = { ...process.env, TMPDIR: root, TMP: root, TEMP: root };
    try {
      const first = JSON.parse(execFileSync(process.execPath, ['-e', bootstrap!], { encoding: 'utf8', env }));
      const second = JSON.parse(execFileSync(process.execPath, ['-e', bootstrap!], { encoding: 'utf8', env }));
      expect(first.node).toBe(process.execPath);
      expect(first.nodeVersion).toBe(process.version);
      expect(dirname(first.npmCache)).toBe(root);
      expect(first.npmCache).not.toBe(second.npmCache);
      if (process.platform !== 'win32') expect(statSync(first.npmCache).mode & 0o777).toBe(0o700);
      expect(prompt.indexOf('node -e')).toBeLessThan(prompt.indexOf('onboard start'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

it('rejects the WorkBuddy managed Node 22 before creating a cache or invoking npx', () => {
  const prompt = buildOnboardPrompt(false, 'workbuddy', 'https://wiki.example/api');
  const bootstrap = prompt.match(/^node -e "(.+)"$/m)?.[1];
  expect(bootstrap).toBeDefined();
  const root = mkdtempSync(join(tmpdir(), 'agentwiki-guide-test-'));
  try {
    const result = spawnSync(process.execPath, ['-e', `Object.defineProperty(process.versions, 'node', {value: '22.22.2'});${bootstrap}`], {
      encoding: 'utf8', env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Node.js 24 or 26');
    expect(readdirSync(root)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.skipIf(!hasZsh).each([true, false])('reuses the same WorkBuddy cache before the pinned package in every command (zh=%s)', zh => {
  const prompt = buildOnboardPrompt(zh, 'workbuddy', 'https://wiki.example/api');
  const commands = prompt.split('\n').filter(line => line.startsWith('npx '));
  expect(commands).toHaveLength(4);
  for (const command of commands) {
    const concrete = command.split('<absolute-npm-cache>').join('/tmp/agentwiki cache')
      .split('<sessionId>').join('session-123').split('<absolute-json-file>').join('/tmp/reply.json');
    const probe = `npx() { printf '%s\\0' "$@"; }\n${concrete}`;
    const args = execFileSync('zsh', ['-f', '-c', probe], { encoding: 'utf8' }).split('\0').slice(0, -1);
    expect(args.slice(0, 4)).toEqual(['--cache', '/tmp/agentwiki cache', '--yes', '@neomei/agentwiki-local-sync@0.13.4']);
    expect(args[4]).toBe('onboard');
  }
});
