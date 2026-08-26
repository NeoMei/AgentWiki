# Markdown Core and Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one AST-based Markdown core that renders common Obsidian syntax and gives checklist items the confirmed page-view, editor-preview, and history behavior.

**Architecture:** Parse Markdown with the existing CommonMark/GFM stack plus direct unified dependencies, attach stable source metadata to task and Obsidian nodes, and keep source edits slice-preserving. Extend the page read response with a server-authoritative human write capability; page-view task saves reuse the existing page PATCH/version/conflict contract.

**Tech Stack:** React 18, react-markdown 10, unified 11, remark-parse 11, remark-gfm 4, unist-util-visit 5, CodeMirror 6, NestJS 11, Jest 30, Vitest 3, Playwright 1.62.

## Global Constraints

- Node.js must remain `>=24 <25 || >=26 <27`; pnpm remains `11.9.0`.
- Use one shared Markdown AST/rendering path for page view, editor preview, version preview, and later embedded pages.
- Raw HTML remains disabled; do not add `rehype-raw` or direct user-controlled HTML injection.
- Page view task clicks save immediately and create normal page versions; editor preview changes only the draft; version history is always read-only.
- Task source changes must preserve every byte outside the selected `[ ]` / `[x]` marker.
- Viewer and Agent principals must never receive a direct-edit capability.
- Do not touch existing dirty submodules or `agentwiki/.codebase-memory/`.
- Do not push, publish npm packages, migrate production, or deploy production in this plan.

---

## File Structure

- Create `apps/client/src/components/markdown/markdownTypes.ts`: shared render modes and task reference interfaces.
- Create `apps/client/src/components/markdown/tasks.ts`: AST task collection, signatures, and slice-preserving toggle/rebase logic.
- Create `apps/client/src/components/markdown/tasks.spec.ts`: pure task parser/transform contract.
- Create `apps/client/src/components/markdown/obsidian.ts`: wiki reference, highlight, Callout, and block-ID AST transforms.
- Create `apps/client/src/components/markdown/obsidian.spec.ts`: syntax and exclusion tests.
- Modify `apps/client/src/components/Markdown.tsx`: shared plugins, interactive task delegation, Callout components, and responsive prose classes.
- Modify `apps/client/src/components/Markdown.spec.tsx`: rendering, task mode, and safety coverage.
- Modify `apps/client/src/components/markdownLinks.ts`: aliases, headings, block anchors, and deterministic href construction.
- Modify `apps/client/src/components/MarkdownWorkspace.tsx`: editor-preview task changes flow into `onChange` only.
- Modify `apps/client/src/components/MarkdownWorkspace.spec.tsx`: preview draft task behavior.
- Modify `apps/server/src/core/page/page.controller.ts`: append `capabilities.canEdit` to authorized page reads.
- Modify `apps/server/src/core/page/page.controller.spec.ts`: capability role matrix.
- Modify `apps/client/src/features/page/PagePreview.tsx`: queued immediate checklist saves and conflict recovery.
- Create `apps/client/src/features/page/PagePreview.spec.tsx`: owner/viewer, queue, conflict, stale-response tests.
- Modify `apps/client/src/features/page/PageVersionHistory.tsx`: explicit version render mode and read-only behavior.
- Create `apps/client/src/features/page/PageVersionHistory.spec.tsx`: version checkboxes and restore-capability coverage.
- Modify `apps/client/src/features/page/PageEditor.tsx` and its spec: reject a direct-edit route when `capabilities.canEdit` is false.
- Modify `apps/client/src/i18n/messages.ts`: task save/conflict and unresolved-link copy.
- Create `apps/client/e2e/markdown-core.spec.ts`: disposable real-browser acceptance.
- Modify `apps/client/src/features/about/UsageGuide.tsx` and `apps/client/src/features/docs/DocsFeatures.tsx`: accurate support wording.

### Task 1: Freeze direct AST dependencies and implement slice-preserving task transforms

**Files:**
- Modify: `apps/client/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/client/src/components/markdown/markdownTypes.ts`
- Create: `apps/client/src/components/markdown/tasks.ts`
- Create: `apps/client/src/components/markdown/tasks.spec.ts`

**Interfaces:**
- Produces: `MarkdownTaskRef`, `collectMarkdownTasks(source)`, `toggleMarkdownTask(source, ref, nextChecked)`, and `rebaseMarkdownTask(source, ref)`.
- Consumers: Tasks 2, 4, and 5.

- [ ] **Step 1: Add direct parser dependencies**

Run:

```bash
pnpm --filter @agentwiki/client add unified@^11.0.5 remark-parse@^11.0.0 unist-util-visit@^5.1.0 mdast-util-to-string@^4.0.0
```

Expected: `apps/client/package.json` contains all four direct dependencies and `pnpm install --frozen-lockfile` succeeds.

- [ ] **Step 2: Write the failing pure-transform tests**

Create `tasks.spec.ts` with these concrete cases:

```ts
import { describe, expect, it } from 'vitest';
import { collectMarkdownTasks, rebaseMarkdownTask, toggleMarkdownTask } from './tasks';

describe('Markdown task source transforms', () => {
  it('collects nested and quoted tasks but ignores code', () => {
    const source = '- [ ] root\n  - [x] nested\n> - [ ] quoted\n\n```md\n- [ ] code\n```';
    expect(collectMarkdownTasks(source).map((task) => task.checked)).toEqual([false, true, false]);
  });

  it('changes only the selected marker byte', () => {
    const source = '- [ ] first\r\n- [X] second\r\n';
    const task = collectMarkdownTasks(source)[1];
    expect(toggleMarkdownTask(source, task, false)).toBe('- [ ] first\r\n- [ ] second\r\n');
  });

  it('refuses a stale source span and safely rebases a unique task', () => {
    const original = '- [ ] alpha\n- [ ] beta';
    const reference = collectMarkdownTasks(original)[1];
    const latest = '# inserted\n\n- [ ] alpha\n- [ ] beta';
    expect(toggleMarkdownTask(latest, reference, true)).toBeNull();
    const rebased = rebaseMarkdownTask(latest, reference);
    expect(rebased).not.toBeNull();
    expect(toggleMarkdownTask(latest, rebased!, true)).toContain('- [x] beta');
  });

  it('does not rebase an ambiguous duplicate task', () => {
    const reference = collectMarkdownTasks('- [ ] same')[0];
    expect(rebaseMarkdownTask('- [ ] same\n- [ ] same', reference)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/markdown/tasks.spec.ts
```

Expected: FAIL because `./tasks` does not exist.

- [ ] **Step 4: Implement the exact public types and parser**

Create `markdownTypes.ts`:

```ts
export type MarkdownRenderMode = 'page' | 'editor-preview' | 'version' | 'embed' | 'static';

export interface MarkdownTaskRef {
  index: number;
  start: number;
  end: number;
  markerOffset: number;
  checked: boolean;
  signature: string;
}

export interface MarkdownTaskToggle {
  task: MarkdownTaskRef;
  nextChecked: boolean;
}
```

Implement `tasks.ts` with `unified().use(remarkParse).use(remarkGfm).parse(source)`, visit only `listItem` nodes whose `checked` is boolean, require numeric `position.start.offset` and `position.end.offset`, locate the first list marker inside that exact node slice, and compute the signature from `toString(node).trim().normalize('NFC')`. `toggleMarkdownTask` must verify the source slice still has the expected signature and checked value before replacing only `markerOffset`; `rebaseMarkdownTask` must return a task only when exactly one signature match exists.

- [ ] **Step 5: Run focused and existing Markdown tests**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/markdown/tasks.spec.ts src/components/Markdown.spec.tsx
```

Expected: both files PASS and the code-block case reports exactly three tasks.

- [ ] **Step 6: Commit the task model**

```bash
git add apps/client/package.json pnpm-lock.yaml apps/client/src/components/markdown/markdownTypes.ts apps/client/src/components/markdown/tasks.ts apps/client/src/components/markdown/tasks.spec.ts
git commit -m "feat(markdown): add source-stable task model"
```

### Task 2: Replace the ad-hoc wiki parser with shared Obsidian AST extensions

**Files:**
- Create: `apps/client/src/components/markdown/obsidian.ts`
- Create: `apps/client/src/components/markdown/obsidian.spec.ts`
- Modify: `apps/client/src/components/markdownLinks.ts`
- Modify: `apps/client/src/components/Markdown.tsx`
- Modify: `apps/client/src/components/Markdown.spec.tsx`

**Interfaces:**
- Consumes: `MarkdownTaskRef` and `collectMarkdownTasks` from Task 1.
- Produces: `WikiReference`, `parseWikiReference(raw)`, `remarkAgentWikiObsidian(options)`, and the expanded `MarkdownProps` contract.
- Consumers: rich-rendering and attachment/embed plans.

- [ ] **Step 1: Write failing syntax tests**

Add tests that assert these exact outputs:

```ts
expect(parseWikiReference('Page|Shown')).toEqual({
  embed: false, target: 'Page', label: 'Shown', heading: null, blockId: null,
});
expect(parseWikiReference('Page#Heading')).toEqual({
  embed: false, target: 'Page', label: null, heading: 'Heading', blockId: null,
});
expect(parseWikiReference('Page#^block-1')).toEqual({
  embed: false, target: 'Page', label: null, heading: null, blockId: 'block-1',
});
```

Render assertions must verify `==mark==` becomes `<mark>`, `[[Page|Shown]]` links with label `Shown`, `[[Page#Heading]]` includes a slug fragment, `^block-1` creates an anchor, Callout titles are removed from body text, `+`/`-` folding is keyboard accessible, an unknown Callout type uses the neutral style, and wiki/highlight syntax inside inline/fenced code remains literal.

- [ ] **Step 2: Run syntax tests and verify RED**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/markdown/obsidian.spec.ts src/components/Markdown.spec.tsx
```

Expected: FAIL on missing parser/plugin and literal Obsidian syntax.

- [ ] **Step 3: Implement the syntax contracts**

Define:

```ts
export interface WikiReference {
  embed: boolean;
  target: string;
  label: string | null;
  heading: string | null;
  blockId: string | null;
}

export interface ObsidianPluginOptions {
  resolvePage: (reference: WikiReference) => string | null;
}
```

The plugin must walk AST text nodes but skip `code`, `inlineCode`, `link`, `linkReference`, `html`, and generated AgentWiki nodes. It may tokenize inside a text node, but must never parse the whole document with a global regex. Transform supported wiki references to links, highlights to `mark`, block IDs at paragraph ends to stable anchors, and Callout blockquotes to elements carrying `data-callout`, `data-callout-title`, and `data-callout-fold`.

Expand `resolveWikiHref` to accept a parsed reference and append `#${slug}` or `#^${encodedBlockId}` only after the target page resolves. Preserve the existing ID/slug/title match order and literal unresolved behavior.

The shared image component must allow product-internal relative URLs and external HTTPS only. External images receive `loading="lazy"`, `decoding="async"`, and `referrerPolicy="no-referrer"`; dangerous, data, file, and protocol-relative sources render a readable fallback instead of an `<img>`.

- [ ] **Step 4: Add the shared renderer mode and task event delegation**

Change `MarkdownProps` to:

```ts
interface MarkdownProps {
  children: string;
  pages?: PageLinkTarget[];
  className?: string;
  mode?: MarkdownRenderMode;
  canEdit?: boolean;
  pendingTaskIndexes?: ReadonlySet<number>;
  onTaskToggle?: (toggle: MarkdownTaskToggle) => void;
}
```

Annotate task list items with `data-task-index`. Render GFM inputs disabled unless `mode` is `page` or `editor-preview` and `onTaskToggle` exists; page mode additionally requires `canEdit`. Delegate root `onChange`, read the closest task-list item index, and call `onTaskToggle` with the corresponding `collectMarkdownTasks(children)` entry. Add Callout, mark, block-anchor, task-list, responsive table, and responsive image classes to `markdownClass`.

- [ ] **Step 5: Run focused tests and accessibility assertions**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/markdown/obsidian.spec.ts src/components/Markdown.spec.tsx
```

Expected: PASS; a viewer checkbox is disabled, an editable page checkbox is enabled, and Callout folding exposes `aria-expanded`.

- [ ] **Step 6: Commit shared syntax rendering**

```bash
git add apps/client/src/components/markdown/obsidian.ts apps/client/src/components/markdown/obsidian.spec.ts apps/client/src/components/markdownLinks.ts apps/client/src/components/Markdown.tsx apps/client/src/components/Markdown.spec.tsx
git commit -m "feat(markdown): render common Obsidian syntax"
```

### Task 3: Return server-authoritative page capabilities

**Files:**
- Modify: `apps/server/src/core/page/page.controller.ts`
- Modify: `apps/server/src/core/page/page.controller.spec.ts`

**Interfaces:**
- Produces: page read response field `capabilities: { canEdit: boolean }`.
- Consumers: PagePreview in Task 4 and future embedded-page rendering.

- [ ] **Step 1: Write the failing role-matrix controller test**

Add a parameterized test with human `owner`, `editor`, `admin`, `viewer`, super-admin, and Agent principals. Mock the broad read authorization result role, then assert human owner/editor/admin and super-admin receive `canEdit: true`; viewer and every Agent principal receive false. Add one Agent row with a super-admin-shaped platform role so Agent identity is proven to take precedence. Also assert the capability agrees with the real live PATCH mapping without broadening PATCH permissions.

```ts
it.each([
  ['owner', false, true],
  ['editor', false, true],
  ['admin', false, true],
  ['viewer', false, false],
  ['owner', true, false],
  ['owner', true, false, 'super_admin'],
])('maps role %s and agent=%s to canEdit=%s', async (role, agent, canEdit) => {
  authorization.assertPageAccess.mockResolvedValue({ id: 'page-1', spaceId: 'space-1' });
  authorization.assertSpaceAccess.mockResolvedValue({ role });
  const result = await controller.findOne('page-1', {
    user: { userId: 'user-1', ...(agent ? { agentId: 'agent-1' } : {}) },
  } as any);
  expect(result.capabilities).toEqual({ canEdit });
});
```

- [ ] **Step 2: Run the controller test and verify RED**

Run:

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/core/page/page.controller.spec.ts
```

Expected: FAIL because `findOne` returns the page without `capabilities`.

- [ ] **Step 3: Implement capability mapping after successful read authorization**

After `assertPageAccess`, call broad `assertSpaceAccess` for the already-authorized page Space and derive:

```ts
const canEdit = !principal.agentId
  && (principal.platformRole === 'super_admin' || ['owner', 'editor', 'admin'].includes(String(access.role)));
return { ...await this.pageService.findOne(id), capabilities: { canEdit } };
```

Do not catch authorization/database errors and do not change PATCH/DELETE role arrays.

- [ ] **Step 4: Run controller and authorization regression tests**

Run:

```bash
pnpm --filter @agentwiki/server test -- --runTestsByPath src/core/page/page.controller.spec.ts src/core/authorization/authorization.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the capability contract**

```bash
git add apps/server/src/core/page/page.controller.ts apps/server/src/core/page/page.controller.spec.ts
git commit -m "feat(page): expose direct-edit capability"
```

### Task 4: Implement queued page-view checklist saves and conflict recovery

**Files:**
- Modify: `apps/client/src/features/page/PagePreview.tsx`
- Create: `apps/client/src/features/page/PagePreview.spec.tsx`
- Modify: `apps/client/src/i18n/messages.ts`

**Interfaces:**
- Consumes: `MarkdownTaskToggle`, `toggleMarkdownTask`, `rebaseMarkdownTask`, and `page.capabilities.canEdit`.
- Produces: serialized immediate task saves using existing `PATCH /pages/:id`.

- [ ] **Step 1: Write failing component tests**

Mock `../../api/client`, render under MemoryRouter/LanguageProvider, and cover:

```ts
fireEvent.click(await screen.findByRole('checkbox', { name: /first task/i }));
await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/pages/page-1', {
  content: '- [x] first task\n- [ ] second task',
  expectedUpdatedAt: '2026-08-26T01:00:00.000Z',
}));
```

Add tests for viewer disabled state, two fast clicks using the first response `updatedAt` for the second request, a safe single retry after 409/refetch, ambiguous rebase rollback, and a route change that ignores the old response.

- [ ] **Step 2: Run PagePreview tests and verify RED**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run src/features/page/PagePreview.spec.tsx
```

Expected: FAIL because PagePreview passes no task callback and never PATCHes content.

- [ ] **Step 3: Implement the page-level queue**

Add refs for the last committed page, active route ID, mounted state, ordered pending operations, and a promise chain. Rendered optimistic content is always recomputed by replaying pending task signatures over the last committed content; do not store one rollback snapshot per click. The task callback must:

1. apply `toggleMarkdownTask` to the current snapshot;
2. optimistically update `page.content`;
3. append a save closure to the chain;
4. PATCH `{ content, expectedUpdatedAt }`;
5. adopt server `updatedAt` on success;
6. on 409, GET current page, call `rebaseMarkdownTask`, retry once if unique, otherwise drop only the failed operation, adopt the server snapshot, and replay still-pending operations;
7. on other failures, drop only the failed operation, recompute optimistic content from the last committed snapshot, and show `page.taskSaveFailed`.

Pass:

```tsx
<Markdown
  mode="page"
  canEdit={page.capabilities?.canEdit === true}
  pendingTaskIndexes={pendingTaskIndexes}
  onTaskToggle={handleTaskToggle}
  pages={spacePages}
>
  {page.content}
</Markdown>
```

Hide or disable edit/delete controls using the same capability.

- [ ] **Step 4: Run PagePreview, Markdown, and editor regression tests**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run src/features/page/PagePreview.spec.tsx src/components/Markdown.spec.tsx src/features/page/PageEditor.spec.tsx
```

Expected: PASS with no unhandled promise rejection or React act warning.

- [ ] **Step 5: Commit immediate checklist saves**

```bash
git add apps/client/src/features/page/PagePreview.tsx apps/client/src/features/page/PagePreview.spec.tsx apps/client/src/i18n/messages.ts
git commit -m "feat(page): save checklist changes from preview"
```

### Task 5: Wire editor-preview drafts and explicit history read-only mode

**Files:**
- Modify: `apps/client/src/components/MarkdownWorkspace.tsx`
- Modify: `apps/client/src/components/MarkdownWorkspace.spec.tsx`
- Modify: `apps/client/src/features/page/PageVersionHistory.tsx`
- Create: `apps/client/src/features/page/PageVersionHistory.spec.tsx`
- Modify: `apps/client/src/features/page/PageEditor.tsx`
- Modify: `apps/client/src/features/page/PageEditor.spec.tsx`

**Interfaces:**
- Consumes: task transforms and shared Markdown modes.
- Produces: preview-task draft updates without API calls; explicit version mode.

- [ ] **Step 1: Write the failing editor-preview test**

Start with `- [ ] draft task`, switch to preview, click the checkbox, and assert `onChange` receives `- [x] draft task`. Assert no disabled checkbox in editor preview and a disabled checkbox from `<Markdown mode="version">`. In `PageEditor.spec.tsx`, prove a viewer is redirected from the direct-edit route after the page response. In the new `PageVersionHistory.spec.tsx`, render a viewer capability and prove the historical checkbox is disabled and the restore button is absent.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/MarkdownWorkspace.spec.tsx src/components/Markdown.spec.tsx src/features/page/PageEditor.spec.tsx src/features/page/PageVersionHistory.spec.tsx
```

Expected: FAIL because preview Markdown has no task callback.

- [ ] **Step 3: Implement draft-only task toggles**

In preview mode, pass `mode="editor-preview"`, `canEdit`, and an `onTaskToggle` that computes the next source and calls `onChange(next)` only when the transform returns non-null. Do not add an API import. In PageVersionHistory pass `mode="version"`, `canEdit={false}`, and no callback; use the page capability to hide restore. In PageEditor, after the page read completes, redirect a false capability to `/pages/:id` with a translated permission message instead of presenting a writable CodeMirror surface.

- [ ] **Step 4: Run workspace and page-editor tests**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/MarkdownWorkspace.spec.tsx src/features/page/PageEditor.spec.tsx src/features/page/PageVersionHistory.spec.tsx src/components/Markdown.spec.tsx
```

Expected: PASS; existing dirty/save/conflict tests remain green.

- [ ] **Step 5: Commit editor and history modes**

```bash
git add apps/client/src/components/MarkdownWorkspace.tsx apps/client/src/components/MarkdownWorkspace.spec.tsx apps/client/src/features/page/PageVersionHistory.tsx apps/client/src/features/page/PageVersionHistory.spec.tsx apps/client/src/features/page/PageEditor.tsx apps/client/src/features/page/PageEditor.spec.tsx
git commit -m "feat(editor): toggle checklist items in draft preview"
```

### Task 6: Add browser acceptance and accurate user documentation

**Files:**
- Create: `apps/client/e2e/markdown-core.spec.ts`
- Modify: `apps/client/src/features/about/UsageGuide.tsx`
- Modify: `apps/client/src/features/docs/DocsFeatures.tsx`
- Modify: `apps/client/src/i18n/messages.ts`

**Interfaces:**
- Consumes: completed core feature.
- Produces: real-browser evidence and truthful support copy.

- [ ] **Step 1: Add the disposable Playwright scenario**

Follow `page-templates.spec.ts` account/Space cleanup patterns. Create owner/editor/viewer accounts and a Markdown page containing a template checklist, Callout, highlight, aliases, heading link, block link, code-fenced fake task, and wide table. Assert owner click persists after reload, a PageVersion exists through API, viewer checkbox is disabled, version preview is disabled, code content stays literal, and 390px has no document-level overflow.

- [ ] **Step 2: Run the scenario against local services and verify product gaps**

Run in separate terminals:

```bash
pnpm --filter @agentwiki/server start:dev
pnpm --filter @agentwiki/client dev
pnpm --filter @agentwiki/client exec playwright test e2e/markdown-core.spec.ts
```

Expected before final fixes: any remaining selector, focus, or responsive defect fails with a trace.

- [ ] **Step 3: Correct docs and translation copy**

Replace “Obsidian 式实时预览，所见即所得” with “Markdown 编辑与共享预览”. Add a concise supported-syntax list and exact checklist mode semantics in both Chinese and English. Do not claim math, Mermaid, or image attachment support until their later plans pass.

- [ ] **Step 4: Re-run E2E and focused copy tests**

Run:

```bash
pnpm --filter @agentwiki/client exec playwright test e2e/markdown-core.spec.ts
pnpm --filter @agentwiki/client exec vitest run src/i18n
```

Expected: Playwright PASS, zero console warnings/errors, and copy tests PASS.

- [ ] **Step 5: Commit core acceptance and docs**

```bash
git add apps/client/e2e/markdown-core.spec.ts apps/client/src/features/about/UsageGuide.tsx apps/client/src/features/docs/DocsFeatures.tsx apps/client/src/i18n/messages.ts
git commit -m "test(markdown): accept interactive core rendering"
```

### Task 7: Run core convergence gates and record review evidence

**Files:**
- Create: `docs/verification/markdown-core-checklist-2026-08-26.md`

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: review-ready evidence for the rich-rendering and attachment plans.

- [ ] **Step 1: Run focused suites**

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/markdown src/components/Markdown.spec.tsx src/components/MarkdownWorkspace.spec.tsx src/features/page/PagePreview.spec.tsx src/features/page/PageEditor.spec.tsx
pnpm --filter @agentwiki/server test -- --runTestsByPath src/core/page/page.controller.spec.ts src/core/page/page.service.spec.ts
```

Expected: zero failed tests.

- [ ] **Step 2: Run repository gates**

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

Expected: every command exits 0; record any existing environment-gated skips separately and do not count them as executed coverage.

- [ ] **Step 3: Perform a fresh code-path review**

Review task source offsets, quoted/nested lists, CRLF, duplicate signatures, rapid clicks, 409 retry, route switches, viewer/history modes, raw HTML, external URLs, and mobile overflow. Fix every validated finding with a new failing regression test before implementation.

- [ ] **Step 4: Write verification evidence**

Record commit range, exact commands/counts, Playwright target, screenshots/traces, remaining skips, and explicit release state in `docs/verification/markdown-core-checklist-2026-08-26.md`.

- [ ] **Step 5: Commit the convergence record**

```bash
git add docs/verification/markdown-core-checklist-2026-08-26.md
git commit -m "docs: record markdown core verification"
```
