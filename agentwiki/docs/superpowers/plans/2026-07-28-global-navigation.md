# Global Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the home page, usage guide, and workspace one consistent, always-available navigation model with an explicit unauthenticated workspace flow.

**Architecture:** Add one `GlobalNavigation` component that owns the three top-level destinations, authentication-sensitive workspace URL, active state, accessible labels, and responsive density. Reuse it in the public headers and authenticated navbar; let `ProductPage` handle the login intent while `ProtectedRoute` emits that same intent for unauthenticated protected routes.

**Tech Stack:** React 18, React Router 6, TypeScript, Tailwind CSS, Lucide React, Vitest, Testing Library, pnpm, Node.js 26

## Global Constraints

- AgentWiki Logo always links to `/`.
- The three top-level destinations are Home `/`, Guide `/guide`, and Workspace `/dashboard`.
- Unauthenticated Workspace links target `/?intent=workspace#login`.
- `ProtectedRoute` uses the same intent URL with `replace`.
- The workspace keeps Agents, Review, Search, Language, Profile, Integrations, and Log out.
- Do not render a duplicate Spaces link beside Workspace because both target `/dashboard`.
- Remove duplicate Guide and About items from the personal menu.
- New visible copy must exist in Simplified Chinese and English through `LanguageContext`.
- Preserve the current white, gray, and blue product visual language; add no dependency or component system.
- Run pnpm commands from `agentwiki/` and Git commands from the outer repository root.

---

### Task 1: Shared Global Navigation

**Files:**
- Create: `apps/client/src/components/GlobalNavigation.tsx`
- Create: `apps/client/src/components/GlobalNavigation.spec.tsx`
- Modify: `apps/client/src/i18n/messages.ts:28-36,290-298`

**Interfaces:**
- Consumes: `useAuth(): { token: string | null }`, `useLanguage().t`, and `useLocation().pathname`.
- Produces: `GlobalNavigation({ density?: 'public' | 'workspace' }): JSX.Element`.
- Produces translation keys: `nav.primary`, `nav.home`, `nav.dashboard`, and `auth.workspacePrompt`.

- [x] **Step 1: Add failing tests for destinations and active state**

Create `GlobalNavigation.spec.tsx` with a mutable Auth mock and route harness:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../context/LanguageContext';
import { GlobalNavigation } from './GlobalNavigation';

const authState = vi.hoisted(() => ({ token: null as string | null }));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ token: authState.token }),
}));

const renderNavigation = (path: string) => render(
  <LanguageProvider>
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <GlobalNavigation />
    </MemoryRouter>
  </LanguageProvider>,
);

describe('GlobalNavigation', () => {
  beforeEach(() => {
    authState.token = null;
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
  });

  it('shows all three destinations and sends signed-out users to the login intent', () => {
    renderNavigation('/guide');
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '首页' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '使用指南' })).toHaveAttribute('href', '/guide');
    expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('href', '/?intent=workspace#login');
    expect(screen.getByRole('link', { name: '使用指南' })).toHaveAttribute('aria-current', 'page');
  });

  it('sends signed-in users directly to the workspace', () => {
    authState.token = 'token';
    renderNavigation('/dashboard');
    expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('aria-current', 'page');
  });
});
```

- [x] **Step 2: Run the focused test and verify RED**

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/GlobalNavigation.spec.tsx
```

Expected: FAIL because `GlobalNavigation.tsx` does not exist.

- [x] **Step 3: Add bilingual navigation messages**

Add the following entries to both language maps in `messages.ts`:

```ts
// en
'nav.primary': 'Primary navigation',
'nav.home': 'Home',
'nav.dashboard': 'Workspace',
'auth.workspacePrompt': 'Sign in to enter the workspace.',

// zh-CN
'nav.primary': '主导航',
'nav.home': '首页',
'nav.dashboard': '工作台',
'auth.workspacePrompt': '登录后进入工作台。',
```

- [x] **Step 4: Implement the shared component**

Create `GlobalNavigation.tsx`:

```tsx
import React from 'react';
import { BookOpen, Home, LayoutDashboard } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

export interface GlobalNavigationProps {
  density?: 'public' | 'workspace';
}

export const GlobalNavigation: React.FC<GlobalNavigationProps> = ({ density = 'public' }) => {
  const { token } = useAuth();
  const { t } = useLanguage();
  const { pathname } = useLocation();
  const labelClass = density === 'workspace' ? 'hidden xl:inline' : 'hidden sm:inline';
  const items = [
    { label: t('nav.home'), to: '/', active: pathname === '/', icon: Home },
    { label: t('nav.guide'), to: '/guide', active: pathname === '/guide', icon: BookOpen },
    { label: t('nav.dashboard'), to: token ? '/dashboard' : '/?intent=workspace#login', active: pathname === '/dashboard', icon: LayoutDashboard },
  ];

  return (
    <div aria-label={t('nav.primary')} role="navigation" className="flex items-center gap-1 sm:gap-2">
      {items.map(({ label, to, active, icon: Icon }) => (
        <Link
          key={label}
          to={to}
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          title={label}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${active ? 'bg-blue-50 font-medium text-blue-600' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
        >
          <Icon size={17} aria-hidden="true" />
          <span className={labelClass}>{label}</span>
        </Link>
      ))}
    </div>
  );
};
```

- [x] **Step 5: Run the focused test and verify GREEN**

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/GlobalNavigation.spec.tsx
```

Expected: 1 file and 2 tests pass.

- [x] **Step 6: Commit the shared component**

```bash
git add agentwiki/apps/client/src/components/GlobalNavigation.tsx \
  agentwiki/apps/client/src/components/GlobalNavigation.spec.tsx \
  agentwiki/apps/client/src/i18n/messages.ts
git commit -m "feat: add shared global navigation"
```

---

### Task 2: Explicit Unauthenticated Workspace Intent

**Files:**
- Create: `apps/client/src/features/about/ProductPage.spec.tsx`
- Create: `apps/client/src/App.spec.tsx`
- Modify: `apps/client/src/features/about/ProductPage.tsx:1-30,101-205`
- Modify: `apps/client/src/App.tsx:34-37`

**Interfaces:**
- Consumes: `GlobalNavigation` from Task 1 and `auth.workspacePrompt` from `messages.ts`.
- Produces: login target `/?intent=workspace#login` and login card anchor `id="login"`.
- Produces: exported `ProtectedRoute({ children }): JSX.Element` for focused routing tests.

- [x] **Step 1: Add a failing ProductPage intent test**

Create `ProductPage.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { ProductPage } from './ProductPage';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ token: null, login: vi.fn() }),
}));

describe('ProductPage workspace intent', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('explains the redirect and focuses email', () => {
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/?intent=workspace#login']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ProductPage />
        </MemoryRouter>
      </LanguageProvider>,
    );
    expect(screen.getByText('登录后进入工作台。')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('邮箱')).toHaveFocus();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Export and test `ProtectedRoute` redirect semantics**

Create `App.spec.tsx` with a hoisted token mock:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './App';

vi.mock('./context/AuthContext', () => ({ useAuth: () => ({ token: null }) }));

const LocationProbe = () => {
  const location = useLocation();
  return <p>{location.pathname + location.search + location.hash}</p>;
};

it('redirects signed-out protected routes to the workspace login intent', () => {
  render(
    <MemoryRouter initialEntries={['/dashboard']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/dashboard" element={<ProtectedRoute><p>private</p></ProtectedRoute>} />
        <Route path="/" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByText('/?intent=workspace#login')).toBeInTheDocument();
});
```

- [x] **Step 3: Run both tests and verify RED**

```bash
pnpm --filter @agentwiki/client exec vitest run src/features/about/ProductPage.spec.tsx src/App.spec.tsx
```

Expected: FAIL because the prompt/focus behavior is absent and `ProtectedRoute` is not exported with the new target.

- [x] **Step 4: Implement ProductPage intent behavior**

Update imports and state in `ProductPage.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const location = useLocation();
const loginCardRef = useRef<HTMLDivElement>(null);
const emailInputRef = useRef<HTMLInputElement>(null);
const workspaceIntent = new URLSearchParams(location.search).get('intent') === 'workspace';

useEffect(() => {
  if (!workspaceIntent || token) return;
  loginCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  emailInputRef.current?.focus({ preventScroll: true });
}, [token, workspaceIntent]);
```

Attach the anchor/ref and prompt to the signed-out card, and attach the input ref:

```tsx
<div id="login" ref={loginCardRef} className="bg-white rounded-xl shadow-lg border border-gray-200 p-8">
  {workspaceIntent ? (
    <div role="status" className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-center text-sm text-blue-700">
      {t('auth.workspacePrompt')}
    </div>
  ) : null}
  {/* existing tab switcher and form */}
</div>

<input ref={emailInputRef} type="email" ... />
```

- [x] **Step 5: Implement the protected redirect**

Update `App.tsx`:

```tsx
export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token } = useAuth();
  return token ? <>{children}</> : <Navigate to="/?intent=workspace#login" replace />;
};
```

- [x] **Step 6: Run both tests and verify GREEN**

```bash
pnpm --filter @agentwiki/client exec vitest run src/features/about/ProductPage.spec.tsx src/App.spec.tsx
```

Expected: 2 files and 2 tests pass.

- [x] **Step 7: Commit the intent flow**

```bash
git add agentwiki/apps/client/src/App.tsx \
  agentwiki/apps/client/src/App.spec.tsx \
  agentwiki/apps/client/src/features/about/ProductPage.tsx \
  agentwiki/apps/client/src/features/about/ProductPage.spec.tsx
git commit -m "feat: explain signed-out workspace redirects"
```

---

### Task 3: Use the Shared Navigation on All Three Surfaces

**Files:**
- Create: `apps/client/src/components/Navbar.spec.tsx`
- Modify: `apps/client/src/components/Navbar.tsx:1-62`
- Modify: `apps/client/src/features/about/ProductPage.tsx:101-125`
- Modify: `apps/client/src/features/about/ProductPage.spec.tsx`
- Modify: `apps/client/src/features/about/UsageGuide.tsx:65-87`
- Modify: `apps/client/src/features/about/UsageGuide.spec.tsx`

**Interfaces:**
- Consumes: `GlobalNavigation` from Task 1.
- Produces: three headers with the same top-level routes and a home-bound AgentWiki Logo.

- [x] **Step 1: Add failing integration assertions**

Extend `ProductPage.spec.tsx`:

```tsx
expect(screen.getByRole('link', { name: 'AgentWiki' })).toHaveAttribute('href', '/');
expect(screen.getByRole('link', { name: '首页' })).toBeInTheDocument();
expect(screen.getByRole('link', { name: '使用指南' })).toBeInTheDocument();
expect(screen.getByRole('link', { name: '工作台' })).toBeInTheDocument();
```

Extend `UsageGuide.spec.tsx` after `renderGuide()`:

```tsx
expect(screen.getByRole('link', { name: 'AgentWiki' })).toHaveAttribute('href', '/');
expect(screen.getByRole('link', { name: '首页' })).toBeInTheDocument();
expect(screen.getByRole('link', { name: '使用指南' })).toHaveAttribute('aria-current', 'page');
expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('href', '/?intent=workspace#login');
```

Create `Navbar.spec.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../context/LanguageContext';
import { Navbar } from './Navbar';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ token: 'token', user: { email: 'user@example.com' }, logout: vi.fn() }),
}));
vi.mock('../api/client', () => ({ default: { get: vi.fn().mockResolvedValue({ data: [] }) } }));

describe('Navbar global destinations', () => {
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'zh-CN'));

  it('shows top-level routes and removes their menu duplicates', async () => {
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/dashboard']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Navbar />
        </MemoryRouter>
      </LanguageProvider>,
    );
    expect(screen.getByRole('link', { name: 'AgentWiki' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '首页' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '智能体' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '审核' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '个人菜单' }));
    expect(screen.queryAllByRole('link', { name: '使用指南' })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: '关于' })).not.toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run the three integration tests and verify RED**

```bash
pnpm --filter @agentwiki/client exec vitest run src/features/about/ProductPage.spec.tsx src/features/about/UsageGuide.spec.tsx src/components/Navbar.spec.tsx
```

Expected: FAIL because the three surfaces still own inconsistent navigation.

- [x] **Step 3: Integrate ProductPage and UsageGuide**

In both files import `GlobalNavigation`. Make each Logo a Link to `/`, then render:

```tsx
<div className="flex items-center gap-2 sm:gap-3">
  <GlobalNavigation density="public" />
  <LanguageSwitcher />
</div>
```

Remove ProductPage's token-based Guide/Dashboard conditional and UsageGuide's standalone Back-to-home link. Keep the existing content and auth cards unchanged.

- [x] **Step 4: Integrate the authenticated Navbar**

Use `GlobalNavigation density="workspace"` after an AgentWiki Logo link whose `to` is `/`. Keep only the contextual Agent and Review links beside it:

```tsx
<Link to="/" aria-label="AgentWiki" className="text-xl font-bold text-blue-600 shrink-0">
  <span className="hidden lg:inline">AgentWiki</span>
  <span className="lg:hidden">AW</span>
</Link>
<GlobalNavigation density="workspace" />
<Link to="/agents" ...>{/* existing Agent content */}</Link>
<Link to="/review" ...>{/* existing Review content */}</Link>
```

Delete the `/dashboard` Spaces link and remove Guide/About from the personal menu. Remove now-unused `FolderOpen`, `Info`, and `BookOpen` imports.

- [x] **Step 5: Run the integration tests and verify GREEN**

```bash
pnpm --filter @agentwiki/client exec vitest run src/features/about/ProductPage.spec.tsx src/features/about/UsageGuide.spec.tsx src/components/Navbar.spec.tsx
```

Expected: 3 files pass with no duplicate Home, Guide, or Workspace entry.

- [x] **Step 6: Commit the three-surface integration**

```bash
git add agentwiki/apps/client/src/components/Navbar.tsx \
  agentwiki/apps/client/src/components/Navbar.spec.tsx \
  agentwiki/apps/client/src/features/about/ProductPage.tsx \
  agentwiki/apps/client/src/features/about/ProductPage.spec.tsx \
  agentwiki/apps/client/src/features/about/UsageGuide.tsx \
  agentwiki/apps/client/src/features/about/UsageGuide.spec.tsx
git commit -m "feat: unify home guide and workspace navigation"
```

---

### Task 4: Quality Gate and Browser Navigation QA

**Files:**
- Modify: `.codex-memory/current.md`
- Modify: `docs/superpowers/plans/2026-07-28-global-navigation.md`

**Interfaces:**
- Consumes: the completed navigation implementation.
- Produces: verified desktop/mobile navigation behavior and updated project handoff state.

- [x] **Step 1: Run the complete client quality gate under Node 26**

```bash
pnpm --filter @agentwiki/client test
pnpm lint
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/client build
git diff --check
```

Expected: all commands exit 0. Existing React Router future warnings and Vite chunk-size warnings may remain, but no test, lint, type, or build failure is allowed.

- [x] **Step 2: Verify signed-in desktop navigation with the Browser plugin**

Use the existing authenticated local browser session at `http://localhost:5173` and execute:

```text
/ → click 使用指南 → /guide
/guide → click 工作台 → /dashboard
/dashboard → click 首页 → /
```

At every route verify: correct URL/title, meaningful DOM, one active global item, no framework overlay, and no relevant console error/warning.

- [x] **Step 3: Verify signed-out workspace intent**

Use a signed-out browser state and execute:

```text
/guide → click 工作台 → /?intent=workspace#login
```

Verify the login card is in view, the email field is focused, and `登录后进入工作台。` is visible. Switch to English and verify `Sign in to enter the workspace.`.

- [x] **Step 4: Verify responsive navigation**

At desktop and 390×844 mobile viewports verify Home, Guide, and Workspace remain operable without horizontal overflow, clipping, overlap, or duplicated destinations. Capture focused screenshots outside the repository.

- [x] **Step 5: Update project state and plan checkboxes**

Update `.codex-memory/current.md` with the final navigation rules and tested states. Mark all plan checkboxes complete after their evidence exists.

- [ ] **Step 6: Commit, merge, and push**

```bash
git add .codex-memory/current.md \
  agentwiki/docs/superpowers/plans/2026-07-28-global-navigation.md
git commit -m "docs: record unified navigation verification"
git checkout master
git pull --ff-only origin master
git merge --ff-only codex/global-navigation
git push origin master
```

Expected: `origin/master` points to the verified merge commit, the temporary worktree is removed, and the feature branch is deleted.
