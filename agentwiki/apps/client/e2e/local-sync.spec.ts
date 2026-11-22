import { expect, test, type APIRequestContext } from '@playwright/test';
import { expectPinnedRuntimePreparation, localSyncPackage } from './fixtures/local-sync-runtime';

const enabled = process.env.AGENTWIKI_LOCAL_SYNC_E2E === '1';
const apiUrl = (process.env.AGENTWIKI_API_URL ?? 'http://127.0.0.1:3000/api').replace(/\/$/u, '');
const browserApiUrl = new URL(apiUrl);

if (enabled && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(browserApiUrl.hostname)) {
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

async function cleanupFixture(request: APIRequestContext, fixture: Fixture | undefined) {
  if (!fixture) return;
  const failures: string[] = [];
  for (const [kind, id, path] of [
    ['agent', fixture.agentId, `/agents/${fixture.agentId}`],
    ['space', fixture.spaceId, `/spaces/${fixture.spaceId}`],
    ['user', fixture.userId, `/users/${fixture.userId}`],
  ]) {
    if (!id) continue;
    try {
      await requestJson(request, path, { method: 'DELETE', token: fixture.token });
    } catch {
      failures.push(kind);
    }
  }
  if (failures.length > 0) throw new Error(`Cleanup failed for ${failures.join(', ')}`);
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
      data: { email: fixture.email, password: fixture.password, name: `LocalSyncE2E-${suffix}` },
    });
    fixture.token = registration.access_token;
    fixture.userId = registration.user.id;
    const space = await requestJson<{ id: string }>(request, '/spaces', {
      token: fixture.token,
      data: { name: `Local sync E2E ${suffix.slice(-8)}`, visibility: 'private', approvalPolicy: 'always-review' },
    });
    fixture.spaceId = space.id;
    const agent = await requestJson<{ id: string }>(request, '/agents', {
      token: fixture.token,
      data: { name: `Local sync E2E ${suffix}` },
    });
    fixture.agentId = agent.id;
  });

  test.afterEach(async ({ request }) => {
    await cleanupFixture(request, fixture);
  });

  test('logs in and generates, copies, and shows expiry for a one-shot instruction', async ({ page, request }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/?intent=workspace#login');
    await page.getByPlaceholder(/email|邮箱/i).fill(fixture.email);
    await page.getByPlaceholder(/password|密码/i).fill(fixture.password);
    await page.locator('form').getByRole('button', { name: /sign in|登录/i }).click();
    await page.waitForURL(/\/dashboard(?:$|[?#])/u);

    await page.goto(`/agents/${fixture.agentId}`);
    await page.getByRole('button', { name: /access|访问/i }).click();
    await page.locator('#local-sync-role').selectOption('editor');
    const installationResponse = page.waitForResponse(response =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/agents/${fixture.agentId}/local-sync-installations`);
    await page.getByRole('button', { name: /generate unified gateway instructions|生成统一网关接入指令/i }).click();
    const installation = await installationResponse;
    expect(installation.ok()).toBe(true);
    const { code, expiresAt } = await installation.json() as { code: string; expiresAt: string };
    expect(/^AW-[A-Z0-9-]{24}$/u.test(code)).toBe(true);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());

    const instructions = page.locator('pre');
    await expect(instructions).toBeVisible();
    const apiOrigin = new URL('/api', page.url()).href;
    const displayed = await instructions.innerText();
    expect(displayed).toContain(`Agent ID "${fixture.agentId}" and Space ID "${fixture.spaceId}"`);
    expect(displayed).toContain(`${apiOrigin}/onboard/runtime?client=<host-client>&packageVersion=${localSyncPackage.version}`);
    expect(displayed.split('\n').includes(
      `<nodePath> <cliPath> onboard --server ${apiOrigin} --code ${code} --protocol ndjson --agent <host-client>`,
    )).toBe(true);
    expect(displayed).not.toMatch(/^\s*(?:npx|npm exec)\b/mu);
    await expect(instructions).not.toContainText('connect --server');
    await expect(instructions).not.toContainText('agk_');
    await expect(instructions).not.toContainText('syncDeviceCredential');
    await expect(instructions).not.toContainText('human device credential');

    await page.getByRole('button', { name: /copy instructions|复制接入指令/i }).click();
    await expect.poll(async () => await page.evaluate(() => navigator.clipboard.readText()) === displayed).toBe(true);
    await expect(page.getByText(/expires in|后过期/i)).toBeVisible();
    await expectPinnedRuntimePreparation(request, apiOrigin);
  });
});
