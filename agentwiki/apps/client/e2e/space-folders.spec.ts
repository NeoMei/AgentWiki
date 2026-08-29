import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
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

interface TreeNode {
  kind: 'folder' | 'page';
  id: string;
  name?: string;
  title?: string;
  folderId?: string | null;
}

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const artifacts = path.join(os.tmpdir(), 'agentwiki-space-folder-qa', runId);
const spaceName = `Space Folder QA ${runId}`;
const rootFolderName = '产品资料';
const subFolderName = '草稿';
const folderPageTitle = '产品路线';
const rootPageTitle = '待归档页面';

let api: APIRequestContext;
let spaceId = '';
let rootFolderId = '';
let subFolderId = '';
let owner: AuthAccount | undefined;
let consoleIssues: string[] = [];

const ownerHeaders = () => ({ Authorization: `Bearer ${owner?.access_token ?? ''}` });

const watchConsole = (page: Page) => {
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleIssues.push(`${message.type()}: ${message.text()}`);
    }
  });
};

const json = async <T,>(response: APIResponse, operation: string): Promise<T> => {
  const body = await response.text();
  expect(response.ok(), `${operation} failed (${response.status()}): ${body}`).toBeTruthy();
  return JSON.parse(body) as T;
};

const register = async (kind: string, name: string): Promise<AuthAccount> => json<AuthAccount>(
  await api.post('auth/register', {
    data: {
      email: `${kind}-${runId}@space-folder.test`,
      password: 'AgentWiki9Test',
      name,
    },
  }),
  `register ${kind}`,
);

const authenticate = async (page: Page, account: AuthAccount) => {
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
  }, { token: account.access_token, user: account.user });
};

const listTree = async (parentFolderId: string | null): Promise<TreeNode[]> => {
  const response = await api.get(`spaces/${spaceId}/content-tree`, {
    params: { parentFolderId: parentFolderId ?? undefined, take: 200 },
    headers: ownerHeaders(),
  });
  return (await json<{ data: TreeNode[] }>(response, 'list content tree')).data;
};

const getTreeRevision = async (): Promise<string> => {
  const response = await api.get(`spaces/${spaceId}/content-tree`, {
    params: { take: 1 },
    headers: ownerHeaders(),
  });
  return (await json<{ treeRevision: string }>(response, 'read tree revision')).treeRevision;
};

const expectNoDocumentOverflow = async (page: Page) => {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
};

const createFolderViaUi = async (page: Page, name: string) => {
  await page.getByTestId('new-folder-button').click();
  await page.getByTestId('folder-dialog').getByLabel('文件夹名称').fill(name);
  await page.getByTestId('folder-dialog-submit').click();
  await expect(page.getByTestId('folder-dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name }).first()).toBeVisible();
};

const openFolder = async (page: Page, folderId: string, name: string) => {
  await page.getByTestId(`content-node-${folderId}`).click();
  await expect(
    page.getByTestId('content-breadcrumbs').getByText(name, { exact: true }),
  ).toBeVisible();
};

test.describe.serial('space folder hierarchy', () => {
  test.beforeEach(({ page }) => {
    consoleIssues = [];
    watchConsole(page);
  });

  test.afterEach(({ page }) => {
    expect(consoleIssues).toEqual([]);
  });

  test.beforeAll(async () => {
    await mkdir(artifacts, { recursive: true });
    api = await playwrightRequest.newContext({
      baseURL: `${apiBaseUrl.replace(/\/+$/u, '')}/`,
    });
    owner = await register('owner', 'Folder Owner');
    const createdSpace = await json<{ id: string }>(await api.post('spaces', {
      headers: ownerHeaders(),
      data: { name: spaceName, description: 'Disposable folder browser acceptance' },
    }), 'create Space');
    spaceId = createdSpace.id;
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
      if (owner?.access_token && owner.user.id) {
        await remove(`users/${owner.user.id}`, { Authorization: `Bearer ${owner.access_token}` });
      }
      await api.dispose();
    }
    expect(cleanupFailures).toEqual([]);
  });

  test('Owner creates folders, pages inside them, and navigates by breadcrumbs', async ({ page }) => {
    await authenticate(page, owner!);
    await page.goto(`/spaces/${spaceId}`);
    await expect(page.getByTestId('content-tree-empty')).toBeVisible();

    await createFolderViaUi(page, rootFolderName);
    const rootNodes = await listTree(null);
    rootFolderId = rootNodes.find((node) => node.kind === 'folder')!.id;

    await openFolder(page, rootFolderId, rootFolderName);
    await expect(page.getByTestId('folder-page-count')).toHaveText('页面 (0)');

    await page.getByRole('button', { name: '新建页面' }).click();
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.getByTestId('new-page-folder-hint')).toBeVisible();
    await page.getByLabel('标题').fill(folderPageTitle);
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await page.waitForURL(/\/pages\/[^/]+\/edit$/u);

    await page.goto(`/spaces/${spaceId}`);
    await openFolder(page, rootFolderId, rootFolderName);
    await expect(page.getByTestId('folder-page-count')).toHaveText('页面 (1)');
    await expect(page.getByTestId('content-tree')).toContainText(folderPageTitle);

    await createFolderViaUi(page, subFolderName);
    const subNodes = await listTree(rootFolderId);
    subFolderId = subNodes.find((node) => node.kind === 'folder')!.id;
    await openFolder(page, subFolderId, subFolderName);
    const breadcrumbs = page.getByTestId('content-breadcrumbs');
    await expect(breadcrumbs.getByText(rootFolderName, { exact: true })).toBeVisible();
    await expect(breadcrumbs.getByText(subFolderName, { exact: true })).toBeVisible();

    await breadcrumbs.getByRole('button', { name: rootFolderName }).click();
    await expect(breadcrumbs.getByText(rootFolderName, { exact: true })).toBeVisible();
    await expect(page.getByTestId('folder-page-count')).toHaveText('页面 (1)');
    await page.screenshot({ path: path.join(artifacts, 'folder-breadcrumbs.png'), fullPage: true });
  });

  test('Owner moves a root page into a folder with drag and drop', async ({ page }) => {
    const treeRevision = await getTreeRevision();
    const created = await json<{ id: string }>(await api.post('pages', {
      headers: ownerHeaders(),
      data: { spaceId, title: rootPageTitle, expectedTreeRevision: treeRevision },
    }), 'create root page');

    await authenticate(page, owner!);
    await page.goto(`/spaces/${spaceId}`);
    const source = page.getByTestId(`content-node-${created.id}`);
    const target = page.getByTestId(`content-node-${rootFolderId}`);
    await expect(source).toBeVisible();
    await expect(target).toBeVisible();

    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await source.dispatchEvent('dragstart', { dataTransfer });
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    const dropPoint = { dataTransfer, clientY: box!.y + box!.height / 2 };
    await target.dispatchEvent('dragover', dropPoint);
    await target.dispatchEvent('drop', dropPoint);
    await expect(source).not.toBeVisible();

    const folderNodes = await listTree(rootFolderId);
    const moved = folderNodes.find((node) => node.kind === 'page' && node.id === created.id);
    expect(moved, 'the moved page should live inside the folder').toBeTruthy();
    const rootNodes = await listTree(null);
    expect(rootNodes.find((node) => node.kind === 'page' && node.id === created.id)).toBeUndefined();
  });

  test('Owner deletes a folder subtree after the impact preview and restores it', async ({ page }) => {
    await authenticate(page, owner!);
    await page.goto(`/spaces/${spaceId}`);

    await page.getByTestId(`content-deletefolder-${rootFolderId}`).click();
    const dialog = page.getByTestId('folder-delete-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('folder-delete-impact')).toContainText('1 个子文件夹');
    await expect(page.getByTestId('folder-delete-impact')).toContainText('2 个页面');
    await page.getByTestId('folder-delete-confirm').click();

    const banner = page.getByTestId('folder-restored-banner');
    await expect(banner).toContainText(`已删除「${rootFolderName}」`);
    await expect(page.getByTestId(`content-node-${rootFolderId}`)).not.toBeVisible();
    await banner.getByRole('button', { name: '恢复' }).click();
    await expect(page.getByTestId(`content-node-${rootFolderId}`)).toBeVisible();

    const restored = await listTree(null);
    expect(restored.find((node) => node.kind === 'folder' && node.id === rootFolderId)).toBeTruthy();
    const restoredChildren = await listTree(rootFolderId);
    expect(restoredChildren.find((node) => node.kind === 'page')).toBeTruthy();
    await page.screenshot({ path: path.join(artifacts, 'folder-restored.png'), fullPage: true });
  });

  test('A 390px viewport keeps folder management usable without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await authenticate(page, owner!);
    await page.goto(`/spaces/${spaceId}`);
    await expect(page.getByTestId('new-folder-button')).toBeVisible();
    await openFolder(page, rootFolderId, rootFolderName);
    await expect(page.getByTestId('folder-page-count')).toHaveText('页面 (2)');
    await expectNoDocumentOverflow(page);
    await page.screenshot({ path: path.join(artifacts, 'folder-mobile.png'), fullPage: true });
  });
});
