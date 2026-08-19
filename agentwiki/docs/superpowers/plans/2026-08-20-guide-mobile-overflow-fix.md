# Guide Mobile Overflow Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the `/guide` Step 4 gateway preview from widening a 390 px mobile viewport beyond the viewport width.

**Architecture:** Keep the existing guide layout and preview component. Constrain the Step 4 flex content item with Tailwind's `min-w-0`, allowing its existing descendants to shrink and truncate within the available width.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vitest, Testing Library, Playwright production smoke tests

## Global Constraints

- Keep the numbered step layout, copy, spacing, and gateway behavior unchanged.
- Modify only the Step 4 flex constraint and its focused regression test.
- Require `/guide` to satisfy `documentElement.scrollWidth <= clientWidth` at 390 px.
- Retain the existing production database and application rollback backups.

---

### Task 1: Constrain the Step 4 guide flex item

**Files:**
- Modify: `apps/client/src/features/about/UsageGuide.spec.tsx`
- Modify: `apps/client/src/features/about/UsageGuide.tsx:184`

**Interfaces:**
- Consumes: the existing `UsageGuide` Step 4 DOM structure and `GatewayGuidePreview` component.
- Produces: a Step 4 content flex item whose class list includes `min-w-0`.

- [ ] **Step 1: Write the failing regression test**

Add this assertion to the existing `presents a generic Agent flow with OpenCode as the verified example` test immediately after the Step 4 heading assertion:

```tsx
const gatewayStepHeading = screen.getByRole('heading', { name: '生成统一网关接入指令' });
expect(gatewayStepHeading.parentElement).toHaveClass('min-w-0');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run src/features/about/UsageGuide.spec.tsx -t 'presents a generic Agent flow'
```

Expected: FAIL because the heading parent has `flex-1` but does not have `min-w-0`.

- [ ] **Step 3: Apply the minimal implementation**

Change only the Step 4 content wrapper in `UsageGuide.tsx`:

```tsx
<div className="flex-1 min-w-0">
```

- [ ] **Step 4: Run focused verification and verify GREEN**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run src/features/about/UsageGuide.spec.tsx
```

Expected: all `UsageGuide.spec.tsx` tests pass.

- [ ] **Step 5: Run repository gates**

Run in this order:

```bash
pnpm --filter @agentwiki/client test
pnpm typecheck
pnpm lint
pnpm build
pnpm test
git diff --check
```

Expected: every command exits 0; database-backed runtime tests may retain the documented 39 skips when `DATABASE_URL` is absent.

- [ ] **Step 6: Commit and push the fix**

```bash
git add agentwiki/apps/client/src/features/about/UsageGuide.spec.tsx agentwiki/apps/client/src/features/about/UsageGuide.tsx agentwiki/docs/superpowers/plans/2026-08-20-guide-mobile-overflow-fix.md
git commit -m "fix(guide): prevent mobile gateway overflow"
git push origin master
```

Expected: `origin/master` advances to the new fix commit.

- [ ] **Step 7: Redeploy and verify production**

Run the existing direct deployment workflow against `root@113.249.120.24`, retaining these rollback artifacts:

```text
/root/backups/agentwiki/pre-agentwikiq-remediation-20260819235344.dump
/root/backups/agentwiki/pre-agentwikiq-remediation-app-20260819235344.tar.gz
```

Then run:

```bash
AGENTWIKI_SMOKE_E2E=1 \
AGENTWIKI_SMOKE_E2E_ALLOW_REMOTE=1 \
AGENTWIKI_SMOKE_E2E_CONFIRM_HOST=agentwiki.quukk.com \
AGENTWIKI_API_URL=https://agentwiki.quukk.com/api \
node scripts/smoke-test.mjs

AGENTWIKI_UI_ROUTE_E2E=1 \
AGENTWIKI_UI_ROUTE_E2E_ALLOW_REMOTE=1 \
AGENTWIKI_UI_ROUTE_E2E_CONFIRM_HOST=agentwiki.quukk.com \
AGENTWIKI_API_URL=https://agentwiki.quukk.com/api \
AGENTWIKI_WEB_URL=https://agentwiki.quukk.com \
node scripts/ui-route-smoke.mjs
```

Expected: API smoke reports 18 checks; UI smoke passes all public, authenticated, and mobile routes with no horizontal overflow, browser errors, or server 5xx responses.
