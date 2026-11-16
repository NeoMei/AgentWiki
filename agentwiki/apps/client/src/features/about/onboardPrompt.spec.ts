import { execFileSync, spawnSync } from 'node:child_process';
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
    expect(args).toEqual(['--yes','@neomei/agentwiki-local-sync@0.13.6','onboard','start','--server',serverUrl,'--client','codex','--protocol','json']);
  }
});

it.skipIf(!hasZsh).each([true, false])('replaces the complete generic runner when the actual host is WorkBuddy (zh=%s)', zh => {
  const prompt = buildOnboardPrompt(zh, 'generic', 'https://wiki.example/api');
  const prefixMatch = prompt.match(/(?:完整前缀|entire prefix) `([^`]+)`/);
  expect(prefixMatch).not.toBeNull();
  const preparedRunner = 'npx --yes @neomei/agentwiki-local-sync@0.13.6';
  const commands = prompt.split('\n').filter(line => line.startsWith('npx '));
  expect(commands).toHaveLength(4);
  for (const command of commands) {
    const concrete = command.replace(prefixMatch![1], preparedRunner)
      .replace('<actual-client>', 'workbuddy')
      .replace('<sessionId>', 'session-123').replace('<absolute-json-file>', '/tmp/reply.json');
    const probe = `npx() { printf '%s\\0' "$@"; }\n${concrete}`;
    const args = execFileSync('zsh', ['-f', '-c', probe], { encoding: 'utf8' }).split('\0').slice(0, -1);
    expect(args.slice(0, 3)).toEqual(['--yes', '@neomei/agentwiki-local-sync@0.13.6', 'onboard']);
    expect(args.filter(arg => arg === '--yes')).toHaveLength(1);
    expect(args.filter(arg => arg.startsWith('@neomei/agentwiki-local-sync@'))).toHaveLength(1);
  }
});

it.skipIf(!hasZsh).each([true, false])('keeps WorkBuddy onboarding commands on the pinned package without a cache (zh=%s)', zh => {
  const prompt = buildOnboardPrompt(zh, 'workbuddy', 'https://wiki.example/api');
  const commands = prompt.split('\n').filter(line => line.startsWith('npx '));
  expect(commands).toHaveLength(4);
  for (const command of commands) {
    expect(command).not.toContain('--cache');
    const concrete = command.split('<sessionId>').join('session-123').split('<absolute-json-file>').join('/tmp/reply.json');
    const probe = `npx() { printf '%s\\0' "$@"; }\n${concrete}`;
    const args = execFileSync('zsh', ['-f', '-c', probe], { encoding: 'utf8' }).split('\0').slice(0, -1);
    expect(args.slice(0, 3)).toEqual(['--yes', '@neomei/agentwiki-local-sync@0.13.6', 'onboard']);
  }
});

it.each([true, false])('prepares WorkBuddy for a persisted local runtime instead of a cache (zh=%s)', zh => {
  const prompt = buildOnboardPrompt(zh, 'workbuddy', 'https://wiki.example/api');
  expect(prompt).not.toContain('node -e');
  expect(prompt).not.toContain('--cache');
  expect(prompt).not.toContain('NODE_OPTIONS');
  expect(prompt).toContain('.agentwiki/runtime');
  expect(prompt).toMatch(/npx/);
  expect(prompt.indexOf('.agentwiki/runtime')).toBeLessThan(prompt.indexOf('onboard start'));
});

it.each([true, false])('keeps other clients free of executable WorkBuddy preparation (zh=%s)', zh => {
  for (const client of ['generic', 'codex', 'claude', 'opencode'] as const) {
    const prompt = buildOnboardPrompt(zh, client, 'https://wiki.example/api');
    const codeBlocks = [...prompt.matchAll(/```sh\n([\s\S]*?)```/g)].map(match => match[1]);
    expect(codeBlocks).toHaveLength(4);
    for (const code of codeBlocks) {
      expect(code).not.toContain('node -e');
      expect(code).not.toContain('--cache');
      expect(code).not.toContain('--client workbuddy');
    }
  }
});

it.skipIf(!hasZsh).each([true, false])('requires the real host before the generic prompt can choose a client (zh=%s)', zh => {
  const prompt = buildOnboardPrompt(zh, 'generic', 'https://wiki.example/api');
  const command = prompt.split('\n').find(line => line.startsWith('npx '))!;
  expect(command).toContain('--client <actual-client>');
  expect(prompt).toContain('https://wiki.example/api/onboard/runtime?client=<actual-client>');
  expect(prompt.indexOf('/onboard/runtime?client=')).toBeLessThan(prompt.indexOf('onboard start'));
  for (const actualClient of ['codex', 'claude', 'opencode', 'workbuddy', 'generic']) {
    const concrete = command.replace('<actual-client>', actualClient);
    const probe = `npx() { printf '%s\\0' "$@"; }\n${concrete}`;
    const args = execFileSync('zsh', ['-f', '-c', probe], { encoding: 'utf8' }).split('\0').slice(0, -1);
    expect(args.slice(-4)).toEqual(['--client', actualClient, '--protocol', 'json']);
  }
});
