import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveE2ETarget } from '../src/config/localTargets';

const apiBaseUrl = resolveE2ETarget({
  configured: process.env.AGENTWIKI_API_URL,
  fallback: 'http://127.0.0.1:3000/api/',
  allowRemote: process.env.ALLOW_REMOTE_E2E,
  label: 'Playwright Markdown API target',
});

interface AuthAccount {
  access_token: string;
  user: { id: string; name: string; email: string };
}

interface PersistedPage {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

interface PageVersion {
  id: string;
  content: string;
}

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const artifacts = path.join(os.tmpdir(), 'agentwiki-markdown-core-qa', runId);
const pageTitle = `Markdown Acceptance ${runId}`;
const externalProbeHost = 'markdown-rich-rendering.invalid';
const overLimitMermaidSource = 'x'.repeat(20_001);
const source = `# ${pageTitle}

## Template checklist
- [ ] Owner persisted task
- [x] Template completed task

> [!note]+ Browser acceptance
> Callout body stays visible.

==Highlighted delivery==

## Rich rendering fixture

Inline math: $e^{i\\pi}+1=0$.

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

Invalid math before $\\notARealCommand{$ after invalid math.

\`\`\`mermaid
flowchart LR
  A["Start"] --> B["A deliberately wide diagram node with enough text to exercise responsive containment"]
  B --> C["Sanitized finish"]
  click A "https://${externalProbeHost}/collect" "disabled external click"
\`\`\`

\`\`\`mermaid
flowchart TD
  Broken -->
\`\`\`

\`\`\`mermaid
${overLimitMermaidSource}
\`\`\`

<script id="raw-html-script">window.__agentwikiRawHtmlExecuted = true</script>
<img id="raw-html-image" src="https://${externalProbeHost}/pixel.png" onerror="window.__agentwikiRawHtmlExecuted = true">

## Deep Heading

[[${pageTitle}|Acceptance alias]]
[[${pageTitle}#Deep Heading]]
[[${pageTitle}#^acceptance-block]]

Anchored statement ^acceptance-block

\`\`\`md
- [ ] fake code task
[[${pageTitle}|Literal alias]]
==literal highlight==
\`\`\`

| Planning owner | Delivery status | Verification evidence | Follow-up owner | Target date | Extended notes |
| --- | --- | --- | --- | --- | --- |
| Documentation | Accepted | Browser and API evidence | Markdown team | 2026-08-26 | This deliberately wide table must scroll inside the Markdown surface instead of widening the document. |
`;

let api: APIRequestContext;
let owner: AuthAccount | undefined;
let editor: AuthAccount | undefined;
let viewer: AuthAccount | undefined;
let spaceId = '';
let pageId = '';
let consoleIssues: string[] = [];

const json = async <T,>(response: APIResponse, operation: string): Promise<T> => {
  const body = await response.text();
  expect(response.ok(), `${operation} failed (${response.status()}): ${body}`).toBeTruthy();
  return JSON.parse(body) as T;
};

const register = async (role: string): Promise<AuthAccount> => json<AuthAccount>(
  await api.post('auth/register', {
    data: {
      email: `${role}-${runId}@markdown-core.test`,
      password: 'AgentWiki9Test',
      name: `Markdown ${role}`,
    },
  }),
  `register ${role}`,
);

const ownerHeaders = () => ({ Authorization: `Bearer ${owner?.access_token ?? ''}` });

const watchConsole = (page: Page) => {
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      consoleIssues.push(`${message.type()}: ${message.text()}`);
    }
  });
};

const watchExternalRequests = (page: Page) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      externalRequests.push(request.url());
    }
  });
  return externalRequests;
};

const authenticate = async (page: Page, account: AuthAccount) => {
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('agentwiki.language.v1', 'en');
  }, { token: account.access_token, user: account.user });
};

const newAuthenticatedPage = async (browser: Browser, account: AuthAccount) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  watchConsole(page);
  const externalRequests = watchExternalRequests(page);
  await authenticate(page, account);
  return { context, page, externalRequests };
};

const findMarkdownRoot = (scope: Page | Locator) => scope.locator('.katex').first().locator(
  'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " prose-sm ")][1]',
);

const expectRichRendering = async (scope: Page | Locator) => {
  const root = findMarkdownRoot(scope);
  await expect(root.locator('.katex')).toHaveCount(2);
  await expect(root.locator('.katex-mathml math')).toHaveCount(2);
  await expect(root.locator('[data-mermaid-state="ready"] svg')).toHaveCount(1);
  await expect(root.locator('.katex-error, [data-mermaid-state="error"]')).toHaveCount(3);
  await expect(root.locator('.katex-error')).toContainText('\\notARealCommand{');

  const invalidMermaid = root.locator('[data-mermaid-state="error"]').filter({
    hasText: 'The Mermaid diagram could not be rendered. Its source is shown below.',
  });
  await expect(invalidMermaid.locator('code')).toContainText('Broken -->');

  const overLimitMermaid = root.locator('[data-mermaid-state="error"]').filter({
    hasText: 'The Mermaid diagram exceeds the 20,000 character limit. Its source is shown below.',
  });
  await expect(overLimitMermaid.locator('code')).toContainText('x'.repeat(80));

  await expect(root.locator('#raw-html-script, #raw-html-image')).toHaveCount(0);
  await expect(root.locator('script, iframe, object, embed, foreignObject')).toHaveCount(0);
  await expect(root.locator('[data-mermaid-state="ready"] svg a[href], [data-mermaid-state="ready"] svg a[xlink\\:href]')).toHaveCount(0);

  const unsafeAttributes = await root.locator('*').evaluateAll((elements) => elements.flatMap((element) => (
    [...element.attributes]
      .filter((attribute) => (
        /^on/iu.test(attribute.name)
        || (
          !/^xmlns(?::|$)/iu.test(attribute.name)
          && /(?:javascript:|data:text\/html|https?:\/\/|\/\/)/iu.test(attribute.value)
        )
      ))
      .map((attribute) => `${element.tagName.toLowerCase()}.${attribute.name}=${attribute.value}`)
  )));
  expect(unsafeAttributes).toEqual([]);
  return root;
};

const expectNoDocumentOverflow = async (page: Page) => {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll<HTMLElement>('body *')]
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === 'string' ? element.className : '',
        right: Math.round(element.getBoundingClientRect().right),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }))
      .filter((element) => element.right > document.documentElement.clientWidth + 1)
      .slice(0, 8),
  }));
  expect(dimensions.scrollWidth, JSON.stringify(dimensions.offenders, null, 2)).toBe(dimensions.clientWidth);
};

test.describe.serial('Markdown core browser acceptance', () => {
  test.beforeEach(() => {
    consoleIssues = [];
  });

  test.afterEach(() => {
    expect(consoleIssues).toEqual([]);
  });

  test.beforeAll(async () => {
    await mkdir(artifacts, { recursive: true });
    api = await playwrightRequest.newContext({
      baseURL: `${apiBaseUrl.replace(/\/+$/u, '')}/`,
    });

    owner = await register('owner');
    editor = await register('editor');
    viewer = await register('viewer');

    const space = await json<{ id: string }>(await api.post('spaces', {
      headers: ownerHeaders(),
      data: {
        name: `Markdown Core QA ${runId}`,
        description: 'Disposable Markdown browser acceptance',
      },
    }), 'create Space');
    spaceId = space.id;

    for (const [account, role] of [[editor, 'editor'], [viewer, 'viewer']] as const) {
      await json(await api.post(`spaces/${spaceId}/members`, {
        headers: ownerHeaders(),
        data: { email: account.user.email, role },
      }), `add ${role}`);
    }

    const created = await json<PersistedPage>(await api.post('pages', {
      headers: ownerHeaders(),
      data: { spaceId, title: pageTitle, content: source },
    }), 'create Markdown page');
    pageId = created.id;
  });

  test.afterAll(async () => {
    if (!api) return;
    const cleanupFailures: string[] = [];
    const remove = async (resource: string, headers: Record<string, string>) => {
      try {
        const response = await api.delete(resource, { headers });
        if (!response.ok()) {
          cleanupFailures.push(`${resource}: ${response.status()} ${await response.text()}`);
        }
      } catch (error) {
        cleanupFailures.push(`${resource}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    try {
      if (owner?.access_token && spaceId) await remove(`spaces/${spaceId}`, ownerHeaders());
    } finally {
      for (const account of [viewer, editor, owner]) {
        if (account?.access_token && account.user.id) {
          await remove(`users/${account.user.id}`, {
            Authorization: `Bearer ${account.access_token}`,
          });
        }
      }
      await api.dispose();
    }
    expect(cleanupFailures).toEqual([]);
  });

  test('persists editable checklists while preserving read-only, literal-code and mobile contracts', async ({ browser }) => {
    test.setTimeout(120_000);
    const contexts = [];
    try {
      const ownerSession = await newAuthenticatedPage(browser, owner!);
      contexts.push(ownerSession.context);
      const ownerPage = ownerSession.page;
      await ownerPage.goto(`/pages/${pageId}`);

      await expect(ownerPage.locator('[data-callout="note"]')).toContainText('Browser acceptance');
      await expect(ownerPage.locator('mark')).toHaveText('Highlighted delivery');
      await expect(ownerPage.getByRole('link', { name: 'Acceptance alias' })).toHaveAttribute('href', `/pages/${pageId}`);
      await expect(ownerPage.getByRole('link', { name: `${pageTitle}#Deep Heading` })).toHaveAttribute('href', `/pages/${pageId}#deep-heading`);
      await expect(ownerPage.getByRole('link', { name: `${pageTitle}#^acceptance-block` })).toHaveAttribute('href', `/pages/${pageId}#%5Eacceptance-block`);
      await expect(ownerPage.locator('[id="^acceptance-block"]')).toHaveCount(1);
      await expect(ownerPage.locator('pre code.language-md')).toContainText('- [ ] fake code task');
      await expect(ownerPage.getByRole('checkbox')).toHaveCount(2);
      const ownerMarkdown = await expectRichRendering(ownerPage);
      await expectNoDocumentOverflow(ownerPage);
      const pageUrlBeforeMermaidClick = ownerPage.url();
      await ownerMarkdown.locator('[data-mermaid-state="ready"] svg').getByText('Start', { exact: true }).click();
      await expect(ownerPage).toHaveURL(pageUrlBeforeMermaidClick);
      expect(ownerSession.externalRequests).toEqual([]);

      await ownerPage.goto(`/pages/${pageId}/edit`);
      await ownerPage.getByRole('button', { name: 'Preview', exact: true }).click();
      await expect(ownerPage.getByTestId('md-preview')).toBeVisible();
      await expectRichRendering(ownerPage.getByTestId('md-preview'));
      await expectNoDocumentOverflow(ownerPage);
      expect(ownerSession.externalRequests).toEqual([]);

      await ownerPage.goto(`/pages/${pageId}`);

      const versionsBeforeToggle = await json<PageVersion[]>(
        await api.get(`pages/${pageId}/versions`, { headers: ownerHeaders() }),
        'read PageVersions before checklist toggle',
      );
      const versionIdsBeforeToggle = new Set(versionsBeforeToggle.map((version) => version.id));
      const ownerCheckbox = ownerPage.getByRole('checkbox').first();
      await expect(ownerCheckbox).toBeEnabled();
      await ownerCheckbox.click();
      await expect(ownerCheckbox).toBeChecked();
      await expect(ownerCheckbox).toBeEnabled();
      await ownerPage.reload();
      await expect(ownerPage.getByRole('checkbox').first()).toBeChecked();
      await ownerPage.screenshot({ path: path.join(artifacts, 'owner-persisted.png'), fullPage: true });

      const [persisted, versions] = await Promise.all([
        json<PersistedPage>(await api.get(`pages/${pageId}`, { headers: ownerHeaders() }), 'read persisted page'),
        json<PageVersion[]>(await api.get(`pages/${pageId}/versions`, { headers: ownerHeaders() }), 'read PageVersions'),
      ]);
      expect(persisted.content).toContain('- [x] Owner persisted task');
      expect(versions).toHaveLength(versionsBeforeToggle.length + 1);
      const versionsCreatedByToggle = versions.filter((version) => !versionIdsBeforeToggle.has(version.id));
      expect(versionsCreatedByToggle).toHaveLength(1);
      const [toggleVersion] = versionsCreatedByToggle;
      expect(toggleVersion.content).toContain('- [ ] Owner persisted task');
      const toggleVersionIndex = versions.findIndex((version) => version.id === toggleVersion.id);
      expect(toggleVersionIndex).toBeGreaterThanOrEqual(0);
      const toggleVersionNumber = versions.length - toggleVersionIndex;

      const editorSession = await newAuthenticatedPage(browser, editor!);
      contexts.push(editorSession.context);
      await editorSession.page.goto(`/pages/${pageId}`);
      await expect(editorSession.page.getByRole('checkbox').first()).toBeEnabled();

      const viewerSession = await newAuthenticatedPage(browser, viewer!);
      contexts.push(viewerSession.context);
      const viewerPage = viewerSession.page;
      await viewerPage.goto(`/pages/${pageId}`);
      await expect(viewerPage.getByRole('checkbox')).toHaveCount(2);
      for (const checkbox of await viewerPage.getByRole('checkbox').all()) await expect(checkbox).toBeDisabled();
      await viewerPage.screenshot({ path: path.join(artifacts, 'viewer-read-only.png'), fullPage: true });

      await ownerPage.goto(`/pages/${pageId}/versions`);
      await ownerPage.getByRole('button', { name: `Preview v${toggleVersionNumber}` }).click();
      const versionDialog = ownerPage.getByRole('dialog', { name: `Preview v${toggleVersionNumber}` });
      await expect(versionDialog).toBeVisible();
      const historicalCheckboxes = versionDialog.getByRole('checkbox');
      await expect(historicalCheckboxes).toHaveCount(2);
      for (const checkbox of await historicalCheckboxes.all()) await expect(checkbox).toBeDisabled();
      await expect(versionDialog.locator('pre code.language-md')).toContainText('- [ ] fake code task');
      await expectRichRendering(versionDialog);

      await viewerPage.setViewportSize({ width: 390, height: 844 });
      await viewerPage.reload();
      await expect(viewerPage.getByRole('heading', { name: pageTitle, exact: true }).first()).toBeVisible();
      await expect(viewerPage.locator('table')).toBeVisible();
      await expectRichRendering(viewerPage);
      await expectNoDocumentOverflow(viewerPage);
      expect(viewerSession.externalRequests).toEqual([]);
      await viewerPage.screenshot({ path: path.join(artifacts, 'mobile-390.png'), fullPage: true });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});
