# Notes discovery release implementation plan

> Execute continuously in this session using delegated independent tasks; user approval includes implementation and publication.

**Goal:** Ship current-page focus plus authorized cross-page note discovery with the approved blue logo.
**Architecture:** Keep page writes isolated; add a paginated aggregate read API and reusable discovery UI. Integrate through lazy routes and a lazy sidebar scope wrapper, then publish a frozen clean candidate.
**Tech Stack:** NestJS, Prisma/PostgreSQL, React, existing NativeSelect, Vitest/Jest, bsk Chrome, native systemd deployment.
**Spec:** `design.md` in this task directory.

## Constraints

Canonical candidate guard must pass; no historical checkout publication; preserve design/; source release from clean detached tree; paired PostgreSQL/app backup and restore verification before production replacement. No extra npm release or provider/model calls. Reuse existing bilingual styling and NativeSelect; maintain JS bundle budget 551000 bytes.

## Task 1 — paginated authorized note search

Owner: backend agent. Files: `apps/server/src/page-notes/` service/controller/schema/tests, module registration; Prisma schema/migration only for justified indexes.

- [x] Add failing behavior tests for cross-page/current-space/all-author query, quote/title search, me/mentioned, open/resolved, bounded stable cursors, unauthorized/deleted object exclusion, live PAT/Agent denial.
- [x] Implement the exact GET /page-notes contract in design.md without changing single-page mutation behavior. Example expected assertion: `expect(result.notes.map(n => n.pageId)).toEqual(['page-b', 'page-a']); expect(result.nextCursor).not.toBeNull()` for limit=2 with three authorized rows.
- [x] Run focused service/controller and DB integration checks; self-review query permission/count/pagination consistency. Report red and green evidence.

## Task 2 — note discovery UI

Owner: frontend agent. Only create `apps/client/src/features/page-notes/` API/hook/components/tests.

- [x] Write and run failing tests for filters/query preserving state, cursor reset, retry, stale/old-account response rejection, source labels, safe source-page return links.
- [x] Implement NotesBrowser and NotesPage with the exact exported props and DTO contract in design.md; use lazy parent integration and NativeSelect, bilingual UI; no direct note mutations.
- [x] Verify a query finds resolved and stale-anchor notes, opening preserves return state, and loading/error/empty/no-more states remain usable.

## Task 3 — current-page integration and navigation

Owner: root. Files: PagePreview/PageEditor/AgentReadingSidebar, a small shared page-scope wrapper, App lazy route, space section nav/workspace route classification, relevant tests.

- [x] Add regression tests that `?note=` opens a loaded note even when resolvePersonalNoteHighlights returns no match; preserve current-page write/highlight tests.
- [x] Wrap existing current-page panels with current/all tabs. New wrapper receives the original panel as children; all view lazy-loads NotesBrowser and shows compact current-page context.
- [x] Add `/spaces/:id/notes` lazy route and space nav item; classify workspace section. Safe return navigation stays inside note-search/page routes and preserves query/filter state without carrying credentials.
- [x] Run related client tests, TypeScript/lint/build/bundle gate and desktop/mobile read/search/open/back flow.

## Task 4 — review, freeze and publish

- [x] Independent API/UI/integration review and fix/re-review any blocking findings.
- [x] Complete test:full, typecheck, lint, build, guard, diff checks. Record actual skips independently from unrun tests.
- [x] Bump to next unused Web/API version, lock candidate, commit, push candidate branch and publish GitHub tag/release. Keep default master handling scoped to necessary verified integration; no force push.
- [x] Create clean frozen detached publication tree; verify paired production backup and isolated restore; deploy from that tree using existing tooling.
- [x] Read back deployed version/source hashes/services/health/public assets. Use disposable accounts/Space/pages/notes for real production cross-page and stale-anchor UI acceptance, then clean them and verify deletion; existing business pages remain read-only.
- [x] Archive this task and update current.md with exact release/boundaries and receipt locations.
