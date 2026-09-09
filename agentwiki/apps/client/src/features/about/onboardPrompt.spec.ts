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
    expect(args).toEqual(['--yes','@neomei/agentwiki-local-sync@0.10.0','onboard','start','--server',serverUrl,'--client','codex','--protocol','json']);
  }
});
