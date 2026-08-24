# Obsidian Navigation Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the standalone “Connect Obsidian” item from desktop and mobile global navigation while keeping Obsidian available inside the Usage Guide and through existing direct routes.

**Architecture:** Keep `/guide/obsidian` and every Obsidian workflow unchanged. Consolidate only global navigation: `/guide/obsidian` becomes a child state of the existing `/guide` destination, and the personal mobile menu no longer duplicates the guide entry.

**Tech Stack:** React 19, React Router, TypeScript, Testing Library, Vitest, Vite.

## Global Constraints

- Keep `/guide/obsidian`, `/settings/integrations` redirect behavior, safe login return paths, the Usage Guide’s “Obsidian Plugin” entry, and the Profile shortcut unchanged.
- Do not remove `nav.obsidian` translations because the Profile shortcut still consumes them.
- Do not change Obsidian installation, connection-code, credential, or device-management behavior.
- Preserve unrelated subproject changes, `agentwiki/.codebase-memory/`, and the separate Obsidian worktree.

---

### Task 1: Consolidate Obsidian into the Usage Guide navigation destination

**Files:**
- Modify: `agentwiki/apps/client/src/components/GlobalNavigation.spec.tsx`
- Modify: `agentwiki/apps/client/src/components/GlobalNavigation.tsx`
- Modify: `agentwiki/apps/client/src/components/Navbar.spec.tsx`
- Modify: `agentwiki/apps/client/src/components/Navbar.tsx`
- Verify: `agentwiki/apps/client/src/features/about/UsageGuide.spec.tsx`
- Verify: `agentwiki/apps/client/src/features/guide/ObsidianGuide.spec.tsx`
- Verify: `agentwiki/apps/client/src/features/auth/safeReturnTo.spec.ts`

**Interfaces:**
- Consumes: React Router `location.pathname` and the existing `/guide` and `/guide/obsidian` routes.
- Produces: one global `Usage Guide` destination whose active condition is `pathname.startsWith('/guide')`; no standalone global `Connect Obsidian` link.

- [ ] **Step 1: Write failing desktop and mobile navigation tests**

Replace the first two `GlobalNavigation` cases with assertions that the standalone destination is absent and the guide remains active on the Obsidian child route:

```tsx
it('shows one Usage Guide destination without a standalone Obsidian entry', () => {
  renderNavigation('/guide');

  expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '首页' })).toHaveAttribute('href', '/');
  expect(screen.getByRole('link', { name: '使用指南' })).toHaveAttribute('href', '/guide');
  expect(screen.queryByRole('link', { name: '连接 Obsidian' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('href', '/?intent=workspace#login');
  expect(screen.getByRole('link', { name: '使用指南' })).toHaveAttribute('aria-current', 'page');
});

it('keeps Usage Guide active on the Obsidian guide page', () => {
  renderNavigation('/guide/obsidian');

  expect(screen.queryByRole('link', { name: '连接 Obsidian' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '使用指南' })).toHaveAttribute('aria-current', 'page');
});
```

Extend the existing `Navbar` personal-menu case after opening the menu:

```tsx
expect(screen.queryByRole('link', { name: '连接 Obsidian' })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/client test -- src/components/GlobalNavigation.spec.tsx src/components/Navbar.spec.tsx
```

Expected: FAIL because `GlobalNavigation` and the personal menu still render “连接 Obsidian”, and `/guide/obsidian` does not mark “使用指南” active.

- [ ] **Step 3: Implement the minimal navigation change**

In `GlobalNavigation.tsx`, remove `Gem` from the icon import and replace the two guide-related items with one item:

```tsx
import { BookOpen, Home, LayoutDashboard } from 'lucide-react';

const items = [
  { label: t('nav.home'), to: '/', active: pathname === '/' && !workspaceIntent, icon: Home },
  { label: t('nav.guide'), to: '/guide', active: pathname.startsWith('/guide'), icon: BookOpen },
  {
    label: t('nav.dashboard'),
    to: token ? '/dashboard' : '/?intent=workspace#login',
    active: pathname === '/dashboard' || workspaceIntent,
    icon: LayoutDashboard,
  },
];
```

In `Navbar.tsx`, remove `Gem` from the icon import and delete only this personal-menu link:

```tsx
<Link onClick={() => setMenuOpen(false)} to="/guide/obsidian" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-gray-50"><Gem size={16} /> {t('nav.obsidian')}</Link>
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/client test -- src/components/GlobalNavigation.spec.tsx src/components/Navbar.spec.tsx
```

Expected: both files pass; the standalone entry is absent from desktop and personal/mobile navigation, and Usage Guide is active on `/guide/obsidian`.

- [ ] **Step 5: Verify preserved Obsidian access paths**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/client test -- src/features/about/UsageGuide.spec.tsx src/features/guide/ObsidianGuide.spec.tsx src/features/auth/safeReturnTo.spec.ts src/App.spec.tsx
```

Expected: all tests pass, proving the internal Usage Guide link, Obsidian page, safe return path, and route/redirect surface remain available.

- [ ] **Step 6: Run client release gates**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/client test
pnpm --filter @agentwiki/client build
git diff --check
```

Expected: TypeScript succeeds, all client test files pass, the Vite production build succeeds, and `git diff --check` reports no error.

- [ ] **Step 7: Update project state and commit**

Update `.codex-memory/current.md` so the stable navigation rule says Obsidian is reached through the Usage Guide rather than a standalone global destination. Then stage only the four component/test files and `current.md`:

```bash
git add \
  .codex-memory/current.md \
  agentwiki/apps/client/src/components/GlobalNavigation.tsx \
  agentwiki/apps/client/src/components/GlobalNavigation.spec.tsx \
  agentwiki/apps/client/src/components/Navbar.tsx \
  agentwiki/apps/client/src/components/Navbar.spec.tsx
git diff --cached --check
git commit -m "fix(navigation): consolidate Obsidian into usage guide"
```

Expected: one focused implementation commit; unrelated subprojects, `.codebase-memory`, and other worktrees remain unstaged.
