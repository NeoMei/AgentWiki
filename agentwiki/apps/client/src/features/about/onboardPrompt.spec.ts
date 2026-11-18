import { execFileSync, spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { buildOnboardPrompt, ONBOARD_CLIENTS } from './onboardPrompt';

const hasZsh = spawnSync('zsh', ['--version']).status === 0;

it.each([true, false])('uses the prepared local runtime for every host and onboarding phase (zh=%s)', zh => {
  for (const { id } of ONBOARD_CLIENTS) {
    const client = id === 'generic' ? '<actual-client>' : id;
    const prompt = buildOnboardPrompt(zh, id, 'https://wiki.example/api');
    const url = `/onboard/runtime?client=${client}&packageVersion=0.13.6`;
    const commands = prompt.split('\n').filter(line => line.startsWith('<nodePath> <cliPath> onboard '));
    expect(commands).toHaveLength(4);
    expect(commands[0]).toContain(`--client ${client} --protocol json`);
    expect(commands[1]).toContain('onboard status --session');
    expect(commands[2]).toContain('onboard continue --session');
    expect(commands[3]).toContain('--reply-file');
    expect(prompt).toContain(url);
    expect(prompt.indexOf(url)).toBeLessThan(prompt.indexOf(commands[0]));
    expect(prompt).not.toContain('npx');
  }
});

it.skipIf(!hasZsh).each([
  'https://wiki.example/api',
  'http://[::1]:5198/api',
])('keeps the CLI path and server URL intact in zsh: %s', serverUrl => {
  const prompt = buildOnboardPrompt(false, 'generic', serverUrl);
  const cliPath = '/tmp/a path with spaces/dist/cli.js';
  const command = prompt.split('\n').find(line => line.startsWith('<nodePath> <cliPath> onboard '))!;
  // Intercept the Node invocation and inspect argv without running a package.
  const concrete = command.replace('<nodePath>', 'probe_node')
    .replace('<cliPath>', `'${cliPath}'`)
    .replace('<actual-client>', 'workbuddy');
  const probe = `probe_node() { printf '%s\\0' "$@"; }\n${concrete}`;
  const args = execFileSync('zsh', ['-f', '-c', probe], { encoding: 'utf8' }).split('\0').slice(0, -1);
  expect(args).toEqual([cliPath, 'onboard', 'start', '--server', serverUrl, '--client', 'workbuddy', '--protocol', 'json']);
});
