import { expect, it, vi } from 'vitest';
import { openAuthorizationBrowser } from './browser.js';

it.each([
  ['darwin', 'open', ['https://wiki.test/onboard?code=A&next=B']],
  ['win32', 'rundll32.exe', ['url.dll,FileProtocolHandler', 'https://wiki.test/onboard?code=A&next=B']],
  ['linux', 'xdg-open', ['https://wiki.test/onboard?code=A&next=B']],
] as const)('opens authorization on %s as a single URL argument without a shell', async (platform, command, args) => {
  const run = vi.fn(async () => undefined);
  expect(await openAuthorizationBrowser('https://wiki.test/onboard?code=A&next=B', platform, run)).toBe(true);
  expect(run).toHaveBeenCalledExactlyOnceWith(command, args);
});

it.each(['javascript:alert(1)', 'file:///etc/passwd', 'https://user:pass@wiki.test/auth', 'http://remote.test/auth'])('does not launch unsafe authorization URL %s', async (url) => {
  const run = vi.fn(async () => undefined);
  expect(await openAuthorizationBrowser(url, 'darwin', run)).toBe(false);
  expect(run).not.toHaveBeenCalled();
});

it('preserves loopback development and reports failed desktop launch', async () => {
  const run = vi.fn(async () => { throw new Error('desktop unavailable'); });
  expect(await openAuthorizationBrowser('http://127.0.0.1:5173/onboard', 'linux', run)).toBe(false);
  expect(run).toHaveBeenCalledExactlyOnceWith('xdg-open', ['http://127.0.0.1:5173/onboard']);
});
