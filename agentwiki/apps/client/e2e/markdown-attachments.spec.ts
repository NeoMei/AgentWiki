import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveE2ETarget } from '../src/config/localTargets';

const apiBaseUrl = resolveE2ETarget({
  configured: process.env.AGENTWIKI_API_URL,
  fallback: 'http://127.0.0.1:3000/api/',
  allowRemote: process.env.ALLOW_REMOTE_E2E,
  label: 'Playwright Markdown attachment API target',
});

interface AuthAccount {
  access_token: string;
  user: { id: string; name: string; email: string };
}

interface PersistedPage {
  id: string;
  spaceId: string;
  title: string;
  content: string;
  updatedAt: string;
}

interface AttachmentSummary {
  id: string;
  displayName: string;
  status: 'active' | 'archived';
  updatedAt: string;
}

interface AttachmentList {
  items: AttachmentSummary[];
  total: number;
}

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const artifacts = path.join(os.tmpdir(), 'agentwiki-markdown-attachments-qa', runId);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const alternatePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3GAAAAAASUVORK5CYII=',
  'base64',
);

let api: APIRequestContext;
let owner: AuthAccount;
let editor: AuthAccount;
let viewer: AuthAccount;
let outsider: AuthAccount;
let primarySpaceId = '';
let hiddenSpaceId = '';
let editorPage: PersistedPage;
let targetPage: PersistedPage;
let anchorPage: PersistedPage;
let asyncHeadingPage: PersistedPage;
let cyclePage: PersistedPage;
let depthPage: PersistedPage;
let countPage: PersistedPage;
let characterPage: PersistedPage;
let versionEmbedPage: PersistedPage;
let hiddenPage: PersistedPage;
let consoleIssues: string[] = [];
let consoleMessages: string[] = [];
let credentialSurfaces: string[] = [];
let unexpectedExternalRequests: string[] = [];
const activeBrowserContexts = new Set<BrowserContext>();
let sameNameAttachment: AttachmentSummary;

const json = async <T,>(response: APIResponse, operation: string): Promise<T> => {
  const body = await response.text();
  expect(response.ok(), `${operation} failed (${response.status()}): ${body}`).toBeTruthy();
  return JSON.parse(body) as T;
};

const headers = (account: AuthAccount) => ({ Authorization: `Bearer ${account.access_token}` });

const register = async (role: string): Promise<AuthAccount> => json<AuthAccount>(
  await api.post('auth/register', {
    data: {
      email: `${role}-${runId}@markdown-attachments.test`,
      password: 'AgentWiki9Test',
      name: `Attachment ${role}`,
    },
  }),
  `register ${role}`,
);

const createPage = async (spaceId: string, title: string, content: string) => json<PersistedPage>(
  await api.post('pages', {
    headers: headers(owner),
    data: { spaceId, title, content, format: 'markdown' },
  }),
  `create page ${title}`,
);

const updatePage = async (page: PersistedPage, content: string) => json<PersistedPage>(
  await api.patch(`pages/${page.id}`, {
    headers: headers(owner),
    data: { content, expectedUpdatedAt: page.updatedAt },
  }),
  `update page ${page.title}`,
);

const uploadByApi = async (account: AuthAccount, spaceId: string, name: string) => json<AttachmentSummary>(
  await api.post(`spaces/${spaceId}/attachments`, {
    headers: headers(account),
    multipart: { file: { name, mimeType: 'image/png', buffer: png } },
  }),
  `upload ${name}`,
);

const watchPage = (page: Page) => {
  const externalRequests: string[] = [];
  page.on('console', (message) => {
    consoleMessages.push(`${message.type()}: ${message.text()}`);
    if (message.type() === 'warning' || message.type() === 'error') {
      consoleIssues.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.protocol !== 'blob:'
      && url.protocol !== 'data:'
      && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    ) {
      externalRequests.push(request.url());
      unexpectedExternalRequests.push(request.url());
    }
  });
  return externalRequests;
};

const recordCredentialSurface = async (page: Page) => {
  const surface = await page.evaluate(() => ({
    document: document.documentElement.outerHTML,
    visibleText: document.body.innerText,
    currentUrl: window.location.href,
    imageUrls: [...document.images].map((image) => image.currentSrc || image.src),
    resourceUrls: performance.getEntriesByType('resource').map((entry) => entry.name),
  }));
  credentialSurfaces.push(JSON.stringify(surface));
};

const expectNoCredentialLeakIn = (inspected: string[]) => {
  const findings: string[] = [];
  for (const account of [owner, editor, viewer, outsider]) {
    if (!account?.access_token) continue;
    for (const value of inspected) {
      if (value.includes(account.access_token)) findings.push(`${account.user.email}: raw access token`);
      if (value.includes(`Bearer ${account.access_token}`)) findings.push(`${account.user.email}: Bearer token`);
    }
  }
  expect(findings).toEqual([]);
};

const authenticate = async (page: Page, account: AuthAccount) => {
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('agentwiki.language.v1', 'en');
  }, { token: account.access_token, user: account.user });
};

const authenticatedPage = async (
  browser: Browser,
  account: AuthAccount,
  closeTimeConsoleFixtures: Array<{ type: 'log' | 'info' | 'debug'; text: string }> = [],
  closeTimeConsoleSink = consoleMessages,
) => {
  const context = await browser.newContext();
  activeBrowserContexts.add(context);
  context.once('close', () => {
    for (const fixture of closeTimeConsoleFixtures) {
      closeTimeConsoleSink.push(`${fixture.type}: ${fixture.text}`);
    }
    activeBrowserContexts.delete(context);
  });
  const page = await context.newPage();
  const externalRequests = watchPage(page);
  await authenticate(page, account);
  return { context, page, externalRequests };
};

const expectNoDocumentOverflow = async (page: Page) => {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
};

const dispatchImageTransfer = async (
  page: Page,
  kind: 'paste' | 'drop',
  name: string,
) => {
  const content = page.locator('.cm-content[contenteditable="true"]');
  await expect(content).toBeVisible();
  await content.click();
  await page.keyboard.press('Meta+End');
  await page.evaluate(({ eventKind, fileName, bytes }) => {
    const binary = atob(bytes);
    const data = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index);
    const transfer = new DataTransfer();
    transfer.items.add(new File([data], fileName, { type: 'image/png' }));
    const editor = document.querySelector<HTMLElement>('.cm-content[contenteditable="true"]');
    if (!editor) throw new Error('CodeMirror content is unavailable');
    if (eventKind === 'paste') {
      editor.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }));
      return;
    }
    const line = editor.querySelector<HTMLElement>('.cm-line:last-child') ?? editor;
    const box = line.getBoundingClientRect();
    const clientX = Math.max(box.left + 1, box.right - 1);
    const clientY = box.top + Math.max(1, box.height / 2);
    const target = document.elementFromPoint(clientX, clientY) ?? line;
    target.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX,
      clientY,
    }));
  }, { eventKind: kind, fileName: name, bytes: png.toString('base64') });
};

const expectMarker = async (page: Page, marker: string) => {
  await expect.poll(async () => page.locator('.cm-content').innerText()).toContain(marker);
};

const cleanupFixtures = async () => {
  const cleanupFailures: string[] = [];
  const remove = async (resource: string, account: AuthAccount) => {
    try {
      const response = await api.delete(resource, { headers: headers(account) });
      if (!response.ok()) cleanupFailures.push(`${resource}: ${response.status()} ${await response.text()}`);
    } catch (error) {
      cleanupFailures.push(`${resource}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  try {
    if (primarySpaceId && owner?.access_token) {
      try {
        const listed = await json<AttachmentList>(await api.get(
          `spaces/${primarySpaceId}/attachments?status=active&skip=0&take=100`,
          { headers: headers(owner) },
        ), 'list attachments for cleanup');
        for (const attachment of listed.items) {
          const response = await api.post(
            `spaces/${primarySpaceId}/attachments/${attachment.id}/archive`,
            { headers: headers(owner), data: { expectedUpdatedAt: attachment.updatedAt } },
          );
          if (!response.ok()) cleanupFailures.push(`archive ${attachment.id}: ${response.status()} ${await response.text()}`);
        }
      } catch (error) {
        cleanupFailures.push(`attachment cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (primarySpaceId) await remove(`spaces/${primarySpaceId}`, owner);
    if (hiddenSpaceId) await remove(`spaces/${hiddenSpaceId}`, owner);
  } finally {
    for (const account of [viewer, editor, outsider, owner]) {
      if (account?.access_token && account.user.id) await remove(`users/${account.user.id}`, account);
    }
    await api.dispose();
    await rm(artifacts, { recursive: true, force: true });
  }
  expect(cleanupFailures).toEqual([]);
};

test.describe.serial('Markdown attachments and embeds browser acceptance', () => {
  test.beforeEach(() => {
    consoleIssues = [];
    consoleMessages = [];
    credentialSurfaces = [];
    unexpectedExternalRequests = [];
  });

  test.afterEach(async () => {
    await Promise.all([...activeBrowserContexts].map((context) => context.close()));
    expect(activeBrowserContexts.size).toBe(0);
    expect(consoleIssues).toEqual([]);
    expect(unexpectedExternalRequests).toEqual([]);
    expectNoCredentialLeakIn([...credentialSurfaces, ...consoleMessages]);
  });

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    await mkdir(artifacts, { recursive: true });
    api = await playwrightRequest.newContext({ baseURL: `${apiBaseUrl.replace(/\/+$/u, '')}/` });
    owner = await register('owner');
    editor = await register('editor');
    viewer = await register('viewer');
    outsider = await register('outsider');

    const primary = await json<{ id: string }>(await api.post('spaces', {
      headers: headers(owner),
      data: { name: `Attachment QA ${runId}`, description: 'Disposable browser acceptance' },
    }), 'create primary Space');
    primarySpaceId = primary.id;
    const hidden = await json<{ id: string }>(await api.post('spaces', {
      headers: headers(owner),
      data: { name: `Hidden Attachment QA ${runId}`, description: 'Cross-Space scope fixture' },
    }), 'create hidden Space');
    hiddenSpaceId = hidden.id;

    for (const [account, role] of [[editor, 'editor'], [viewer, 'viewer']] as const) {
      await json(await api.post(`spaces/${primarySpaceId}/members`, {
        headers: headers(owner),
        data: { email: account.user.email, role },
      }), `add ${role}`);
    }

    const targetTitle = `Embed Target ${runId}`;
    targetPage = await createPage(primarySpaceId, targetTitle, '# Section\n\nInitial target content.\n\n## Later\n\nLater target content.');
    hiddenPage = await createPage(hiddenSpaceId, `Hidden Target ${runId}`, '# Private\n\nHidden cross-Space content.');
    editorPage = await createPage(primarySpaceId, `Attachment Editor ${runId}`, '# Attachment editor\n\n');
    anchorPage = await createPage(primarySpaceId, `Anchor Root ${runId}`, `# Anchor root\n\n## Root Heading\n\nRoot block ^root-block\n\n[[${targetTitle}|Same-Space target]]\n\n![[${targetTitle}]]`);
    asyncHeadingPage = await createPage(primarySpaceId, `Async Heading Root ${runId}`, `# Async root\n\n![[${targetTitle}#Later]]`);

    let cycleA = await createPage(primarySpaceId, `Cycle A ${runId}`, '# Cycle A\n\nPending');
    const cycleB = await createPage(primarySpaceId, `Cycle B ${runId}`, `# Cycle B\n\n![[${cycleA.title}]]`);
    cycleA = await updatePage(cycleA, `# Cycle A\n\n![[${cycleB.title}]]`);
    cyclePage = cycleA;

    const depth5 = await createPage(primarySpaceId, `Depth 5 ${runId}`, '# Depth five');
    const depth4 = await createPage(primarySpaceId, `Depth 4 ${runId}`, `# Depth four\n\n![[${depth5.title}]]`);
    const depth3 = await createPage(primarySpaceId, `Depth 3 ${runId}`, `# Depth three\n\n![[${depth4.title}]]`);
    const depth2 = await createPage(primarySpaceId, `Depth 2 ${runId}`, `# Depth two\n\n![[${depth3.title}]]`);
    depthPage = await createPage(primarySpaceId, `Depth 1 ${runId}`, `# Depth one\n\n![[${depth2.title}]]`);

    const countTarget = await createPage(primarySpaceId, `Count Target ${runId}`, 'Count body.');
    countPage = await createPage(
      primarySpaceId,
      `Count Root ${runId}`,
      `# Count root\n\n${Array.from({ length: 21 }, () => `![[${countTarget.title}]]`).join('\n\n')}`,
    );
    const characterTargetA = await createPage(primarySpaceId, `Character Target A ${runId}`, `# Large A\n\n${'x'.repeat(100_001)}`);
    const characterTargetB = await createPage(primarySpaceId, `Character Target B ${runId}`, `# Large B\n\n${'y'.repeat(100_001)}`);
    characterPage = await createPage(
      primarySpaceId,
      `Character Root ${runId}`,
      `# Character root\n\n![[${characterTargetA.title}]]\n\n![[${characterTargetB.title}]]`,
    );

    versionEmbedPage = await createPage(primarySpaceId, `Version Embed ${runId}`, `# Version embed\n\n![[${targetTitle}#Section]]`);
    versionEmbedPage = await updatePage(versionEmbedPage, `${versionEmbedPage.content}\n\nCurrent root revision.`);
    sameNameAttachment = await uploadByApi(owner, primarySpaceId, 'same-name.png');
    anchorPage = await updatePage(
      anchorPage,
      `${anchorPage.content}\n\n![[same-name.png]]\n`,
    );
  });

  test.afterAll(async () => {
    await cleanupFixtures();
  });

  test('keeps resolver, Blob and role access scoped to the authenticated Space', async ({ browser }) => {
    const sameSpace = await json<Array<Record<string, unknown>>>(await api.post(
      `spaces/${primarySpaceId}/markdown/resolve`,
      {
        headers: headers(viewer),
        data: { references: [{ key: 'same', kind: 'page', target: targetPage.title }] },
      },
    ), 'resolve same-Space page');
    expect(sameSpace).toEqual([expect.objectContaining({
      key: 'same', status: 'resolved', kind: 'page', pageId: targetPage.id,
    })]);

    const crossSpace = await json<Array<Record<string, unknown>>>(await api.post(
      `spaces/${primarySpaceId}/markdown/resolve`,
      {
        headers: headers(viewer),
        data: { references: [{ key: 'cross', kind: 'page', target: hiddenPage.title }] },
      },
    ), 'resolve cross-Space page');
    expect(crossSpace).toEqual([{ key: 'cross', status: 'unresolved' }]);
    const serializedCrossSpace = JSON.stringify(crossSpace);
    expect(serializedCrossSpace).not.toContain(hiddenPage.id);
    expect(serializedCrossSpace).not.toContain('Hidden cross-Space content');

    for (const resource of [
      `spaces/${primarySpaceId}`,
      `pages/${editorPage.id}`,
      `pages?spaceId=${primarySpaceId}`,
      `spaces/${primarySpaceId}/attachments?status=active`,
    ]) {
      const response = await api.get(resource, { headers: headers(outsider) });
      expect([403, 404]).toContain(response.status());
      expect(await response.text()).not.toContain(targetPage.title);
    }
    const outsiderContent = await api.get(`attachments/${sameNameAttachment.id}/content`, {
      headers: headers(outsider),
    });
    expect([403, 404]).toContain(outsiderContent.status());

    const archived = await json<AttachmentSummary>(await api.post(
      `spaces/${primarySpaceId}/attachments/${sameNameAttachment.id}/archive`,
      { headers: headers(owner), data: { expectedUpdatedAt: sameNameAttachment.updatedAt } },
    ), 'owner archives attachment');
    expect(archived.status).toBe('archived');
    const activeAfterArchive = await json<AttachmentList>(await api.get(
      `spaces/${primarySpaceId}/attachments?status=active&skip=0&take=100`,
      { headers: headers(owner) },
    ), 'owner lists active attachments after archive');
    const archivedAfterArchive = await json<AttachmentList>(await api.get(
      `spaces/${primarySpaceId}/attachments?status=archived&skip=0&take=100`,
      { headers: headers(owner) },
    ), 'owner lists archived attachments after archive');
    expect(activeAfterArchive.items.map((item) => item.id)).not.toContain(sameNameAttachment.id);
    expect(archivedAfterArchive.items.map((item) => item.id)).toContain(sameNameAttachment.id);
    // Archive removes the item from active resolution but retains recoverable bytes.
    expect((await api.get(`attachments/${sameNameAttachment.id}/content`, {
      headers: headers(owner),
    })).status()).toBe(200);
    sameNameAttachment = await json<AttachmentSummary>(await api.post(
      `spaces/${primarySpaceId}/attachments/${sameNameAttachment.id}/restore`,
      { headers: headers(owner), data: { expectedUpdatedAt: archived.updatedAt } },
    ), 'owner restores attachment');
    expect(sameNameAttachment.status).toBe('active');
    const activeAfterRestore = await json<AttachmentList>(await api.get(
      `spaces/${primarySpaceId}/attachments?status=active&skip=0&take=100`,
      { headers: headers(owner) },
    ), 'owner lists active attachments after restore');
    expect(activeAfterRestore.items.map((item) => item.id)).toContain(sameNameAttachment.id);
    expect((await api.get(`attachments/${sameNameAttachment.id}/content`, {
      headers: headers(owner),
    })).status()).toBe(200);

    const viewerSession = await authenticatedPage(browser, viewer);
    try {
      await viewerSession.page.goto(`/pages/${anchorPage.id}`);
      await expect(viewerSession.page.getByRole('heading', { name: anchorPage.title })).toBeVisible();
      await expect(viewerSession.page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
      await expect(viewerSession.page.getByRole('button', { name: 'Image attachments' })).toHaveCount(0);
      const viewerImage = viewerSession.page.getByRole('img', { name: 'same-name.png' });
      await expect(viewerImage).toBeVisible();
      await expect(viewerImage).toHaveAttribute('src', /^blob:/u);
      expect(await viewerImage.evaluate((element) => element.outerHTML)).not.toContain(viewer.access_token);
      await recordCredentialSurface(viewerSession.page);
      expect(viewerSession.externalRequests).toEqual([]);
    } finally {
      await viewerSession.context.close();
    }
  });

  test('uploads through picker, paste and coordinate drop, then saves authoritative markers and private Blob images', async ({ browser }) => {
    test.setTimeout(120_000);
    const ownerSession = await authenticatedPage(browser, owner);
    try {
      const page = ownerSession.page;
      await page.goto(`/pages/${editorPage.id}/edit`);
      await expectNoDocumentOverflow(page);
      const content = page.locator('.cm-content[contenteditable="true"]');
      await expect(content).toBeVisible();
      await content.click();
      await page.keyboard.press('Meta+End');

      await page.getByRole('button', { name: 'Image attachments' }).click();
      await expect(page.getByRole('dialog', { name: 'Image attachments' })).toBeVisible();
      await expectNoDocumentOverflow(page);
      await page.getByLabel('Upload image').setInputFiles({
        name: 'same-name.png', mimeType: 'image/png', buffer: alternatePng,
      });
      await expectMarker(page, '![[same-name (2).png]]');

      await page.getByRole('button', { name: 'Image attachments' }).click();
      await page.getByRole('button', { name: 'Insert same-name.png' }).click();
      await expectMarker(page, '![[same-name.png]]');

      await dispatchImageTransfer(page, 'paste', 'clipboard.png');
      await expectMarker(page, '![[clipboard.png]]');
      await dispatchImageTransfer(page, 'drop', 'coordinate-drop.png');
      await expectMarker(page, '![[coordinate-drop.png]]');

      const draft = await page.locator('.cm-content').innerText();
      const markers = [
        '![[same-name (2).png]]',
        '![[same-name.png]]',
        '![[clipboard.png]]',
        '![[coordinate-drop.png]]',
      ];
      let previous = -1;
      for (const marker of markers) {
        const index = draft.indexOf(marker);
        expect(index, marker).toBeGreaterThan(previous);
        previous = index;
      }
      await expect(page.getByText(/Unsaved/u)).toBeVisible();
      await expect(page.getByTestId('save-button')).toBeEnabled();
      await page.getByTestId('save-button').click();
      await expect(page.getByRole('status')).toContainText('Saved');
      await page.reload();
      await expect(page.locator('.cm-content')).toContainText('same-name (2).png');
      await expect(page.locator('.cm-content')).toContainText('same-name.png');
      await expect(page.locator('.cm-content')).toContainText('clipboard.png');
      await expect(page.locator('.cm-content')).toContainText('coordinate-drop.png');

      const persisted = await json<PersistedPage>(
        await api.get(`pages/${editorPage.id}`, { headers: headers(owner) }),
        'read saved attachment page',
      );
      previous = -1;
      for (const marker of markers) {
        const index = persisted.content.indexOf(marker);
        expect(index, marker).toBeGreaterThan(previous);
        previous = index;
      }

      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      for (const name of ['same-name (2).png', 'same-name.png', 'clipboard.png', 'coordinate-drop.png']) {
        const image = page.getByRole('img', { name });
        await expect(image).toBeVisible();
        await expect(image).toHaveAttribute('src', /^blob:/u);
        const markup = await image.evaluate((element) => element.outerHTML);
        expect(markup).not.toContain(owner.access_token);
        expect(markup).not.toMatch(/Authorization|Bearer|\/api\/attachments|\/api\/pages/iu);
      }
      const ownerScreenshot = path.join(artifacts, 'owner-attachment-preview.png');
      await page.screenshot({ path: ownerScreenshot, fullPage: true });
      // Screenshot is layout evidence only; credential checks use inspectable browser surfaces.
      await recordCredentialSurface(page);
      expect(ownerSession.externalRequests).toEqual([]);
    } finally {
      await ownerSession.context.close();
    }

    const editorSession = await authenticatedPage(browser, editor);
    try {
      await editorSession.page.goto(`/pages/${editorPage.id}/edit`);
      await expectNoDocumentOverflow(editorSession.page);
      await expect(editorSession.page.getByRole('button', { name: 'Image attachments' })).toBeVisible();
      await editorSession.page.getByRole('button', { name: 'Image attachments' }).click();
      await editorSession.page.getByLabel('Upload image').setInputFiles({
        name: 'editor-upload.png', mimeType: 'image/png', buffer: png,
      });
      await expectMarker(editorSession.page, '![[editor-upload.png]]');
      const listed = await json<AttachmentList>(await api.get(
        `spaces/${primarySpaceId}/attachments?status=active&skip=0&take=100`,
        { headers: headers(editor) },
      ), 'editor lists attachments');
      expect(listed.items.map((item) => item.displayName)).toContain('editor-upload.png');
      await recordCredentialSurface(editorSession.page);
      expect(editorSession.externalRequests).toEqual([]);
    } finally {
      await editorSession.context.close();
    }
  });

  test('renders refreshed sections, bounded cycle/depth/count/character fallbacks, version provenance and responsive anchors', async ({ browser }) => {
    test.setTimeout(180_000);
    const session = await authenticatedPage(browser, owner);
    const contexts: BrowserContext[] = [session.context];
    try {
      const page = session.page;
      await page.goto(`/pages/${anchorPage.id}#root-heading`);
      await expectNoDocumentOverflow(page);
      await expect(page.locator('#root-heading')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Same-Space target' })).toHaveAttribute('href', `/pages/${targetPage.id}`);
      await expect(page.getByText('Initial target content.')).toBeVisible();
      await page.goto(`/pages/${anchorPage.id}#%5Eroot-block`);
      await expect(page).toHaveURL(new RegExp(`#(?:%5E|\\^)root-block$`, 'iu'));
      await expect(page.locator('[id="^root-block"]')).toBeAttached();

      targetPage = await updatePage(targetPage, '# Section\n\nRefreshed target content.\n\n## Later\n\nRefreshed later content.');
      await page.goto(`/pages/${anchorPage.id}`);
      await expect(page.getByText('Refreshed target content.')).toBeVisible();
      await expect(page.getByText('Initial target content.')).toHaveCount(0);

      await page.goto(`/pages/${asyncHeadingPage.id}#later`);
      await expect(page.locator('#later')).toBeVisible();
      await expect(page.getByText('Refreshed later content.')).toBeVisible();

      await page.goto(`/pages/${cyclePage.id}`);
      await expect(page.getByRole('alert').filter({ hasText: 'A circular embed was stopped.' })).toBeVisible();
      await page.goto(`/pages/${depthPage.id}`);
      await expect(page.getByRole('alert').filter({ hasText: 'The embed depth limit was reached.' })).toBeVisible();
      await page.goto(`/pages/${countPage.id}`);
      await expect(page.getByRole('alert').filter({ hasText: 'The embed count limit was reached.' })).toHaveCount(1);
      await page.goto(`/pages/${characterPage.id}`);
      await expect(page.getByRole('alert').filter({ hasText: 'The embedded content size limit was reached.' })).toBeVisible();

      await page.goto(`/pages/${versionEmbedPage.id}/versions`);
      await page.getByRole('button', { name: /Preview v\d+/u }).first().click();
      const dialog = page.getByRole('dialog', { name: /Preview v\d+/u });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Embedded content is from the current version.')).toBeVisible();
      await expect(dialog.getByText('Refreshed target content.')).toBeVisible();
      await expectNoDocumentOverflow(page);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/pages/${editorPage.id}/edit`);
      await expectNoDocumentOverflow(page);
      await expect(page.getByRole('button', { name: 'Image attachments' })).toBeVisible();
      await page.getByRole('button', { name: 'Image attachments' }).click();
      await expect(page.getByRole('dialog', { name: 'Image attachments' })).toBeVisible();
      await expect(page.getByLabel('Upload image')).toBeAttached();
      await expect(page.getByLabel('Search attachments')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Close attachment picker' })).toBeVisible();
      await expectNoDocumentOverflow(page);
      const mobileScreenshot = path.join(artifacts, 'mobile-attachment-picker.png');
      await page.screenshot({ path: mobileScreenshot, fullPage: true });
      // Screenshot is layout evidence only; credential checks use inspectable browser surfaces.
      await recordCredentialSurface(page);
      expect(session.externalRequests).toEqual([]);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('final credential scan detects close-time log, info and debug tokens', async ({ browser }) => {
    const lateConsoleMessages: string[] = [];
    const lateRecords = (['log', 'info', 'debug'] as const).map((type) => ({
      type,
      text: `close-time ${type} fixture ${owner.access_token}`,
    }));
    const session = await authenticatedPage(browser, owner, lateRecords, lateConsoleMessages);
    try {
      await session.page.goto(`/pages/${anchorPage.id}`);
      await expect(session.page.getByRole('heading', { name: anchorPage.title })).toBeVisible();
      await recordCredentialSurface(session.page);
    } finally {
      await session.context.close();
    }

    expect(activeBrowserContexts.size).toBe(0);
    for (const record of lateRecords) {
      expect(lateConsoleMessages).toContain(`${record.type}: ${record.text}`);
    }
    expect(() => expectNoCredentialLeakIn(lateConsoleMessages)).toThrow();
  });
});
