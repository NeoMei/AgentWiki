# AgentWikiQ Test Report Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 18 AgentWikiQ findings with localized feedback, reliable source ingestion, correct role semantics, safe editor state, and a self-refreshing review workflow.

**Architecture:** Implement five bounded fixes behind reusable interfaces: API error translation/toasts, truthful guide components, source input normalization and safe remote fetching, human role/editor-state corrections, and review lifecycle synchronization. Preserve the existing Source → Run → ChangeSet → Page pipeline and use database compare-and-set plus soft-delete resurrection rather than bypassing review.

**Tech Stack:** React 18, Vite 6, Vitest 3, Tailwind CSS 4, CodeMirror 6, NestJS 10, Jest 30, Prisma 5, PostgreSQL, Axios.

## Global Constraints

- Modify only `agentwiki/` product code, tests, and usage guides.
- Do not introduce a second UI component system or a new client state library.
- Every new user-visible string must support Simplified Chinese and English through `LanguageContext`.
- Agents never receive `review:decide`; only human Space admin content permissions expand.
- Every redirect in URL ingestion must re-run protocol, credential, DNS, and private-address validation.
- Obsidian community-store approval is already pending; do not submit another listing request.
- Do not publish npm, push/merge, apply a production migration, or deploy production.
- Preserve all unrelated working-tree changes, especially CodeGraph and automatic-graph work.
- Each behavior change follows RED → GREEN → focused regression → commit.

---

## File Structure

- `apps/client/src/api/error-message.ts`: stable business-code/status-to-i18n mapping.
- `apps/client/src/components/Toast.tsx`: controlled fixed viewport notification.
- `apps/client/src/features/about/GatewayGuidePreview.tsx`: credential-free preview matching the current gateway card.
- `apps/server/src/knowledge-pipeline/source-upload.ts`: upload filename and UTF-8 boundary helpers.
- `apps/server/src/knowledge-pipeline/remote-source.ts`: HTML extraction and response-type helpers.
- Existing feature files remain responsible for their page state; no broad component rewrite.
- Existing `AuthorizationService` gains the human-admin role implication centrally so controllers stay consistent.
- Existing `ReviewService` remains the only ChangeSet publication writer and gains count/sort/resurrection behavior.

---

### Task 1: Shared Localized API Errors and Viewport Toast

**Files:**
- Create: `apps/client/src/api/error-message.ts`
- Create: `apps/client/src/api/error-message.spec.ts`
- Create: `apps/client/src/components/Toast.tsx`
- Create: `apps/client/src/components/Toast.spec.tsx`
- Create: `apps/client/src/features/auth/Login.spec.tsx`
- Modify: `apps/client/src/features/auth/Login.tsx`
- Modify: `apps/client/src/features/auth/ForcePasswordChange.tsx`
- Modify: `apps/client/src/i18n/messages.ts`

**Interfaces:**
- Consumes: Axios-shaped errors `{ response?: { status?: number; data?: { code?: string; message?: string } } }` and `LanguageContext.t`.
- Produces: `apiErrorMessage(error, t, fallbackKey): string` and `<Toast kind message onClose />` for later Review use.

- [ ] **Step 1: Write failing API error mapping tests**

```ts
import { describe, expect, it } from 'vitest';
import { apiErrorMessage } from './error-message';

const t = (key: string) => ({
  'error.authInvalidCredentials': '邮箱或密码错误',
  'error.rateLimited': '请求过于频繁，请稍后再试',
  'error.changeSetState': '审核状态已变化，已为你刷新',
  'auth.loginFailed': '登录失败',
}[key] || key);

describe('apiErrorMessage', () => {
  it('uses stable business codes instead of an English server message', () => {
    expect(apiErrorMessage({ response: { status: 401, data: {
      code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials',
    } } }, t, 'auth.loginFailed')).toBe('邮箱或密码错误');
  });

  it('maps 429 without exposing its English payload', () => {
    expect(apiErrorMessage({ response: { status: 429, data: {
      message: 'Too many requests',
    } } }, t, 'auth.loginFailed')).toBe('请求过于频繁，请稍后再试');
  });
});
```

- [ ] **Step 2: Write failing Login and Toast component tests**

```tsx
it('renders a localized invalid-credential response', async () => {
  vi.mocked(api.post).mockRejectedValue({ response: { status: 401, data: {
    code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials',
  } } });
  renderLogin('zh-CN');
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'u@example.com' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码错误');
  expect(screen.queryByText('Invalid credentials')).not.toBeInTheDocument();
});

it('keeps an error toast fixed in the current viewport and closes it', () => {
  const onClose = vi.fn();
  render(<Toast kind="error" message="发布失败" onClose={onClose} />);
  expect(screen.getByRole('alert')).toHaveClass('fixed');
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(onClose).toHaveBeenCalledOnce();
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @agentwiki/client test -- src/api/error-message.spec.ts src/components/Toast.spec.tsx src/features/auth/Login.spec.tsx
```

Expected: FAIL because `error-message.ts`, `Toast.tsx`, and the localized Login behavior do not exist.

- [ ] **Step 4: Implement the shared mapping**

```ts
export type Translate = (key: string, params?: Record<string, string | number>) => string;

const CODE_KEYS: Record<string, string> = {
  AUTH_INVALID_CREDENTIALS: 'error.authInvalidCredentials',
  AUTH_RATE_LIMITED: 'error.rateLimited',
  AUTH_PASSWORD_POLICY: 'error.passwordPolicy',
  AUTH_PASSWORD_MISMATCH: 'error.passwordMismatch',
  SPACE_ACCESS_DENIED: 'error.spaceAccessDenied',
  AUTH_SCOPE_REQUIRED: 'error.spaceAccessDenied',
  CHANGESET_INVALID_STATE: 'error.changeSetState',
  CHANGESET_CONFLICT: 'error.changeSetConflict',
  APPROVAL_REQUIRED: 'error.approvalRequired',
  SOURCE_INVALID: 'error.sourceInvalid',
  SOURCE_TOO_LARGE: 'error.sourceTooLarge',
  CONFLICT: 'error.resourceConflict',
};

export function apiErrorMessage(error: unknown, t: Translate, fallbackKey: string): string {
  const response = (error as any)?.response;
  const code = response?.data?.code;
  if (typeof code === 'string' && CODE_KEYS[code]) return t(CODE_KEYS[code]);
  if (response?.status === 429) return t('error.rateLimited');
  if (!response) return t('error.network');
  return t(fallbackKey);
}
```

Add matching English and Chinese entries to `messages.ts`, including `common.close`, then replace direct `err.response?.data?.message` reads in Login and ForcePasswordChange with `apiErrorMessage`.

- [ ] **Step 5: Implement the controlled Toast**

```tsx
import React from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export const Toast: React.FC<{
  kind: 'success' | 'error';
  message: string;
  onClose: () => void;
}> = ({ kind, message, onClose }) => {
  const { t } = useLanguage();
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`fixed right-4 top-20 z-[70] flex max-w-sm items-start gap-3 rounded-xl border bg-white p-4 shadow-lg ${kind === 'error' ? 'border-red-200 text-red-700' : 'border-green-200 text-green-700'}`}
    >
      {kind === 'error' ? <XCircle size={18} /> : <CheckCircle2 size={18} />}
      <p className="min-w-0 flex-1 text-sm leading-5">{message}</p>
      <button type="button" onClick={onClose} aria-label={t('common.close')}><X size={16} /></button>
    </div>
  );
};
```

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
pnpm --filter @agentwiki/client test -- src/api/error-message.spec.ts src/components/Toast.spec.tsx src/features/auth/Login.spec.tsx
pnpm --filter @agentwiki/client exec tsc --noEmit
git add apps/client/src/api apps/client/src/components/Toast.tsx apps/client/src/components/Toast.spec.tsx apps/client/src/features/auth apps/client/src/i18n/messages.ts
git commit -m "fix(client): localize API errors and add viewport toast"
```

Expected: focused tests PASS and TypeScript exits 0.

---

### Task 2: Password Reset Account Identity

**Files:**
- Create: `apps/client/src/features/admin/AdminPage.spec.tsx`
- Modify: `apps/client/src/features/admin/AdminPage.tsx`
- Modify: `apps/client/src/i18n/messages.ts`
- Modify: `apps/server/src/platform-admin/platform-admin.service.spec.ts`

**Interfaces:**
- Consumes: existing reset response `{ password: string }` and selected `UserRow`.
- Produces: explicit `email + temporary password` display/copy contract; no server API shape change.

- [ ] **Step 1: Write the failing UI regression**

```tsx
it('keeps the exact account email visible and copies labeled login credentials', async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ data: stats })
    .mockResolvedValueOnce({ data: { users: [target], total: 1 } });
  vi.mocked(api.post).mockResolvedValue({ data: { password: 'Temp_Aa1!' } });
  const writeText = vi.fn();
  Object.assign(navigator, { clipboard: { writeText } });
  renderAdmin();
  fireEvent.click(await screen.findByTitle('重置密码'));
  expect(screen.getByText('billy_7609@test-agentwiki.com')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  fireEvent.click(await screen.findByRole('button', { name: '复制登录信息' }));
  expect(writeText).toHaveBeenCalledWith('邮箱: billy_7609@test-agentwiki.com\n临时密码: Temp_Aa1!');
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm --filter @agentwiki/client test -- src/features/admin/AdminPage.spec.tsx
```

Expected: FAIL because the modal does not preserve/show the full account identity after reset and has no combined copy action.

- [ ] **Step 3: Keep the target selected after reset and add explicit copy actions**

Change `performAction` so reset success does not clear `actionTarget`/`actionType`, render both `actionTarget.name` and `actionTarget.email`, and add:

```tsx
const loginDetails = actionTarget && actionResult
  ? t('admin.loginDetailsTemplate', { email: actionTarget.email, password: actionResult })
  : '';

<button
  type="button"
  onClick={() => navigator.clipboard.writeText(loginDetails)}
  className="text-sm font-medium text-blue-600 hover:underline"
>
  {t('admin.copyLoginDetails')}
</button>
```

Use templates:

```ts
'admin.copyLoginDetails': 'Copy login details',
'admin.loginDetailsTemplate': 'Email: {email}\nTemporary password: {password}',
```

and Chinese:

```ts
'admin.copyLoginDetails': '复制登录信息',
'admin.loginDetailsTemplate': '邮箱: {email}\n临时密码: {password}',
```

- [ ] **Step 4: Add a real-hash characterization test**

In `platform-admin.service.spec.ts`, instantiate a real `AuthService` with a stub JwtService/Prisma and assert the stored hash validates against the returned password:

```ts
it('stores a bcrypt hash that validates the returned temporary password', async () => {
  const realAuth = new AuthService({ sign: jest.fn() } as any, {} as any);
  const realService = new PlatformAdminService(prisma, config, audit, realAuth);
  const password = await realService.resetPassword('admin-1', 'user-1');
  const storedHash = tx.user.update.mock.calls[0][0].data.password;
  await expect(realAuth.validatePassword(password, storedHash)).resolves.toBe(true);
});
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @agentwiki/client test -- src/features/admin/AdminPage.spec.tsx
pnpm --filter @agentwiki/server test -- platform-admin/platform-admin.service.spec.ts
git add apps/client/src/features/admin apps/client/src/i18n/messages.ts apps/server/src/platform-admin/platform-admin.service.spec.ts
git commit -m "fix(admin): make reset account identity unambiguous"
```

Expected: both focused suites PASS.

---

### Task 3: Truthful Gateway and Obsidian Guides

**Files:**
- Create: `apps/client/src/features/about/GatewayGuidePreview.tsx`
- Create: `apps/client/src/features/about/GatewayGuidePreview.spec.tsx`
- Modify: `apps/client/src/features/about/UsageGuide.tsx`
- Modify: `apps/client/src/features/about/UsageGuide.spec.tsx`
- Modify: `apps/client/src/features/guide/ObsidianGuide.tsx`
- Create: `apps/client/src/features/guide/ObsidianGuide.spec.tsx`

**Interfaces:**
- Consumes: current `agent.localSync.*` translation keys and `LOCAL_SYNC_PACKAGE_URL`.
- Produces: a credential-free current gateway preview and a truthful “community review pending / GitHub manual install available” guide.

- [ ] **Step 1: Write failing guide tests**

```tsx
it('shows the current unified gateway card without the obsolete screenshot', () => {
  renderGuide();
  expect(screen.getByTestId('gateway-guide-preview')).toHaveTextContent('AgentWiki 统一网关');
  expect(screen.getByText('@neomei/agentwiki-local-sync')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '复制接入指令' })).toBeDisabled();
  expect(screen.queryByRole('img', { name: '已生成 Key 和接入指令' })).not.toBeInTheDocument();
});

it('states that community review is pending and gives exact manual files', () => {
  renderObsidianGuide();
  expect(screen.getByText('社区市场审核中')).toBeInTheDocument();
  expect(screen.getByText(/main\.js.*manifest\.json.*styles\.css/)).toBeInTheDocument();
  expect(screen.getByText('.obsidian/plugins/agentwiki-sync/')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '下载最新 Release' })).toHaveAttribute(
    'href', 'https://github.com/NeoMei/agentwiki-sync/releases/latest',
  );
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @agentwiki/client test -- src/features/about/GatewayGuidePreview.spec.tsx src/features/about/UsageGuide.spec.tsx src/features/guide/ObsidianGuide.spec.tsx
```

Expected: FAIL because the current guide still renders the obsolete screenshot and recommends community search.

- [ ] **Step 3: Implement the current gateway preview**

Create a presentational card with no credential values:

```tsx
export const GatewayGuidePreview: React.FC = () => {
  const { t } = useLanguage();
  return (
    <div data-testid="gateway-guide-preview" className="rounded-xl border border-gray-200 bg-white p-5">
      <h4 className="font-semibold">{t('agent.localSync.title')}</h4>
      <p className="mt-1 text-sm text-gray-600">{t('agent.localSync.description')}</p>
      <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm">
        <strong>@neomei/agentwiki-local-sync</strong>
        <p className="text-gray-500">{t('agent.localSync.supportedClients')}</p>
      </div>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" disabled />
        <span>{t('agent.localSync.autoPublish')}</span>
      </label>
      <div className="mt-4 rounded-lg border bg-gray-50 p-3 font-mono text-xs text-gray-500">
        {t('agent.localSync.guidePlaceholder')}
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled className="h-8 rounded-lg border px-3 text-sm">{t('agent.localSync.copy')}</button>
        <button type="button" disabled className="h-8 rounded-lg border px-3 text-sm">{t('agent.localSync.regenerate')}</button>
      </div>
      <p className="mt-3 text-xs text-gray-500">{t('agent.localSync.installOnly')}</p>
    </div>
  );
};
```

Replace `step4-generated-credential.png` in `UsageGuide.tsx` with this component and update the path text to “Agents → target Agent → Access → AgentWiki unified gateway”.

- [ ] **Step 4: Correct Obsidian availability and manual install**

Replace the first two steps with:

```ts
{
  title: zh ? '社区市场审核中' : 'Community listing under review',
  body: zh
    ? '官方上架申请已经提交。审核通过前，在 Obsidian 社区插件中搜索不到 AgentWiki Sync，这是当前预期状态。'
    : 'The official listing has been submitted. Until approval, AgentWiki Sync is not expected to appear in Community Plugins search.',
},
{
  title: zh ? '从 GitHub Release 手动安装' : 'Install manually from GitHub Releases',
  body: zh
    ? '下载 main.js、manifest.json、styles.css，放入 Vault 的 .obsidian/plugins/agentwiki-sync/，重启 Obsidian 后启用插件。'
    : 'Download main.js, manifest.json, and styles.css into .obsidian/plugins/agentwiki-sync/ in your vault, restart Obsidian, then enable the plugin.',
},
```

Change the primary link to `https://github.com/NeoMei/agentwiki-sync/releases/latest`; keep the community link visibly disabled/informational rather than installable.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @agentwiki/client test -- src/features/about/GatewayGuidePreview.spec.tsx src/features/about/UsageGuide.spec.tsx src/features/guide/ObsidianGuide.spec.tsx
git add apps/client/src/features/about apps/client/src/features/guide apps/client/src/i18n/messages.ts
git commit -m "fix(guide): align gateway and Obsidian installation steps"
```

Expected: all guide tests PASS and no test expects the obsolete screenshot.

---

### Task 4: Explicit File Upload and UTF-8 Filename Boundary

**Files:**
- Create: `apps/server/src/knowledge-pipeline/source-upload.ts`
- Create: `apps/server/src/knowledge-pipeline/source-upload.spec.ts`
- Modify: `apps/server/src/knowledge-pipeline/source.controller.ts`
- Create: `apps/client/src/features/source/SourcesPage.spec.tsx`
- Modify: `apps/client/src/features/source/SourcesPage.tsx`
- Modify: `apps/client/src/i18n/messages.ts`

**Interfaces:**
- Produces: `normalizeUploadFilename(value: string): string` and `decodeUtf8Source(buffer: Buffer): string`.
- Consumes: browser `File` selection and existing multipart `/spaces/:spaceId/sources/file` endpoint.

- [ ] **Step 1: Write failing upload boundary tests**

```ts
import { BadRequestException } from '@nestjs/common';
import { decodeUtf8Source, normalizeUploadFilename } from './source-upload';

it('repairs a UTF-8 filename decoded as Latin-1', () => {
  const mojibake = Buffer.from('图片内容总结.md', 'utf8').toString('latin1');
  expect(normalizeUploadFilename(mojibake)).toBe('图片内容总结.md');
});

it('preserves an already-correct filename', () => {
  expect(normalizeUploadFilename('图片内容总结.md')).toBe('图片内容总结.md');
});

it('rejects invalid UTF-8 instead of persisting replacement characters', () => {
  expect(() => decodeUtf8Source(Buffer.from([0xc3, 0x28]))).toThrow(BadRequestException);
});
```

- [ ] **Step 2: Write the failing SourcesPage interaction test**

```tsx
it('shows an explicit selected file and upload button', async () => {
  renderSources();
  fireEvent.click(screen.getByRole('button', { name: '添加来源' }));
  fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'file' } });
  const file = new File(['# 中文'], '图片内容总结.md', { type: 'text/markdown' });
  fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [file] } });
  expect(screen.getByText('图片内容总结.md')).toBeInTheDocument();
  expect(screen.getByLabelText('名称')).toHaveValue('图片内容总结.md');
  fireEvent.click(screen.getByRole('button', { name: '上传文件' }));
  expect(api.post).toHaveBeenCalledWith('/spaces/space-1/sources/file', expect.any(FormData), expect.anything());
});
```

- [ ] **Step 3: Verify RED**

Run:

```bash
pnpm --filter @agentwiki/server test -- knowledge-pipeline/source-upload.spec.ts
pnpm --filter @agentwiki/client test -- src/features/source/SourcesPage.spec.tsx
```

Expected: FAIL because the helper module and explicit upload UI do not exist.

- [ ] **Step 4: Implement strict UTF-8 and conservative filename repair**

```ts
import { BadRequestException } from '@nestjs/common';

const replacementCount = (value: string) => (value.match(/�/g) || []).length;
const mojibakeCount = (value: string) => (value.match(/[ÃÂåæçäö]/g) || []).length;

export function normalizeUploadFilename(value: string): string {
  const repaired = Buffer.from(value, 'latin1').toString('utf8');
  if (replacementCount(repaired) > 0) return value;
  return mojibakeCount(repaired) < mojibakeCount(value) || /[\u3400-\u9fff]/u.test(repaired)
    ? repaired.normalize('NFC')
    : value.normalize('NFC');
}

export function decodeUtf8Source(buffer: Buffer): string {
  const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  if (!content.trim()) throw new BadRequestException('Source file is empty');
  return content;
}
```

Use the normalized filename for extension validation/name and `decodeUtf8Source(file.buffer)` for content in `SourceController.upload`.

- [ ] **Step 5: Implement explicit file selection state**

Use a visually explicit label/input pair, selected filename, and conditional submit text:

```tsx
<label htmlFor="source-file" className="inline-flex h-8 cursor-pointer items-center rounded-lg border px-3 text-sm">
  {t('source.chooseFile')}
</label>
<input id="source-file" aria-label={t('source.chooseFile')} type="file" className="sr-only" onChange={selectFile} />
{file ? <span className="text-sm text-gray-600">{file.name}</span> : <span className="text-sm text-gray-400">{t('source.noFileSelected')}</span>}
<button disabled={!file} className="h-8 rounded-lg bg-blue-600 px-3 text-sm text-white disabled:opacity-50">
  {t('source.uploadFile')}
</button>
```

`selectFile` must set both `file` and `form.name` when the name field is blank or still equals the previous selected filename.

Import `apiErrorMessage` from Task 1 and replace raw server messages in `load`, `create`, detail loading, and Run creation with localized fallback keys. Invalid UTF-8 and unsupported file types must therefore remain Chinese in Chinese mode even when the server message is English.

- [ ] **Step 6: Verify and commit**

Run:

```bash
pnpm --filter @agentwiki/server test -- knowledge-pipeline/source-upload.spec.ts
pnpm --filter @agentwiki/client test -- src/features/source/SourcesPage.spec.tsx
git add apps/server/src/knowledge-pipeline/source-upload* apps/server/src/knowledge-pipeline/source.controller.ts apps/client/src/features/source apps/client/src/i18n/messages.ts
git commit -m "fix(source): clarify file uploads and preserve UTF-8 names"
```

Expected: both focused suites PASS.

---

### Task 5: Safe Redirecting URL Fetch and HTML Extraction

**Files:**
- Create: `apps/server/src/knowledge-pipeline/remote-source.ts`
- Create: `apps/server/src/knowledge-pipeline/remote-source.spec.ts`
- Modify: `apps/server/src/knowledge-pipeline/source.service.ts`
- Modify: `apps/server/src/knowledge-pipeline/source.service.spec.ts`
- Modify: `apps/client/src/features/source/RunsPage.tsx`
- Modify: `apps/client/src/features/source/RunsPage.spec.tsx`

**Interfaces:**
- Produces: `extractHtmlText(html: string): string`, `isSupportedTextContentType(value: string): boolean`, and private `SourceService.fetchRemoteUrl(uri)`.
- Consumes: existing `validateRemoteUrl()` result with DNS-pinned address/family.

- [ ] **Step 1: Write failing pure extraction tests**

```ts
import { extractHtmlText, isSupportedTextContentType } from './remote-source';

it('extracts readable headings, paragraphs, lists and links without scripts', () => {
  const text = extractHtmlText(`
    <html><head><title>Tesla</title><style>.x{}</style></head>
    <body><h1>特斯拉</h1><p>电动车公司</p><ul><li><a href="/models">车型</a></li></ul><script>alert(1)</script></body></html>
  `);
  expect(text).toContain('# 特斯拉');
  expect(text).toContain('电动车公司');
  expect(text).toContain('- 车型');
  expect(text).not.toContain('alert(1)');
});

it('accepts text and JSON but rejects binary media', () => {
  expect(isSupportedTextContentType('text/html; charset=utf-8')).toBe(true);
  expect(isSupportedTextContentType('application/json')).toBe(true);
  expect(isSupportedTextContentType('image/png')).toBe(false);
});
```

- [ ] **Step 2: Write failing redirect safety tests**

```ts
it('revalidates every redirect and returns extracted HTML', async () => {
  const validate = jest.spyOn(service as any, 'validateRemoteUrl')
    .mockResolvedValueOnce({ url: new URL('https://example.com/start'), address: '93.184.216.34', family: 4 })
    .mockResolvedValueOnce({ url: new URL('https://www.example.com/page'), address: '93.184.216.34', family: 4 });
  jest.spyOn(axios, 'get')
    .mockResolvedValueOnce({ status: 302, headers: { location: 'https://www.example.com/page' }, data: Buffer.alloc(0) } as any)
    .mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, data: Buffer.from('<h1>正文</h1><p>内容</p>') } as any);
  await expect((service as any).fetchRemoteUrl('https://example.com/start')).resolves.toMatchObject({
    content: expect.stringContaining('# 正文'),
    metadata: expect.objectContaining({ redirectCount: 1, finalUrl: 'https://www.example.com/page' }),
  });
  expect(validate).toHaveBeenCalledTimes(2);
});

it('rejects a redirect when the next hop resolves to a private address', async () => {
  jest.spyOn(service as any, 'validateRemoteUrl')
    .mockResolvedValueOnce({ url: new URL('https://example.com'), address: '93.184.216.34', family: 4 })
    .mockRejectedValueOnce(new BadRequestException('Private network URLs are not allowed'));
  jest.spyOn(axios, 'get').mockResolvedValueOnce({ status: 302, headers: { location: 'http://127.0.0.1/admin' }, data: Buffer.alloc(0) } as any);
  await expect((service as any).fetchRemoteUrl('https://example.com')).rejects.toThrow('Private network');
});
```

- [ ] **Step 3: Verify RED**

Run:

```bash
pnpm --filter @agentwiki/server test -- knowledge-pipeline/remote-source.spec.ts knowledge-pipeline/source.service.spec.ts
```

Expected: FAIL because extraction helpers and `fetchRemoteUrl` do not exist.

- [ ] **Step 4: Implement deterministic HTML-to-text extraction**

`extractHtmlText` must remove comments/script/style/noscript/svg, convert headings to Markdown headings, list items to `- `, block boundaries to newlines, strip remaining tags, decode the five common HTML entities plus numeric entities, collapse horizontal whitespace, and cap consecutive blank lines at two. Do not add a DOM dependency.

```ts
export function isSupportedTextContentType(value: string): boolean {
  const type = value.split(';', 1)[0].trim().toLowerCase();
  return type.startsWith('text/') || type === 'application/json' || type === 'application/xml' || type.endsWith('+json') || type.endsWith('+xml');
}
```

- [ ] **Step 5: Implement bounded revalidated redirects**

Add `fetchRemoteUrl` with `MAX_REMOTE_REDIRECTS = 5`. Each loop calls `validateRemoteUrl(currentUrl)`, creates a DNS-pinned HTTP/HTTPS agent, calls Axios with `responseType: 'arraybuffer'`, `maxRedirects: 0`, `validateStatus: status => status >= 200 && status < 400`, and resolves relative `Location` using `new URL(location, target.url)`. Reject missing Location, sixth redirect, unsupported content type, invalid UTF-8, empty extracted body, and content over 10 MiB.

Replace the current `source.type === 'url'` branch with:

```ts
if (source.type === 'url') return this.fetchRemoteUrl(source.uri);
```

When completing the Run, persist only safe diagnostics from `fetched.metadata` in `result.sourceMetadata`: `finalUrl`, `contentType`, and `redirectCount`. Add a `RunsPage` test and rendering that shows these fields for URL runs and uses `apiErrorMessage` for load/action failures; never include fetched body content or DNS addresses in the result.

- [ ] **Step 6: Verify and commit**

Run:

```bash
pnpm --filter @agentwiki/server test -- knowledge-pipeline/remote-source.spec.ts knowledge-pipeline/source.service.spec.ts
pnpm --filter @agentwiki/client test -- src/features/source/RunsPage.spec.tsx
pnpm --filter @agentwiki/server typecheck
git add apps/server/src/knowledge-pipeline/remote-source* apps/server/src/knowledge-pipeline/source.service.ts apps/server/src/knowledge-pipeline/source.service.spec.ts apps/client/src/features/source/RunsPage.tsx apps/client/src/features/source/RunsPage.spec.tsx
git commit -m "fix(source): ingest redirected HTML URLs safely"
```

Expected: URL suites PASS, private redirect test PASS, and typecheck exits 0.

---

### Task 6: Human Space Admin Content Permission

**Files:**
- Modify: `apps/server/src/core/authorization/authorization.service.ts`
- Modify: `apps/server/src/core/authorization/authorization.service.spec.ts`
- Modify: `apps/server/src/core/authorization/authorization.http.integration.spec.ts`
- Modify: `apps/server/src/knowledge-pipeline/source.service.ts`
- Modify: `apps/server/src/knowledge-pipeline/source.service.spec.ts`

**Interfaces:**
- Consumes: existing call sites that require `['owner', 'editor']` for content writes.
- Produces: human admins satisfy any role gate that already admits editors; Agent grants do not gain admin implication; owner-only review gates remain unchanged.

- [ ] **Step 1: Write failing hierarchy tests**

```ts
it('lets a human admin satisfy an editor content gate', async () => {
  prisma.spaceMember.findUnique.mockResolvedValue({ role: 'admin', space: { deletedAt: null } });
  await expect(service.assertSpaceAccess(
    { userId: 'admin-1' }, 'space-1', ['owner', 'editor'], 'pages:write',
  )).resolves.toMatchObject({ role: 'admin' });
});

it('does not let an Agent admin-shaped grant bypass an editor gate', async () => {
  prisma.agentGrant.findUnique.mockResolvedValue({
    role: 'admin', scopes: ['pages:write'],
    agent: { status: 'active', revokedAt: null }, space: { deletedAt: null },
  });
  await expect(service.assertSpaceAccess(
    { userId: 'owner-1', agentId: 'agent-1', scopes: ['pages:write'] },
    'space-1', ['owner', 'editor'], 'pages:write',
  )).rejects.toMatchObject({ statusCode: 403 });
});

it('keeps owner-only review gates owner-only for human admins', async () => {
  prisma.spaceMember.findUnique.mockResolvedValue({ role: 'admin', space: { deletedAt: null } });
  await expect(service.assertSpaceAccess(
    { userId: 'admin-1' }, 'space-1', ['owner'], 'review:decide',
  )).rejects.toMatchObject({ statusCode: 403 });
});
```

Add a SourceService queued-run test proving a human admin remains authorized when an editor-level Run was queued.

Add an HTTP probe case by teaching the test JWT/Auth stubs an `admin-token`, returning an active human principal, mocking its membership as `{ role: 'admin' }`, and asserting `POST /permission-probe/space-1` returns 200. This verifies the same guard/service chain used by page deletion.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @agentwiki/server test -- core/authorization/authorization.service.spec.ts core/authorization/authorization.http.integration.spec.ts knowledge-pipeline/source.service.spec.ts
```

Expected: the human-admin content tests FAIL while owner-only and Agent tests stay denied.

- [ ] **Step 3: Implement human-only editor implication**

In `assertSpaceAccess`, after principal normalization:

```ts
const effectiveAllowedRoles: SpaceRole[] = !principal.agentId
  && allowedRoles.includes('editor')
  && !allowedRoles.includes('admin')
  ? [...allowedRoles, 'admin']
  : allowedRoles;
```

Use `effectiveAllowedRoles` only for the human `SpaceMember` branch. Keep the Agent branch on the original `allowedRoles`. In `SourceService.assertRequesterStillAuthorized`, admit `admin` alongside `owner`/`editor` for human queued runs.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @agentwiki/server test -- core/authorization/authorization.service.spec.ts core/authorization/authorization.http.integration.spec.ts knowledge-pipeline/source.service.spec.ts
git add apps/server/src/core/authorization apps/server/src/knowledge-pipeline/source.service.ts apps/server/src/knowledge-pipeline/source.service.spec.ts
git commit -m "fix(authz): let human space admins manage content"
```

Expected: human admin tests PASS; Agent admin-shaped and owner-only review tests remain denied.

---

### Task 7: Editor Wrapping, Assist Session Safety, and Version Preview

**Files:**
- Modify: `apps/client/src/components/MarkdownWorkspace.tsx`
- Modify: `apps/client/src/components/MarkdownWorkspace.spec.tsx`
- Modify: `apps/client/src/features/page/AgentAssistPanel.tsx`
- Modify: `apps/client/src/features/page/AgentAssistPanel.spec.tsx`
- Create: `apps/client/src/features/page/PageVersionHistory.spec.tsx`
- Modify: `apps/client/src/features/page/PageVersionHistory.tsx`
- Modify: `apps/client/src/i18n/messages.ts`

**Interfaces:**
- Produces: CodeMirror line wrapping; session-local eligible Assist task ids; accessible version preview using existing `Markdown`.
- Consumes: POST `/assist/tasks` response containing task `id`, GET history tasks, and existing PageVersion content.

- [ ] **Step 1: Write the failing line-wrap test**

```tsx
it('enables CodeMirror line wrapping in edit mode', () => {
  const { container } = renderWYS({ initial: '很长的中文内容'.repeat(100) });
  expect(container.querySelector('.cm-lineWrapping')).toBeTruthy();
});
```

- [ ] **Step 2: Write failing Assist remount tests**

```tsx
it('shows historical completed tasks without applying them', async () => {
  const onApply = vi.fn();
  vi.mocked(api.get).mockImplementation((url) => Promise.resolve({ data: url === '/assist/tasks' ? [successfulTask] : [] }));
  renderPanel({ onApply });
  expect(await screen.findByText('Generated')).toBeInTheDocument();
  expect(onApply).not.toHaveBeenCalled();
});

it('applies only a task submitted during this mount and only once', async () => {
  const onApply = vi.fn();
  vi.mocked(api.post).mockResolvedValue({ data: { id: 'task-new', status: 'queued' } });
  vi.mocked(api.get).mockImplementation((url) => Promise.resolve({
    data: url === '/assist/tasks' ? [{ ...successfulTask, id: 'task-new' }] : [],
  }));
  renderPanel({ onApply });
  fireEvent.change(screen.getByTestId('assist-intent'), { target: { value: 'Rewrite' } });
  fireEvent.click(screen.getByTestId('assist-submit'));
  await waitFor(() => expect(onApply).toHaveBeenCalledWith('# Improved'));
  fireEvent.click(screen.getByLabelText('refresh'));
  await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
});
```

- [ ] **Step 3: Write the failing version preview test**

```tsx
it('previews a historical Markdown version without restoring it', async () => {
  renderHistory();
  fireEvent.click(await screen.findByRole('button', { name: '预览 v1' }));
  expect(screen.getByRole('heading', { name: '旧标题' })).toBeInTheDocument();
  expect(screen.getByText('旧正文')).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
  expect(screen.queryByText('旧正文')).not.toBeInTheDocument();
});
```

- [ ] **Step 4: Verify RED**

Run:

```bash
pnpm --filter @agentwiki/client test -- src/components/MarkdownWorkspace.spec.tsx src/features/page/AgentAssistPanel.spec.tsx src/features/page/PageVersionHistory.spec.tsx
```

Expected: line-wrap, historical non-apply, and preview tests FAIL.

- [ ] **Step 5: Enable CodeMirror wrapping**

Add `EditorView.lineWrapping` to the `extensions` array:

```tsx
extensions={[
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  syntaxHighlighting(livePreviewStyle),
  buildHiddenMarksPlugin(pages),
  EditorView.lineWrapping,
]}
```

- [ ] **Step 6: Gate Assist auto-apply to this mount's submissions**

Add:

```ts
const eligibleTaskIdsRef = useRef(new Set<string>());
```

In `loadTasks`, auto-apply only when both sets allow it:

```ts
if (task.status === 'done' && task.result?.changes
  && eligibleTaskIdsRef.current.has(task.id)
  && !appliedRef.current.has(task.id)) {
  appliedRef.current.add(task.id);
  onApply(task.result.changes);
}
```

In `submit`, capture the returned task before loading:

```ts
const created = await api.post('/assist/tasks', requestBody);
eligibleTaskIdsRef.current.add(created.data.id);
```

Do not persist this set; remounting intentionally forgets eligibility.

- [ ] **Step 7: Add version preview with existing Markdown renderer**

Import `Eye`, `X`, and `Markdown`; store `previewVersionId`. Give each preview button an accessible name containing the displayed version number. Render a fixed or inline panel:

```tsx
{previewVersion ? (
  <div role="dialog" aria-label={t('version.previewTitle', { version: previewNumber })} className="fixed inset-0 z-50 bg-black/30 p-4">
    <div className="mx-auto max-h-[90vh] max-w-3xl overflow-auto rounded-xl bg-white p-6">
      <button aria-label={t('version.closePreview')} onClick={() => setPreviewVersionId(null)}><X /></button>
      <h2 className="text-xl font-semibold">{previewVersion.title}</h2>
      <div className="mt-4"><Markdown>{previewVersion.content || ''}</Markdown></div>
    </div>
  </div>
) : null}
```

- [ ] **Step 8: Verify and commit**

Run:

```bash
pnpm --filter @agentwiki/client test -- src/components/MarkdownWorkspace.spec.tsx src/features/page/AgentAssistPanel.spec.tsx src/features/page/PageVersionHistory.spec.tsx src/features/page/PageEditor.spec.tsx
git add apps/client/src/components/MarkdownWorkspace* apps/client/src/features/page/AgentAssistPanel* apps/client/src/features/page/PageVersionHistory* apps/client/src/i18n/messages.ts
git commit -m "fix(editor): protect assist state and preview versions"
```

Expected: all focused editor tests PASS.

---

### Task 8: Review Count, Priority, Action Feedback, and State Refresh

**Files:**
- Create: `apps/client/src/features/review/review-events.ts`
- Modify: `apps/server/src/review/review.controller.ts`
- Modify: `apps/server/src/review/review.service.ts`
- Modify: `apps/server/src/review/review.service.spec.ts`
- Modify: `apps/client/src/components/Navbar.tsx`
- Modify: `apps/client/src/components/Navbar.spec.tsx`
- Modify: `apps/client/src/features/review/ReviewPage.tsx`
- Modify: `apps/client/src/features/review/ReviewPage.spec.tsx`
- Modify: `apps/client/src/i18n/messages.ts`

**Interfaces:**
- Produces: `GET /api/review/count -> { pending: number }`; `REVIEW_CHANGED_EVENT = 'agentwiki:review-changed'`.
- Consumes: `Toast` and `apiErrorMessage` from Task 1.

- [ ] **Step 1: Write failing service count and ordering tests**

```ts
it('counts only pending review sets in accessible spaces', async () => {
  prisma.changeSet.count.mockResolvedValue(2);
  await expect(service.countPending(['space-1', 'space-2'])).resolves.toEqual({ pending: 2 });
  expect(prisma.changeSet.count).toHaveBeenCalledWith({
    where: { spaceId: { in: ['space-1', 'space-2'] }, status: 'pending_review' },
  });
});

it('orders pending and approved work before historical states, newest first within status', async () => {
  prisma.changeSet.findMany.mockResolvedValue([
    { id: 'published', status: 'published', createdAt: new Date('2026-08-19T10:00:00Z') },
    { id: 'pending-old', status: 'pending_review', createdAt: new Date('2026-08-19T09:00:00Z') },
    { id: 'pending-new', status: 'pending_review', createdAt: new Date('2026-08-19T11:00:00Z') },
  ]);
  await expect(service.list(['space-1'])).resolves.toMatchObject([
    { id: 'pending-new' }, { id: 'pending-old' }, { id: 'published' },
  ]);
});
```

- [ ] **Step 2: Write failing Navbar auto-refresh tests**

```tsx
it('refreshes the pending badge on focus, custom event, and polling', async () => {
  vi.useFakeTimers();
  apiMock.get
    .mockResolvedValueOnce({ data: { pending: 0 } })
    .mockResolvedValueOnce({ data: { pending: 2 } })
    .mockResolvedValueOnce({ data: { pending: 3 } })
    .mockResolvedValueOnce({ data: { pending: 4 } });
  renderNavbar();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByText('2')).toBeInTheDocument();
  await act(async () => window.dispatchEvent(new Event(REVIEW_CHANGED_EVENT)));
  expect(await screen.findByText('3')).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(await screen.findByText('4')).toBeInTheDocument();
  vi.useRealTimers();
});
```

- [ ] **Step 3: Write failing Review action UX tests**

```tsx
it('disables approve-only until every candidate is decided', async () => {
  renderReview();
  await expand();
  expect(screen.getByRole('button', { name: 'Approve only' })).toBeDisabled();
  expect(screen.getByText('Decide every candidate before approving only.')).toBeInTheDocument();
});

it('shows a localized fixed toast and refreshes stale detail on a CAS conflict', async () => {
  vi.mocked(api.post).mockRejectedValue({ response: { status: 409, data: {
    code: 'CHANGESET_INVALID_STATE', message: 'Change set is not pending review',
  } } });
  renderReview('zh-CN');
  await expand();
  fireEvent.click(screen.getByRole('button', { name: '通过并发布' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('审核状态已变化，已为你刷新');
  expect(screen.queryByText('Change set is not pending review')).not.toBeInTheDocument();
  expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/change-sets/cs-1')).toHaveLength(2);
});
```

- [ ] **Step 4: Verify RED**

Run:

```bash
pnpm --filter @agentwiki/server test -- review/review.service.spec.ts
pnpm --filter @agentwiki/client test -- src/components/Navbar.spec.tsx src/features/review/ReviewPage.spec.tsx
```

Expected: count, priority, polling, disabled approve, and toast tests FAIL.

- [ ] **Step 5: Add count and stable priority sorting**

Add to `ReviewService`:

```ts
countPending(spaceIds: string[]) {
  return this.prisma.changeSet.count({
    where: { spaceId: { in: spaceIds }, status: 'pending_review' },
  }).then((pending) => ({ pending }));
}
```

After `findMany`, sort with:

```ts
const priority: Record<string, number> = {
  pending_review: 0, approved: 1, published: 2, rejected: 3, reverted: 4,
};
return rows.sort((a, b) =>
  (priority[a.status] ?? 99) - (priority[b.status] ?? 99)
  || b.createdAt.getTime() - a.createdAt.getTime());
```

Add `@Get('review/count')` to the controller; it obtains accessible review spaces exactly like list and calls `countPending`.

- [ ] **Step 6: Poll the lightweight count safely**

Create:

```ts
export const REVIEW_CHANGED_EVENT = 'agentwiki:review-changed';
export const announceReviewChanged = () => window.dispatchEvent(new Event(REVIEW_CHANGED_EVENT));
```

Navbar `loadReviewCount` calls `/review/count`, updates only on success, and is triggered on mount, 5-second interval, window focus, `visibilitychange` when visible, route changes, and `REVIEW_CHANGED_EVENT`. Clean up every listener and timer.

- [ ] **Step 7: Make Review actions state-aware and visible**

Compute `hasPendingItems`, disable Approve only when true, show the explanatory string, and show `Toast` for success/error. On action failure with status 409 or business code `CHANGESET_INVALID_STATE`, call `expandChangeSet(id)` before finishing. On every successful action/decision call both `expandChangeSet(id)` and `load()`, then `announceReviewChanged()`.

Use `apiErrorMessage(requestError, t, 'review.actionFailed')`; remove raw `response.data.message` rendering. Keep request buttons disabled while mutating and change their labels to localized in-progress copy.

- [ ] **Step 8: Verify and commit**

Run:

```bash
pnpm --filter @agentwiki/server test -- review/review.service.spec.ts
pnpm --filter @agentwiki/client test -- src/components/Navbar.spec.tsx src/features/review/ReviewPage.spec.tsx
git add apps/server/src/review apps/client/src/components/Navbar* apps/client/src/features/review apps/client/src/i18n/messages.ts
git commit -m "fix(review): refresh pending work and surface action results"
```

Expected: count/order and client refresh/action suites PASS.

---

### Task 9: Restore Soft-Deleted Source Pages During Publication

**Files:**
- Modify: `apps/server/src/review/review.service.ts`
- Modify: `apps/server/src/review/review.service.spec.ts`
- Modify: `apps/server/src/core/filters/business-error.ts`
- Modify: `apps/client/src/i18n/messages.ts`

**Interfaces:**
- Consumes: accepted `create_page` payload with `sourceId` and `sourcePath`.
- Produces: restore-in-place semantics for matching archived Page; stable `CHANGESET_CONFLICT` for an unexpected active duplicate.

- [ ] **Step 1: Write the failing resurrection test**

```ts
it('restores the archived page with the same source identity instead of creating a duplicate', async () => {
  prisma.changeSet.findUnique.mockResolvedValue({
    id: 'cs-restore', status: 'approved', spaceId: 'space-1', createdByUserId: 'user-1', createdByAgentId: null,
    items: [{ id: 'item-1', type: 'create_page', status: 'accepted', payload: {
      title: '图片内容总结.md', content: '# 新正文', format: 'markdown',
      sourceId: 'source-1', sourceVersionId: 'version-2', sourcePath: '__root__',
    } }], approvals: [], space: {}, run: { id: 'run-1' },
  });
  const archived = {
    id: 'page-old', knowledgeKey: 'knowledge-old', authorId: 'user-1',
    title: '旧标题', slug: 'old', content: '# 旧正文', format: 'markdown', parentId: null,
    syncPath: 'pages/p-old.md', syncPathKey: 'pages/p-old.md', deletedAt: new Date(),
    sourceChangeSetId: 'cs-old', createdByAgentId: null, lastChangeSetId: 'cs-old',
  };
  const tx = pagePublishHarness();
  tx.page.findFirst.mockResolvedValue(archived);
  tx.page.update.mockResolvedValue({ ...archived, deletedAt: null });
  prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
  await service.publish('cs-restore');
  expect(tx.page.create).not.toHaveBeenCalled();
  expect(tx.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ pageId: 'page-old', title: '旧标题', content: '# 旧正文' }),
  }));
  expect(tx.page.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'page-old' },
    data: expect.objectContaining({ deletedAt: null, title: '图片内容总结.md', sourceVersionId: 'version-2' }),
  }));
  expect(tx.changeItem.update).toHaveBeenLastCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'published', publishedResourceId: 'page-old' }),
  }));
});
```

- [ ] **Step 2: Write the failing active-duplicate business error test**

```ts
it('returns a stable conflict when an active source page already occupies the identity', async () => {
  const tx = pagePublishHarness();
  tx.page.findFirst.mockResolvedValue({ id: 'page-active', deletedAt: null });
  prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
  await expect(service.publish('cs-duplicate')).rejects.toMatchObject({
    businessCode: 'CHANGESET_CONFLICT', statusCode: 409,
  });
  expect(tx.page.create).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Verify RED**

Run:

```bash
pnpm --filter @agentwiki/server test -- review/review.service.spec.ts
```

Expected: resurrection tests FAIL because `create_page` always calls `page.create`.

- [ ] **Step 4: Implement restore-in-place before create**

Inside the `create_page` branch, when `payload.sourceId` and `payload.sourcePath` are strings, query:

```ts
const existingSourcePage = await tx.page.findFirst({
  where: {
    spaceId: changeSet.spaceId,
    sourceId: payload.sourceId,
    sourcePath: payload.sourcePath,
  },
});
```

If active, throw `new BusinessException('CHANGESET_CONFLICT', 'An active page already exists for this source path')`. If archived, create a PageVersion from its current state, update the ChangeItem payload with `before: { deletedAt: existingSourcePage.deletedAt }`, then update the same Page id with new title/content/format/parent/source version, `deletedAt: null`, current ChangeSet provenance and modifier fields. Reuse its `knowledgeKey`, slug, `syncPath`, and `syncPathKey`; do not generate a second identity. Otherwise retain the existing create path.

The existing create-page revert semantics then re-archive this restored page because the current ChangeSet becomes `sourceChangeSetId` and `lastChangeSetId`.

- [ ] **Step 5: Translate the stable conflict and verify**

Map `CHANGESET_CONFLICT` to “同一来源页面已存在或已在其他操作中更新，请刷新后重试” / “The source page already exists or changed in another operation. Refresh and retry.” through Task 1's mapping.

Run:

```bash
pnpm --filter @agentwiki/server test -- review/review.service.spec.ts
pnpm --filter @agentwiki/server typecheck
git add apps/server/src/review/review.service.ts apps/server/src/review/review.service.spec.ts apps/server/src/core/filters/business-error.ts apps/client/src/i18n/messages.ts
git commit -m "fix(review): restore archived source pages on republish"
```

Expected: resurrection and active-conflict tests PASS with no P2002 leak.

---

### Task 10: Full Regression, Build, and 18-Item Acceptance Audit

**Files:**
- Create: `docs/verification/agentwikiq-remediation-2026-08-19.md`
- Modify if needed: only files already changed by Tasks 1–9 to correct verified regressions.

**Interfaces:**
- Consumes: every test and completion criterion in the approved design.
- Produces: durable evidence mapping findings 1–18 to tests and fresh command output.

- [ ] **Step 1: Run focused cross-feature regressions**

Run:

```bash
pnpm --filter @agentwiki/client test -- \
  src/features/auth/Login.spec.tsx \
  src/features/admin/AdminPage.spec.tsx \
  src/features/about/UsageGuide.spec.tsx \
  src/features/guide/ObsidianGuide.spec.tsx \
  src/features/source/SourcesPage.spec.tsx \
  src/components/MarkdownWorkspace.spec.tsx \
  src/features/page/AgentAssistPanel.spec.tsx \
  src/features/page/PageVersionHistory.spec.tsx \
  src/components/Navbar.spec.tsx \
  src/features/review/ReviewPage.spec.tsx

pnpm --filter @agentwiki/server test -- \
  core/auth/auth.service.spec.ts \
  platform-admin/platform-admin.service.spec.ts \
  core/authorization/authorization.service.spec.ts \
  knowledge-pipeline/source-upload.spec.ts \
  knowledge-pipeline/remote-source.spec.ts \
  knowledge-pipeline/source.service.spec.ts \
  review/review.service.spec.ts
```

Expected: all selected suites PASS, zero skipped tests introduced.

- [ ] **Step 2: Run complete repository gates**

Run in order:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

Expected: every command exits 0. Read the full output and record exact test counts; do not infer one gate from another.

- [ ] **Step 3: Perform browser acceptance on both languages**

Use the local app with isolated test data and verify:

```text
ZH: invalid login -> Chinese message
ZH: reset dialog -> exact email + combined copy
ZH: upload 中文.md -> visible filename + upload action
ZH: public redirected HTML URL -> readable candidate
ZH: long editor line -> wraps
ZH: reopen assist -> historical result does not replace saved content
ZH: version history -> preview opens without restore
ZH: run creates pending review -> badge appears without navigation refresh
ZH: pending item -> appears above historical items
ZH: long review item -> failed action toast remains in viewport
EN: repeat login, source upload, version preview, and review toast copy
```

Expected: all observations match the approved design. Do not use production accounts or production data.

- [ ] **Step 4: Write the verification report**

Create `docs/verification/agentwikiq-remediation-2026-08-19.md` with:

```markdown
# AgentWikiQ remediation verification — 2026-08-19

## Scope
Findings 1–18 from `测试报告/AgentWikiQ/问题清单.md`.

## Automated gates
| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm test` | PASS | exact suite/test totals from fresh output |
| `pnpm typecheck` | PASS | exit 0 |
| `pnpm lint` | PASS | exit 0 |
| `pnpm build` | PASS | exit 0 |

## Finding matrix
| # | Fix | Automated evidence | Browser evidence |
| --- | --- | --- | --- |
| 1 | Exact reset account identity | test name | observed route/action |
```

Fill all 18 rows with actual test names and observations; do not leave template text in the committed report.

- [ ] **Step 5: Re-read the approved design line by line**

Compare every “逐条完成判定” row in `docs/superpowers/specs/2026-08-19-agentwikiq-test-report-remediation-design.md` to code, automated tests, and browser evidence. If any row lacks evidence, return to the responsible task before claiming completion.

- [ ] **Step 6: Commit verification evidence**

```bash
git add docs/verification/agentwikiq-remediation-2026-08-19.md
git commit -m "docs: verify AgentWikiQ remediation"
```

Expected: the commit contains only the completed verification report.
