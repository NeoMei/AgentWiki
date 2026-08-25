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
  label: 'Playwright API target',
});

interface AuthAccount {
  access_token: string;
  user: {
    id: string;
    name: string;
    email: string;
    platformRole?: string;
  };
}

interface PersistedPage {
  id: string;
  title: string;
  content: string;
  parentId: string | null;
  updatedAt: string;
  sourceTemplateId: string | null;
  sourceTemplateVersion: number | null;
  sourceTemplateLocale: string | null;
}

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const artifacts = path.join(os.tmpdir(), 'agentwiki-page-template-qa', runId);
const customTemplateName = `团队任务模板-${runId}`;
const spaceName = `Page Template QA ${runId}`;

let api: APIRequestContext;
let spaceId = '';
let sourcePageId = '';
let firstCreatedPageId = '';
let owner: AuthAccount | undefined;
let editor: AuthAccount | undefined;
let viewer: AuthAccount | undefined;

const json = async <T,>(response: APIResponse, operation: string): Promise<T> => {
  const body = await response.text();
  expect(
    response.ok(),
    `${operation} failed (${response.status()}): ${body}`,
  ).toBeTruthy();
  return JSON.parse(body) as T;
};

const register = async (kind: string, name: string): Promise<AuthAccount> => json<AuthAccount>(
  await api.post('auth/register', {
    data: {
      email: `${kind}-${runId}@page-template.test`,
      password: 'AgentWiki9Test',
      name,
    },
  }),
  `register ${kind}`,
);

const authenticate = async (page: Page, account: AuthAccount, language: 'zh-CN' | 'en') => {
  await page.addInitScript(({ token, user, locale }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('agentwiki.language.v1', locale);
  }, { token: account.access_token, user: account.user, locale: language });
};

const ownerHeaders = () => ({ Authorization: `Bearer ${owner?.access_token ?? ''}` });

const newAuthenticatedPage = async (
  browser: Browser,
  account: AuthAccount,
  language: 'zh-CN' | 'en',
) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await authenticate(page, account, language);
  return { context, page };
};

const expectNoDocumentOverflow = async (page: Page) => {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
};

const expectInsideViewport = async (page: Page, locator: Locator, label: string) => {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const [box, viewport] = await Promise.all([locator.boundingBox(), page.viewportSize()]);
  expect(box, `${label} should have a bounding box`).not.toBeNull();
  expect(viewport, 'the mobile viewport should be configured').not.toBeNull();
  expect(box!.x, `${label} left edge`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${label} right edge`).toBeLessThanOrEqual(viewport!.width + 0.5);
};

const expectRenderedHeading = async (
  page: Page,
  heading: string,
  language: 'zh-CN' | 'en',
) => {
  const renderedHeading = page.getByRole('heading', { name: heading });
  if (await renderedHeading.count() === 0) {
    await page.getByRole('button', { name: language === 'zh-CN' ? '预览' : 'Preview' }).click();
  }
  await expect(renderedHeading).toBeVisible();
};

const customTemplateArticle = (page: Page) => page.getByRole('article').filter({
  has: page.getByRole('heading', { name: customTemplateName, exact: true }),
});

test.describe.serial('page template library', () => {
  test.beforeAll(async () => {
    await mkdir(artifacts, { recursive: true });
    api = await playwrightRequest.newContext({
      baseURL: `${apiBaseUrl.replace(/\/+$/u, '')}/`,
    });

    owner = await register('owner', 'Template Owner');
    editor = await register('editor', 'Template Editor');
    viewer = await register('viewer', 'Template Viewer');

    const createdSpace = await json<{ id: string }>(await api.post('spaces', {
      headers: ownerHeaders(),
      data: { name: spaceName, description: 'Disposable page-template browser acceptance' },
    }), 'create Space');
    spaceId = createdSpace.id;

    for (const [account, role] of [[editor, 'editor'], [viewer, 'viewer']] as const) {
      await json(await api.post(`spaces/${spaceId}/members`, {
        headers: ownerHeaders(),
        data: { email: account.user.email, role },
      }), `add ${role}`);
    }

    const source = await json<PersistedPage>(await api.post('pages', {
      headers: ownerHeaders(),
      data: {
        spaceId,
        title: 'Team source',
        content: '# Team source\n\n## Shared section\n- [ ] First version',
      },
    }), 'create source page');
    sourcePageId = source.id;
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
      if (owner?.access_token && spaceId) {
        await remove(`spaces/${spaceId}`, ownerHeaders());
      }
    } finally {
      for (const account of [viewer, editor, owner]) {
        if (account?.access_token && account.user.id) {
          await remove(
            `users/${account.user.id}`,
            { Authorization: `Bearer ${account.access_token}` },
          );
        }
      }
      await api.dispose();
    }
    expect(cleanupFailures).toEqual([]);
  });

  test('Owner saves a page as a Space template and creates version-1 content from it', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await authenticate(page, owner!, 'zh-CN');
    await page.goto(`/pages/${sourcePageId}/edit`);
    await page.getByRole('button', { name: '更多页面操作' }).click();
    await page.getByRole('menuitem', { name: '保存为 Space 模板' }).click();
    await page.getByLabel('模板名称').fill(customTemplateName);
    await page.getByLabel('模板说明').fill('团队统一任务结构');
    await page.getByLabel('分类').selectOption('planning');
    await page.getByLabel('默认页面标题').fill('团队任务');
    await page.getByRole('button', { name: '保存模板' }).click();
    await expect(page.getByText('模板已创建')).toBeVisible();

    await page.goto(`/spaces/${spaceId}`);
    await page.getByRole('button', { name: '新建页面' }).click();
    await page.getByRole('button', { name: new RegExp(customTemplateName, 'u') }).click();
    await page.getByRole('button', { name: '下一步' }).click();
    await page.getByLabel('标题').fill('团队任务实例一');
    await page.getByRole('button', { name: '创建' }).click();
    await page.waitForURL(/\/pages\/[^/]+\/edit$/u);
    firstCreatedPageId = new URL(page.url()).pathname.split('/').at(-2)!;
    await expectRenderedHeading(page, 'Shared section', 'zh-CN');
    await page.screenshot({ path: path.join(artifacts, 'custom-template-created.png'), fullPage: true });
    expect(consoleErrors).toEqual([]);
  });

  test('A new template version never mutates pages created from version 1', async ({ page }) => {
    const source = await json<PersistedPage>(
      await api.get(`pages/${sourcePageId}`, { headers: ownerHeaders() }),
      'read source page',
    );
    await json(await api.patch(`pages/${sourcePageId}`, {
      headers: ownerHeaders(),
      data: {
        title: source.title,
        content: '# Team source\n\n## Shared section\n- [ ] Second version',
        expectedUpdatedAt: source.updatedAt,
      },
    }), 'update source page');

    await authenticate(page, owner!, 'zh-CN');
    await page.goto(`/spaces/${spaceId}/settings/page-templates`);
    const article = customTemplateArticle(page);
    await article.getByRole('button', { name: `从页面更新内容 ${customTemplateName}` }).click();
    await page.getByLabel('源页面').selectOption(sourcePageId);
    await page.getByRole('button', { name: '创建新版本' }).click();
    await expect(article).toContainText('v2');

    await page.goto(`/spaces/${spaceId}`);
    await page.getByRole('button', { name: '新建页面' }).click();
    await page.getByRole('button', { name: new RegExp(customTemplateName, 'u') }).click();
    await page.getByRole('button', { name: '下一步' }).click();
    await page.getByLabel('标题').fill('团队任务实例二');
    await page.getByRole('button', { name: '创建' }).click();
    await page.waitForURL(/\/pages\/[^/]+\/edit$/u);
    const secondCreatedPageId = new URL(page.url()).pathname.split('/').at(-2)!;

    const [firstPage, secondPage] = await Promise.all([
      json<PersistedPage>(
        await api.get(`pages/${firstCreatedPageId}`, { headers: ownerHeaders() }),
        'read version-1 page',
      ),
      json<PersistedPage>(
        await api.get(`pages/${secondCreatedPageId}`, { headers: ownerHeaders() }),
        'read version-2 page',
      ),
    ]);
    expect(firstPage.content).toContain('First version');
    expect(firstPage.content).not.toContain('Second version');
    expect(secondPage.content).toContain('Second version');
    expect(firstPage.sourceTemplateVersion).toBe(1);
    expect(secondPage.sourceTemplateVersion).toBe(2);
    expect(firstPage.sourceTemplateId).toBe(secondPage.sourceTemplateId);
  });

  test('Owner archives and restores the Space template from settings', async ({ page }) => {
    await authenticate(page, owner!, 'zh-CN');
    await page.goto(`/spaces/${spaceId}/settings/page-templates`);
    page.once('dialog', (dialog) => dialog.accept());
    await customTemplateArticle(page)
      .getByRole('button', { name: `归档 ${customTemplateName}` })
      .click();
    await expect(customTemplateArticle(page)).toHaveCount(0);

    await page.getByRole('checkbox', { name: '显示已归档模板' }).check();
    const archivedArticle = customTemplateArticle(page);
    await expect(archivedArticle.getByRole('button', { name: `恢复 ${customTemplateName}` })).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await archivedArticle.getByRole('button', { name: `恢复 ${customTemplateName}` }).click();
    await expect(customTemplateArticle(page).getByRole('button', { name: `归档 ${customTemplateName}` })).toBeVisible();
  });

  test('Editor can use but cannot manage; Viewer cannot create', async ({ browser }) => {
    const editorSession = await newAuthenticatedPage(browser, editor!, 'en');
    try {
      await editorSession.page.goto(`/spaces/${spaceId}`);
      const newPage = editorSession.page.getByRole('button', { name: 'New page', exact: true });
      await expect(newPage).toBeVisible();
      await newPage.click();
      const customTemplate = editorSession.page.getByRole('button', {
        name: new RegExp(customTemplateName, 'u'),
      });
      await expect(customTemplate).toBeVisible();
      await expect(editorSession.page.getByRole('link', { name: 'Manage templates' })).toHaveCount(0);
      await customTemplate.click();
      await editorSession.page.getByRole('button', { name: 'Next', exact: true }).click();
      await editorSession.page.getByLabel('Title').fill('Editor custom-template page');
      await editorSession.page.getByRole('button', { name: 'Create', exact: true }).click();
      await editorSession.page.waitForURL(/\/pages\/[^/]+\/edit$/u);
      await expectRenderedHeading(editorSession.page, 'Shared section', 'en');

      await editorSession.page.goto(`/spaces/${spaceId}/settings/page-templates`);
      const editorArticle = customTemplateArticle(editorSession.page);
      await expect(editorArticle).toBeVisible();
      await expect(editorArticle.getByRole('button')).toHaveCount(0);
    } finally {
      await editorSession.context.close();
    }

    const viewerSession = await newAuthenticatedPage(browser, viewer!, 'en');
    try {
      await viewerSession.page.goto(`/spaces/${spaceId}`);
      await expect(viewerSession.page.getByRole('heading', {
        name: spaceName,
        exact: true,
      })).toBeVisible();
      await expect(viewerSession.page.getByRole('button', { name: 'New page', exact: true })).toHaveCount(0);
    } finally {
      await viewerSession.context.close();
    }
  });

  test('Chinese and English system templates create localized Markdown', async ({ browser }) => {
    for (const scenario of [
      { locale: 'zh-CN' as const, template: /日报/u, title: '中文日报验收', heading: '今日完成' },
      { locale: 'en' as const, template: /Weekly report/u, title: 'English weekly acceptance', heading: 'Weekly summary' },
    ]) {
      const session = await newAuthenticatedPage(browser, owner!, scenario.locale);
      try {
        await session.page.goto(`/spaces/${spaceId}`);
        await session.page.getByRole('button', {
          name: scenario.locale === 'zh-CN' ? '新建页面' : 'New page',
        }).click();
        await session.page.getByRole('button', { name: scenario.template }).click();
        await session.page.getByRole('button', {
          name: scenario.locale === 'zh-CN' ? '下一步' : 'Next',
          exact: true,
        }).click();
        await session.page.getByLabel(scenario.locale === 'zh-CN' ? '标题' : 'Title').fill(scenario.title);
        await session.page.getByRole('button', {
          name: scenario.locale === 'zh-CN' ? '创建' : 'Create',
          exact: true,
        }).click();
        await session.page.waitForURL(/\/pages\/[^/]+\/edit$/u);
        await expectRenderedHeading(session.page, scenario.heading, scenario.locale);
      } finally {
        await session.context.close();
      }
    }
  });

  test('Blank creation keeps parent-page behavior and has no template provenance', async ({ page }) => {
    await authenticate(page, owner!, 'zh-CN');
    await page.goto(`/spaces/${spaceId}`);
    await page.getByRole('button', { name: '新建页面' }).click();
    await expect(page.getByRole('button', { name: /空白页面/u })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '下一步' }).click();
    await page.getByLabel('标题').fill('空白子页面');
    await page.getByLabel('父页面（可选）').selectOption(sourcePageId);
    await page.getByRole('button', { name: '创建' }).click();
    await page.waitForURL(/\/pages\/[^/]+\/edit$/u);
    const blankPageId = new URL(page.url()).pathname.split('/').at(-2)!;
    const blankPage = await json<PersistedPage>(
      await api.get(`pages/${blankPageId}`, { headers: ownerHeaders() }),
      'read blank child page',
    );
    expect(blankPage).toMatchObject({
      parentId: sourcePageId,
      content: '',
      sourceTemplateId: null,
      sourceTemplateVersion: null,
      sourceTemplateLocale: null,
    });
  });

  test('390px NewPageDialog, manager, and PageEditor More menu stay in the viewport and restore focus', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await authenticate(page, owner!, 'en');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/spaces/${spaceId}`);

    const opener = page.getByRole('button', { name: 'New page', exact: true });
    await opener.click();
    const newPageDialog = page.getByRole('dialog', { name: 'Create new page' });
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await expectNoDocumentOverflow(page);
    for (const [label, locator] of [
      ['NewPageDialog', newPageDialog],
      ['blank template card', page.getByRole('button', { name: /Blank page/u })],
      ['weekly template card', page.getByRole('button', { name: /Weekly report/u })],
      ['NewPageDialog cancel', page.getByRole('button', { name: 'Cancel', exact: true })],
      ['NewPageDialog next', page.getByRole('button', { name: 'Next', exact: true })],
    ] as const) {
      await expectInsideViewport(page, locator, label);
    }

    await page.getByRole('button', { name: /Weekly report/u }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByLabel('Title')).toHaveValue(/Weekly report \d{4}-W\d{2}/u);
    await expect(page.getByLabel('Title')).toBeFocused();
    await expectNoDocumentOverflow(page);
    for (const [label, locator] of [
      ['NewPageDialog title', page.getByLabel('Title')],
      ['NewPageDialog parent', page.getByLabel('Parent page (optional)')],
      ['NewPageDialog back', page.getByRole('button', { name: 'Back', exact: true })],
      ['NewPageDialog create', page.getByRole('button', { name: 'Create', exact: true })],
    ] as const) {
      await expectInsideViewport(page, locator, label);
    }
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(newPageDialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await page.screenshot({ path: path.join(artifacts, 'new-page-dialog-mobile.png'), fullPage: true });

    await page.goto(`/spaces/${spaceId}/settings/page-templates`);
    await expect(page.getByRole('heading', { name: 'Space page templates' })).toBeVisible();
    const article = customTemplateArticle(page);
    await expectNoDocumentOverflow(page);
    for (const [label, locator] of [
      ['PageTemplateManager main', page.locator('main')],
      ['template search', page.getByLabel('Search')],
      ['template category', page.getByLabel('Category')],
      ['archive filter', page.getByRole('checkbox', { name: 'Show archived templates' })],
      ['custom template article', article],
      ['custom edit action', article.getByRole('button', { name: `Edit ${customTemplateName}` })],
      ['custom version action', article.getByRole('button', { name: `Update content from page ${customTemplateName}` })],
      ['custom archive action', article.getByRole('button', { name: `Archive ${customTemplateName}` })],
    ] as const) {
      await expectInsideViewport(page, locator, label);
    }
    await page.screenshot({ path: path.join(artifacts, 'template-manager-mobile.png'), fullPage: true });

    await page.goto(`/pages/${sourcePageId}/edit`);
    const more = page.getByRole('button', { name: 'More page actions' });
    await more.click();
    const menu = page.getByRole('menu', { name: 'More page actions' });
    const menuItem = page.getByRole('menuitem', { name: 'Save as Space template' });
    await expect(menuItem).toBeFocused();
    await expectNoDocumentOverflow(page);
    await expectInsideViewport(page, more, 'PageEditor More trigger');
    await expectInsideViewport(page, menu, 'PageEditor More menu');
    await expectInsideViewport(page, menuItem, 'PageEditor More item');
    await page.screenshot({ path: path.join(artifacts, 'page-editor-more-mobile.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(more).toBeFocused();
    expect(consoleErrors).toEqual([]);
  });
});
