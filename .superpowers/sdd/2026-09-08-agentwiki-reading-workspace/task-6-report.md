# Task 6 report: shared shells for Space sections

## Scope and baseline

- Worktree: `/Users/neomei/项目/codexprojects/AgentWiki /.worktrees/reading-workspace-20260908`
- Baseline: `754e0e899f980b5f3f801325f88bf15eea09a25f`
- Client-only structural change. No server, Prisma, sync protocol, request payload, permission source, collaboration Run semantics, or global search/review/login change.
- Controller-owned `.codex-memory`, plan, and acceptance files were present before this task and were not edited or staged here.

## Implementation

`SpaceWorkspace` now sends every `mode="section"` route through the existing `SpaceView` shell. `SpaceView` accepts `showDirectory`; section routes pass `false`, so the shared shell fetches the authoritative `/spaces/:spaceId` metadata, renders the actual Space name and one embedded `SpaceNav`, and gives the page body the full-width content area without a persistent directory.

When `showDirectory` is false, `SpaceView` gives `useSpaceDirectory` no active Space ID and skips the composite-template capability lookup. Section navigation therefore does not request folders, content-tree levels, or directory-only template capability data. The metadata-error branch remains full width, keeps the routed business body mounted, and shows the existing retry action instead of creating an empty directory column.

The page-owned `SpaceNav` import and element were removed from the ten approved business components:

- `KnowledgeGraph`
- `SourcesPage`
- `RunsPage`
- `SpaceMembers`
- `SpaceSettings`
- `CollaborationWorkspace`
- `TemplateEditor`
- `RunStartWizard`
- `RunDashboard`
- `PageTemplateManager`

No page-specific heading, descriptive help, business condition, form, handler, permission check, loading/empty/error body, or back destination was moved or rewritten. Nested template/start/run pages continue linking back to Collaboration; Page Template Manager continues linking back to Settings; Graph, Sources, Runs, Members, and Settings retain their existing Space back links.

## Route identity and navigation evidence

`App.spec.tsx` contains a literal table for all twelve section route registrations:

| URL | Space ID source | Active section |
| --- | --- | --- |
| `/spaces/graph-space/graph` | `:spaceId` | Graph |
| `/spaces/member-space/members` | `:id` | Members |
| `/spaces/settings-space/settings` | `:id` | Settings |
| `/spaces/template-settings-space/settings/page-templates` | `:id` | Settings |
| `/spaces/docs-space/docs` -> Sources | `:id` | Sources |
| `/spaces/source-space/sources` | `:id` | Sources |
| `/spaces/ingest-space/runs` | `:id` | Runs |
| `/spaces/collaboration-space/collaboration` | `:id` | Collaboration |
| `/spaces/create-space/collaboration/templates/new` | `:id`, not `new` | Collaboration |
| `/spaces/edit-space/collaboration/templates/template-17` | `:id`, not `:templateId` | Collaboration |
| `/spaces/start-space/collaboration/templates/template-18/start` | `:id`, not `:templateId` | Collaboration |
| `/spaces/run-space/collaboration/runs/run-22` | `:id`, not `:runId` | Collaboration |

Each row renders the real `App` + `WorkspaceRoute` + `SpaceWorkspace` + `SpaceView` + `SpaceNav` chain. The test derives the returned Space name from the exact `/spaces/<id>` request, then checks that name is the shared heading, exactly one labelled Space navigation exists, the expected link has `aria-current="page"`, no `aside` is present, and no folders/content-tree request occurred. Explicit negative assertions reject `template-17`, `template-18`, and `run-22` as Space metadata IDs.

The same file checks that a Space metadata error leaves section content and Retry visible without adding a directory rail. `SpaceWorkspace.spec.tsx` checks that expanded-folder and directory-scroll state survive a visit to a wide Sources section and are present after returning to the page area, while the section makes only `/spaces/space-1` metadata request. `CollaborationWorkspace.test.tsx` now mounts the real shared section shell; its existing Runs -> Collaboration -> Members ordering and selected-link assertions therefore exercise the composed production navigation.

## TDD and mutation evidence

Initial RED, before production edits:

```text
pnpm --filter @agentwiki/client test src/App.spec.tsx
Test Files  1 failed (1)
Tests       12 failed | 5 passed (17)
```

All twelve new route rows failed for the intended reason: section output contained only the routed body and no authoritative Space heading or shared navigation.

After the shell implementation, the route suite passed 17/17; after the error-path test it passed 18/18. The first exact affected-section command then passed 376 tests and failed only the old standalone Collaboration navigation fixture. After mounting that test through the real shared shell, its file passed 27/27.

A deliberate mutation temporarily restored `SpaceNav` inside `CollaborationWorkspace`. The composed navigation test failed with `Found multiple elements with the role "link" and name "Runs"`, proving the test detects a reintroduced duplicate. Removing the mutation restored the focused App + Collaboration result to 45/45.

## Fresh verification

Affected section plus App route suite:

```text
pnpm --filter @agentwiki/client test \
  src/features/knowledge \
  src/features/source \
  src/features/space \
  src/features/collaboration \
  src/features/page-templates/PageTemplateManager \
  src/App.spec.tsx

Test Files  28 passed (28)
Tests       395 passed (395)
```

The browse-state addition was then run directly:

```text
pnpm --filter @agentwiki/client test src/features/space-workspace/SpaceWorkspace.spec.tsx
Test Files  1 passed (1)
Tests       8 passed (8)
```

The final fresh verification after all edits is recorded below before commit:

- `pnpm --filter @agentwiki/client exec tsc --noEmit`
- scoped ESLint over every changed TypeScript/TSX file
- exact affected-section + App test command
- `git diff --check`

## Self-review

- One owner: `SpaceView` remains the sole common Space metadata/header/navigation shell; business pages no longer own a second Space navigation.
- Identity: Graph continues to consume `:spaceId`; all `:id` section routes remain unchanged; nested IDs are not passed to the shell.
- Directory continuity: section mode neither renders a directory nor activates directory fetches, and the per-user/per-Space registry is not reset or overwritten.
- Business behavior: the change removes only duplicated navigation JSX from the ten pages. Page headings, content, state, effects, mutation handlers, permissions, Run behavior, and back links are unchanged.
- Failure handling: Space metadata failure shows its message and Retry while preserving the routed page body in a full-width layout.
- No added copy or translation key was required.
- CodeGraph was attempted first from the indexed-looking repository, but the CLI reported that no usable index exists in this worktree and explicitly directed use of ordinary source tools.

## Remaining acceptance boundary

The controller was notified as soon as the section shell and route suite were stable and reported the following real browser evidence before this commit:

- Sources, ingestion Runs, Members, Settings, Page Templates, Collaboration, new legacy workflow template, coding start wizard, and Graph each showed the real `产品知识库` Space title, one Space navigation, the correct active section, and zero persistent tree rows.
- Page Templates returned to Settings and the nested Collaboration routes returned to Collaboration.
- Collaboration and the start wizard were checked at 390 px width with a 390 px document scroll width.
- From Graph, selecting a real deep page changed the graph control to a link. Following that link opened `/pages/fceae491...` and showed the authoritative breadcrumb `产品知识库 / 使用指南 / 内容组织 / 进阶操作`, three expanded folders, and the selected deep page.
- This route walkthrough performed no business writes.

The controller owns full client-suite execution and final Task 7 acceptance. This report does not extend the browser evidence beyond the routes and observations above.
