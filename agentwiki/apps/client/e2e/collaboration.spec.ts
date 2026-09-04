import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';
import { resolveE2ETarget } from '../src/config/localTargets';

const apiBaseUrl = resolveE2ETarget({
  configured: process.env.AGENTWIKI_API_URL,
  fallback: 'http://127.0.0.1:3000/api/',
  allowRemote: process.env.ALLOW_REMOTE_E2E,
  confirmRemoteHost: process.env.CONFIRM_REMOTE_E2E_HOST,
  label: 'Playwright API target',
});

interface AuthAccount {
  access_token: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

interface CreatedResource {
  id: string;
}

interface Installation {
  code: string;
}

interface CollaborationRun {
  id: string;
  status: string;
}

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ownerEmail = `collaboration-owner-${suffix}@example.com`;
const ownerPassword = 'AgentWiki9Test';
const spaceName = `Collaboration browser QA ${suffix}`;
const agentName = `Collaboration Agent ${suffix}`;
const runName = `Browser collaboration run ${suffix}`;
const pauseReason = `Socket refresh proof ${suffix}`;

let api: APIRequestContext | undefined;
let owner: AuthAccount | undefined;
let spaceId = '';
let agentId = '';

const ownerHeaders = () => ({ Authorization: `Bearer ${owner?.access_token ?? ''}` });

const json = async <T,>(response: APIResponse, operation: string): Promise<T> => {
  const body = await response.text();
  expect(response.ok(), `${operation} failed (${response.status()}): ${body}`).toBeTruthy();
  return JSON.parse(body) as T;
};

const pathMatches = (url: string, expected: string) => new URL(url).pathname === expected;

const watchBrowserFailures = (page: Page) => {
  const consoleIssues: string[] = [];
  const pageErrors: string[] = [];
  const api5xx: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleIssues.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.startsWith('/api/') && response.status() >= 500) {
      api5xx.push(`${response.request().method()} ${response.url()} -> ${response.status()}`);
    }
  });

  return { consoleIssues, pageErrors, api5xx };
};

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({
    baseURL: `${apiBaseUrl.replace(/\/+$/u, '')}/`,
  });

  owner = await json<AuthAccount>(
    await api.post('auth/register', {
      data: { email: ownerEmail, password: ownerPassword, name: 'Collaboration Owner' },
    }),
    'register collaboration owner',
  );

  const space = await json<CreatedResource>(
    await api.post('spaces', {
      headers: ownerHeaders(),
      data: { name: spaceName, description: 'Temporary real collaboration browser fixture' },
    }),
    'create collaboration space',
  );
  spaceId = space.id;

  const agent = await json<CreatedResource>(
    await api.post('agents', {
      headers: ownerHeaders(),
      data: { name: agentName },
    }),
    'create collaboration Agent',
  );
  agentId = agent.id;

  const installation = await json<Installation>(
    await api.post(`agents/${agentId}/local-sync-installations`, {
      headers: ownerHeaders(),
      data: { spaceId, role: 'publisher', pluginVersion: '0.7.0' },
    }),
    'authorize collaboration Agent for the Space',
  );
  await json<unknown>(
    await api.post('integrations/local-sync/exchange', { data: { code: installation.code } }),
    'exchange Agent connection code',
  );
});

test.afterAll(async () => {
  if (!api) return;

  const cleanupFailures: string[] = [];
  const remove = async (path: string, label: string) => {
    try {
      const response = await api!.delete(path, { headers: ownerHeaders() });
      if (!response.ok()) {
        cleanupFailures.push(`${label} (${response.status()}): ${await response.text()}`);
      }
    } catch (error) {
      cleanupFailures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (spaceId) await remove(`spaces/${spaceId}`, 'delete collaboration Space fixture');
  if (owner?.user.id) await remove(`users/${owner.user.id}`, 'delete collaboration owner fixture');
  await api.dispose();

  expect(
    cleanupFailures,
    'collaboration fixture cleanup must fail closed instead of silently leaving data behind',
  ).toEqual([]);
});

test('owner starts a mapped collaboration run and receives an external API change over Socket', async ({ page }) => {
  test.setTimeout(90_000);
  expect(owner, 'owner fixture should exist').toBeDefined();
  expect(spaceId, 'Space fixture should exist').not.toBe('');
  expect(agentId, 'Agent fixture should exist').not.toBe('');

  const failures = watchBrowserFailures(page);
  let socketConnections = 0;
  let joinedRunFrames = 0;
  let receivedRunHintFrames = 0;
  let runGetResponses = 0;
  let startedRunId = '';

  page.on('websocket', (socket) => {
    if (!new URL(socket.url()).pathname.endsWith('/socket.io/')) return;
    socketConnections += 1;
    socket.on('framesent', ({ payload }) => {
      const frame = typeof payload === 'string' ? payload : payload.toString('utf8');
      if (frame.includes('joinCollaborationRun') && (!startedRunId || frame.includes(startedRunId))) {
        joinedRunFrames += 1;
      }
    });
    socket.on('framereceived', ({ payload }) => {
      const frame = typeof payload === 'string' ? payload : payload.toString('utf8');
      if (
        frame.includes('collaborationRunChanged')
        && (!startedRunId || frame.includes(startedRunId))
      ) {
        receivedRunHintFrames += 1;
      }
    });
  });
  page.on('response', (response) => {
    if (
      startedRunId
      && response.request().method() === 'GET'
      && pathMatches(
        response.url(),
        `/api/spaces/${spaceId}/collaboration/runs/${startedRunId}`,
      )
    ) {
      runGetResponses += 1;
    }
  });

  await page.addInitScript(() => {
    localStorage.setItem('agentwiki.language.v1', 'en');
  });
  const collaborationPath = `/spaces/${spaceId}/collaboration`;
  await page.goto(`/?intent=workspace&returnTo=${encodeURIComponent(collaborationPath)}#login`);
  await expect(page.getByRole('status')).toContainText('Sign in to enter the workspace.');
  await page.getByLabel('Email').fill(ownerEmail);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(ownerPassword);
  const loginResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST' && pathMatches(response.url(), '/api/auth/login')
  ));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.ok(), `owner login failed (${loginResponse.status()})`).toBeTruthy();

  await expect(page).toHaveURL(/\/dashboard$/u);
  await page.goto(collaborationPath);
  await expect(page).toHaveURL(new RegExp(`/spaces/${spaceId}/collaboration$`, 'u'));
  await expect(page.getByRole('heading', { name: 'Agent collaboration' })).toBeVisible();
  const codingTemplate = page.getByRole('article').filter({
    has: page.getByRole('heading', { name: 'Coding collaboration', exact: true }),
  });
  await expect(codingTemplate).toBeVisible();
  await codingTemplate.getByRole('link', { name: 'Start run' }).click();

  await expect(page.getByRole('heading', { name: '1. Work input' })).toBeVisible();
  await page.getByLabel('Run name').fill(runName);
  await page.getByLabel('项目目标 / Project brief').fill(
    'Verify the real owner-to-dashboard collaboration path with a connected Agent.',
  );
  await page.getByLabel('仓库引用 / Repository reference').fill('agentwiki/e2e-collaboration');
  const draftResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && pathMatches(response.url(), `/api/spaces/${spaceId}/collaboration/runs/drafts`)
  ));
  await page.getByRole('button', { name: 'Next' }).click();
  expect((await draftResponsePromise).ok(), 'draft creation should succeed').toBeTruthy();

  await expect(page.getByRole('heading', { name: '2. Map Agents' })).toBeVisible();
  const agentSelectors = page.getByRole('combobox');
  expect(await agentSelectors.count(), 'coding template should expose all six role slots').toBe(6);
  for (const selector of await agentSelectors.all()) await selector.selectOption(agentId);

  const validationResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/validate')
  ));
  await page.getByRole('button', { name: 'Next' }).click();
  const validationResponse = await validationResponsePromise;
  expect(validationResponse.ok(), `run validation failed (${validationResponse.status()})`).toBeTruthy();

  await expect(page.getByRole('heading', { name: '3. Review and start' })).toBeVisible();
  await page.getByLabel(
    'One Agent holds multiple roles around a human review. I understand the separation risk and want to start.',
  ).check();
  const startResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/start')
  ));
  await page.getByRole('button', { name: 'Start run' }).click();
  const startResponse = await startResponsePromise;
  expect(startResponse.ok(), `run start failed (${startResponse.status()})`).toBeTruthy();
  const startedRun = await startResponse.json() as CollaborationRun;
  expect(startedRun.status).toBe('running');
  startedRunId = startedRun.id;

  await expect(page.getByRole('heading', { name: 'Collaboration started' })).toBeVisible();
  await page.getByRole('link', { name: 'Open run dashboard' }).click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${spaceId}/collaboration/runs/${startedRunId}$`, 'u'));
  await expect(page.getByRole('heading', { name: 'Collaboration run', exact: true })).toBeVisible();
  const summary = page.getByTestId('dashboard-section-summary');
  await expect(summary.getByLabel('Running status')).toBeVisible();

  await expect.poll(
    () => socketConnections,
    { message: 'the dashboard should open a real Socket.IO WebSocket' },
  ).toBeGreaterThan(0);
  await expect.poll(
    () => joinedRunFrames,
    { message: 'the dashboard should join the newly-created collaboration run' },
  ).toBeGreaterThan(0);
  await expect.poll(
    () => receivedRunHintFrames,
    {
      message: 'the server should confirm the authorized run-room join with a refresh hint',
      timeout: 30_000,
    },
  ).toBeGreaterThan(0);
  await expect.poll(() => runGetResponses).toBeGreaterThan(0);
  const runHintsBeforeExternalPause = receivedRunHintFrames;
  const runGetsBeforeExternalPause = runGetResponses;

  const pauseResponse = await api!.post(
    `spaces/${spaceId}/collaboration/runs/${startedRunId}/actions/pause`,
    {
      headers: ownerHeaders(),
      data: { reason: pauseReason, idempotencyKey: `e2e-pause-${suffix}` },
    },
  );
  const pausedRun = await json<CollaborationRun>(pauseResponse, 'pause run outside the browser');
  expect(pausedRun.status).toBe('paused');

  await expect.poll(
    () => receivedRunHintFrames,
    { message: 'the external pause should publish a second Socket refresh hint', timeout: 30_000 },
  ).toBeGreaterThan(runHintsBeforeExternalPause);
  await expect.poll(
    () => runGetResponses,
    { message: 'the Socket event should trigger a browser-side run refresh without reloading' },
  ).toBeGreaterThan(runGetsBeforeExternalPause);
  await expect(summary.getByLabel('Paused status')).toBeVisible();
  await expect(summary).toContainText(pauseReason);

  expect(failures.consoleIssues, 'browser console should remain clean').toEqual([]);
  expect(failures.pageErrors, 'the browser page should not throw').toEqual([]);
  expect(failures.api5xx, 'browser API calls should not return 5xx').toEqual([]);
});
