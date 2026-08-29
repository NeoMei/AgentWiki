import { expect, test, type APIRequestContext } from '@playwright/test';

const enabled = process.env.AGENTWIKI_LOCAL_SYNC_E2E === '1';
const apiUrl = (process.env.AGENTWIKI_API_URL ?? 'http://127.0.0.1:3000/api').replace(/\/$/u, '');
const browserApiUrl = new URL(apiUrl);

if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(browserApiUrl.hostname)) {
  throw new Error('Playwright local-sync E2E requires a loopback AGENTWIKI_API_URL');
}

interface Fixture {
  email: string;
  password: string;
  token: string;
  userId: string;
  spaceId: string;
  agentId: string;
}

async function requestJson<T>(request: APIRequestContext, path: string, init: {
  method?: 'POST' | 'PUT' | 'DELETE'; token?: string; data?: unknown;
} = {}): Promise<T> {
  const response = await request.fetch(`${apiUrl}${path}`, {
    method: init.method ?? 'POST',
    headers: init.token ? { Authorization: `Bearer ${init.token}` } : undefined,
    data: init.data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<T>;
}

test.describe('local sync enrollment card', () => {
  test.skip(!enabled, 'requires AGENTWIKI_LOCAL_SYNC_E2E=1 and a running local stack');

  let fixture: Fixture;

  test.beforeEach(async ({ request }) => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    fixture = {
      email: `local-sync-e2e-${suffix}@example.test`,
      password: 'LocalSyncE2E-password',
      token: '',
      userId: '',
      spaceId: '',
      agentId: '',
    };
    const registration = await requestJson<{ access_token: string; user: { id: string } }>(request, '/auth/register', {
      data: { email: fixture.email, password: fixture.password, name: `Local sync E2E ${suffix}` },
    });
    fixture.token = registration.access_token;
    fixture.userId = registration.user.id;
    const space = await requestJson<{ id: string }>(request, '/spaces', {
      token: fixture.token,
      data: { name: `Local sync E2E ${suffix}`, visibility: 'private', approvalPolicy: 'always-review' },
    });
    fixture.spaceId = space.id;
    const agent = await requestJson<{ id: string }>(request, '/agents', {
      token: fixture.token,
      data: { name: `Local sync E2E ${suffix}` },
    });
    fixture.agentId = agent.id;
  });

  test.afterEach(async ({ request }) => {
    if (fixture?.agentId) await requestJson(request, `/agents/${fixture.agentId}`, { method: 'DELETE', token: fixture.token }).catch(() => undefined);
    if (fixture?.spaceId) await requestJson(request, `/spaces/${fixture.spaceId}`, { method: 'DELETE', token: fixture.token }).catch(() => undefined);
    if (fixture?.userId) await requestJson(request, `/users/${fixture.userId}`, { method: 'DELETE', token: fixture.token }).catch(() => undefined);
  });

  test('logs in and generates, copies, and expires a one-shot instruction', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/?intent=workspace#login');
    await page.getByPlaceholder(/email|邮箱/i).fill(fixture.email);
    await page.getByPlaceholder(/password|密码/i).fill(fixture.password);
    await page.locator('form').getByRole('button', { name: /sign in|登录/i }).click();
    await page.waitForURL(/\/dashboard(?:$|[?#])/u);

    await page.goto(`/agents/${fixture.agentId}`);
    await page.getByRole('button', { name: /access|访问/i }).click();
    await page.locator('#local-sync-role').selectOption('editor');
    await page.getByRole('button', { name: /generate unified gateway instructions|生成统一网关接入指令/i }).click();

    const instructions = page.locator('pre');
    await expect(instructions).toContainText('@neomei/agentwiki-local-sync@0.6.1');
    await expect(instructions).toContainText('onboard --server');
    await expect(instructions).toContainText('--code AW-');
    await expect(instructions).not.toContainText('connect --server');
    await expect(instructions).toContainText('AW-');
    await expect(instructions).not.toContainText('agk_');
    await expect(instructions).not.toContainText('syncDeviceCredential');
    await expect(instructions).not.toContainText('human device credential');

    await page.getByRole('button', { name: /copy instructions|复制接入指令/i }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('@neomei/agentwiki-local-sync@0.6.1');
    await expect(page.getByText(/expires in|后过期/i)).toBeVisible();
  });
});
