# Space Dashboard Pagination Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a newly created Space appear immediately and after refresh, while preserving access to Space lists longer than 20 records and showing creation failures inside the modal.

**Architecture:** Keep the existing paginated `GET /spaces` contract, but make its order deterministic and newest-first. The Dashboard consumes the `POST /spaces` response directly, tracks the server total, and appends subsequent pages with id-based de-duplication. Space creation authorization remains unchanged: human principals, including super admins, create an owner membership; Agents remain forbidden.

**Tech Stack:** React 18, React Testing Library, Vitest, Axios, NestJS 10, Prisma, Jest, TypeScript, Tailwind CSS.

## Global Constraints

- Do not add an `edit` permission requirement or a super-admin-only creation path.
- Keep server pagination with `take <= 100`; do not fetch every Space in one request.
- Sort Space pages by `createdAt desc`, then `id desc`.
- Use `POST /spaces` response data as the immediate UI source of truth.
- Use shared `apiErrorMessage`; do not render raw backend prose.
- Do not push, merge, migrate, publish, or deploy in this plan.

---

### Task 1: Deterministic Space Listing and Creation Authorization Regression

**Files:**
- Modify: `apps/server/src/core/space/space.service.ts`
- Modify: `apps/server/src/core/space/space.service.spec.ts`
- Create: `apps/server/src/core/space/space.controller.spec.ts`

**Interfaces:**
- Consumes: `SpaceService.findAll(accessibleSpaceIds: string[], skip?: number, take?: number)` and `SpaceController.create(dto, req)`.
- Produces: the unchanged paginated result `{ data, total, page, limit }`, with deterministic newest-first ordering.

- [ ] **Step 1: Add failing service tests for deterministic ordering and pagination metadata**

Add a focused describe block to `space.service.spec.ts`:

```ts
describe('SpaceService.findAll pagination', () => {
  const prisma = {
    space: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  } as any;
  const service = new SpaceService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('returns the requested page in deterministic newest-first order', async () => {
    prisma.space.findMany.mockResolvedValue([{ id: 'space-new' }]);
    prisma.space.count.mockResolvedValue(25);

    await expect(service.findAll(['space-new'], 20, 20)).resolves.toMatchObject({
      data: [{ id: 'space-new' }], total: 25, page: 2, limit: 20,
    });
    expect(prisma.space.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 20,
      take: 20,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
  });
});
```

- [ ] **Step 2: Add failing controller tests for super-admin human and Agent principals**

Create `space.controller.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { SpaceController } from './space.controller';

describe('SpaceController.create', () => {
  const spaces = { create: jest.fn() } as any;
  const controller = new SpaceController(spaces, {} as any);

  beforeEach(() => jest.clearAllMocks());

  it('lets a human super admin create a Space as themselves', async () => {
    spaces.create.mockResolvedValue({ id: 'space-new', name: '新空间' });
    await expect(controller.create(
      { name: '新空间' } as any,
      { user: { userId: 'admin-1', platformRole: 'super_admin', type: 'human' } } as any,
    )).resolves.toMatchObject({ id: 'space-new' });
    expect(spaces.create).toHaveBeenCalledWith({ name: '新空间' }, 'admin-1');
  });

  it('continues to reject Agent principals', () => {
    expect(() => controller.create(
      { name: 'Agent 空间' } as any,
      { user: { userId: 'owner-1', agentId: 'agent-1', type: 'agent' } } as any,
    )).toThrow(ForbiddenException);
    expect(spaces.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @agentwiki/server exec jest --runInBand core/space/space.service.spec.ts core/space/space.controller.spec.ts
```

Expected: controller tests pass against the existing authorization boundary; the service test fails because `orderBy` is absent. This proves the regression is pagination ordering rather than `edit` authorization.

- [ ] **Step 4: Add deterministic ordering to `SpaceService.findAll`**

Add the following field to the existing `space.findMany` query without changing its filters or includes:

```ts
orderBy: [
  { createdAt: 'desc' },
  { id: 'desc' },
],
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the command from Step 3.

Expected: both suites pass; the controller test confirms no Space membership/edit check was added.

- [ ] **Step 6: Commit the server fix**

```bash
git add apps/server/src/core/space/space.service.ts apps/server/src/core/space/space.service.spec.ts apps/server/src/core/space/space.controller.spec.ts
git commit -m "fix(space): order dashboard pages newest first"
```

---

### Task 2: Immediate Creation Result, Load More, and Visible Modal Errors

**Files:**
- Modify: `apps/client/src/features/dashboard/Dashboard.tsx`
- Create: `apps/client/src/features/dashboard/Dashboard.spec.tsx`
- Modify: `apps/client/src/i18n/messages.ts`

**Interfaces:**
- Consumes: `GET /spaces?skip=<number>&take=20` returning `{ data: Space[], total: number }`; `POST /spaces` returning the created `Space`.
- Produces: Dashboard state with `spaces`, `total`, `loadingMore`, `creating`, and `createError`; a localized `dashboard.loadMore` action.

- [ ] **Step 1: Write failing client tests for immediate creation, pagination, and modal errors**

Create `Dashboard.spec.tsx` with a mocked authenticated super admin and mocked API client:

```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { Dashboard } from './Dashboard';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin-1', name: 'Admin', platformRole: 'super_admin' } }),
}));

const spaces = Array.from({ length: 20 }, (_, index) => ({
  id: `space-${index}`,
  name: `空间 ${index}`,
  slug: `space-${index}`,
}));

const renderDashboard = () => render(
  <LanguageProvider><MemoryRouter><Dashboard /></MemoryRouter></LanguageProvider>,
);

describe('Dashboard Space pagination and creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    vi.mocked(api.get).mockResolvedValue({ data: { data: spaces, total: 25 } });
  });

  it('prepends the POST response without depending on a second list request', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { id: 'space-new', name: '新建空间', slug: 'new-space' },
    });
    renderDashboard();
    await screen.findByText('空间 0');

    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
    fireEvent.change(screen.getByPlaceholderText('例如：我的知识库'), { target: { value: '新建空间' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByRole('heading', { name: '新建空间' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/spaces', { name: '新建空间', description: undefined });
  });

  it('loads and de-duplicates the next page when more Spaces exist', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { data: spaces, total: 22 } })
      .mockResolvedValueOnce({ data: { data: [spaces[19], { id: 'space-20', name: '空间 20', slug: 'space-20' }], total: 22 } });
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('空间 20')).toBeInTheDocument();
    expect(screen.getAllByText('空间 19')).toHaveLength(1);
    expect(api.get).toHaveBeenNthCalledWith(2, '/spaces', { params: { skip: 20, take: 20 } });
  });

  it('shows a localized creation failure inside the open dialog', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 500, data: { message: 'internal detail' } } });
    renderDashboard();
    await screen.findByText('空间 0');

    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
    const dialog = screen.getByRole('dialog', { name: '创建新空间' });
    fireEvent.change(within(dialog).getByPlaceholderText('例如：我的知识库'), { target: { value: '失败空间' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('空间创建失败');
    expect(within(dialog).getByRole('button', { name: '创建' })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run the Dashboard test and verify RED**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run src/features/dashboard/Dashboard.spec.tsx
```

Expected: failures show that the current component performs a second GET after creation, has no load-more action, and renders errors outside a semantic dialog.

- [ ] **Step 3: Implement paginated Dashboard state and id de-duplication**

In `Dashboard.tsx`:

```tsx
const PAGE_SIZE = 20;

const [total, setTotal] = useState(0);
const [loadingMore, setLoadingMore] = useState(false);
const [createError, setCreateError] = useState<string | null>(null);

const mergeSpaces = (current: Space[], incoming: Space[]) => {
  const seen = new Set(current.map((space) => space.id));
  return [...current, ...incoming.filter((space) => !seen.has(space.id))];
};

const fetchSpaces = async (reset = true) => {
  if (!reset) setLoadingMore(true);
  try {
    const skip = reset ? 0 : spaces.length;
    const res = await api.get('/spaces', { params: { skip, take: PAGE_SIZE } });
    setSpaces((current) => reset ? res.data.data || [] : mergeSpaces(current, res.data.data || []));
    setTotal(Number(res.data.total) || 0);
  } catch (err: unknown) {
    setError(apiErrorMessage(err, t, 'dashboard.loadFailed'));
  } finally {
    if (reset) setLoading(false);
    else setLoadingMore(false);
  }
};
```

Call `void fetchSpaces(true)` on mount. Add a load-more button below the grid when `spaces.length < total`:

```tsx
<button type="button" disabled={loadingMore} onClick={() => void fetchSpaces(false)}>
  {loadingMore ? t('dashboard.loadingMore') : t('dashboard.loadMore')}
</button>
```

- [ ] **Step 4: Consume the create response and render modal-local errors**

Replace the creation success path with:

```tsx
setCreateError(null);
const { data: created } = await api.post('/spaces', {
  name: newSpace.name.trim(),
  description: newSpace.description.trim() || undefined,
});
setSpaces((current) => [created, ...current.filter((space) => space.id !== created.id)]);
setTotal((current) => current + 1);
setNewSpace({ name: '', description: '' });
setShowCreate(false);
```

The server creates a new unique id for each successful request and the disabled submit button prevents duplicate requests, so `total` increments once per success. In the catch path, set `createError` through `apiErrorMessage`. Give the modal `role="dialog"`, `aria-modal="true"`, and `aria-labelledby="create-space-title"`; give its heading `id="create-space-title"`; and render:

```tsx
{createError ? <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{createError}</div> : null}
```

Opening and closing the modal clears `createError`.

- [ ] **Step 5: Add bilingual pagination strings**

Add to both language maps in `messages.ts`:

```ts
'dashboard.loadMore': 'Load more',
'dashboard.loadingMore': 'Loading more…',
```

and:

```ts
'dashboard.loadMore': '加载更多',
'dashboard.loadingMore': '正在加载…',
```

- [ ] **Step 6: Run the Dashboard test and verify GREEN**

Run the command from Step 2.

Expected: all Dashboard tests pass with no raw backend error text.

- [ ] **Step 7: Run the full client suite and commit**

Run:

```bash
pnpm --filter @agentwiki/client test
```

Expected: all client tests pass; existing jsdom CodeMirror/canvas limitations may emit the already-documented non-failing warnings.

Commit:

```bash
git add apps/client/src/features/dashboard/Dashboard.tsx apps/client/src/features/dashboard/Dashboard.spec.tsx apps/client/src/i18n/messages.ts
git commit -m "fix(dashboard): keep created Spaces visible"
```

---

### Task 3: Full Verification and Browser Acceptance

**Files:**
- Modify: `docs/verification/agentwikiq-remediation-2026-08-19.md`

**Interfaces:**
- Consumes: the final server/client behavior from Tasks 1 and 2.
- Produces: updated verification evidence for the Space creation regression.

- [ ] **Step 1: Run complete repository gates**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

Expected: every command exits 0. Record exact pass/skip counts rather than reusing prior totals.

- [ ] **Step 2: Exercise the rendered target flow**

Use the Browser workflow against an isolated local API/mock state containing more than 20 Spaces:

```text
/dashboard -> create Space -> modal closes -> new card appears first -> reload -> new card remains first -> load more -> older records append without duplicates
```

Also force a create failure and verify the localized alert remains visible inside the open modal. Check page identity, non-blank DOM, framework overlays, console warnings/errors, and screenshot evidence.

- [ ] **Step 3: Update verification evidence**

Append a “Space creation regression” section to `docs/verification/agentwikiq-remediation-2026-08-19.md` containing:

- Root cause: default 20-record page plus missing deterministic ordering.
- Permission conclusion: no `edit` requirement; human super admin remains allowed and becomes owner.
- Automated test names and exact counts.
- Browser interaction result and any environment limitations.

- [ ] **Step 4: Commit verification evidence**

```bash
git add docs/verification/agentwikiq-remediation-2026-08-19.md
git commit -m "docs: verify Space creation pagination fix"
```

- [ ] **Step 5: Request final code review**

Request an independent review of all commits after `0000f11`, with special attention to stale React state, duplicate pagination rows, deterministic ordering, authorization regression, error visibility, and test adequacy. Fix every Critical, Important, and valid Minor finding, then rerun the relevant gates.
