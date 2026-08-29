import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { resolveE2ETarget } from '../src/config/localTargets';

const apiBaseUrl = resolveE2ETarget({
  configured: process.env.AGENTWIKI_API_URL,
  fallback: 'http://127.0.0.1:3000/api/',
  allowRemote: process.env.ALLOW_REMOTE_E2E,
  label: 'Playwright onboarding API target',
});

let api: APIRequestContext;
let token = '';
let user: { id: string; name: string; email: string };
let userCode = '';
let deviceCode = '';

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: `${apiBaseUrl.replace(/\/+$/u, '')}/` });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registration = await api.post('auth/register', {
    data: { email: `device-ui-${suffix}@example.com`, password: 'AgentWiki9Test', name: 'Device UI E2E' },
  });
  expect(registration.ok()).toBeTruthy();
  const auth = await registration.json();
  token = auth.access_token;
  user = auth.user;

  const started = await api.post('onboard/device/start', {
    data: { packageVersion: '0.7.0', clientType: 'codex', purpose: 'full-onboarding' },
  });
  expect(started.ok()).toBeTruthy();
  const session = await started.json();
  userCode = session.userCode;
  deviceCode = session.deviceCode;
});

test.afterAll(async () => {
  if (api && token && user?.id) {
    await api.delete(`users/${user.id}`, { headers: { Authorization: `Bearer ${token}` } });
  }
  await api?.dispose();
});

test('browser authorizes a device request and the token is issued once', async ({ page }) => {
  await page.goto(`/onboard/device?user_code=${encodeURIComponent(userCode)}`);
  await expect(page.getByRole('heading', { name: 'Authorize Agent connection' })).toBeVisible();
  await expect(page.getByText('Codex')).toBeVisible();
  await expect(page.getByText('0.7.0')).toBeVisible();
  const signIn = page.getByRole('link', { name: 'Sign in or register to authorize' });
  await expect(signIn).toHaveAttribute('href', new RegExp(`returnTo=.*${userCode}`));

  await page.addInitScript(({ authToken, authUser }) => {
    localStorage.setItem('token', authToken);
    localStorage.setItem('user', JSON.stringify(authUser));
    localStorage.setItem('agentwiki.language.v1', 'en');
  }, { authToken: token, authUser: user });
  await page.reload();
  await page.getByRole('button', { name: 'Authorize connection' }).click();
  await expect(page.getByText('This Agent is authorized to connect')).toBeVisible();

  const firstPoll = await api.post('onboard/device/poll', { data: { deviceCode } });
  expect(firstPoll.ok()).toBeTruthy();
  const first = await firstPoll.json();
  expect(first.status).toBe('authorized');
  expect(first.onboardingToken).toMatch(/^awo_/);

  const replayPoll = await api.post('onboard/device/poll', { data: { deviceCode } });
  expect(replayPoll.ok()).toBeTruthy();
  const replay = await replayPoll.json();
  expect(replay.status).toBe('authorization_consumed');
  expect(replay.onboardingToken).toBeUndefined();
});
