# Document client systematic review R2

**Conclusion: no confirmed actionable finding in the reviewed flows.** This is a fresh source review and targeted verification, not a restatement of earlier acceptance.

Fixed candidate: `3fa75091337c9c3bee214856e92a8cc8c3c56250`. HEAD verified before and after; no working diff in reviewed agent-session/page directories. No product modification, build, runtime, API, database, browser, or provider started.

## Reviewed behavior

Repository prefix: `/Users/neomei/.codex/worktrees/knowledge-capabilities/AgentWiki /agentwiki/`.

- `apps/client/src/features/agent-session/readingSelection.ts`: renderer-owned literal mappings and render version gate; rejects unmapped images/math/diagram/nested roots and ambiguous DOM traversal. Source offsets preserve literal Markdown rather than searching display text. Raw Markdown selection fallback remains explicit.
- `AgentReadingSidebar.tsx`, `AgentSessionPanel.tsx`, `usePersonalNotes.ts`: private notes are staged locally, never implicitly uploaded. Explicit Send carries immutable snapshot, note IDs, annotations and selected scope. Returned dispatch receipts must match the sent page/title/content/version and annotations before a local note transitions; receipt delivery is fenced against route remount and source identity changes. Only explicit candidate acceptance resolves covered notes; generated responses alone do not.
- `AgentReferencePicker.tsx`: user/Space scoped authorized search with aborted stale request handling, explicit selection and maximum five references. Send uses selected IDs, and canonical turn references show server-bound versions. No implicit unrelated-document inclusion found.
- `useAgentSession.ts`, `AgentSessionRegistry.tsx`: per-user/Space store, explicit session/lifetime fences, access failure clears candidate/receipt content while preserving local no-replay ledger and unsent composer. Inspected adjacent server `assist-session.service.ts` list/get/authorizedTurns: inaccessible source sessions are omitted or rejected as a whole, rather than relying on a client to sanitize a partially authorized result. Server failures are not misclassified as authorized empty history.
- `agentSessionCandidate.ts`, `assistCandidate.ts`, `assistTargets.ts`: candidates keep immutable turn snapshots; remote revision, page, Space, user, title and capability checks remain mandatory. Scoped apply uses unique contextual anchors; whole-document apply stays strict. Per-hunk ledger applies accepted offsets and blocks replay. Editing outside an unchanged scoped anchor can survive; changed/ambiguous anchors fail closed.
- `PageEditor.tsx`: candidate application recomputes against live CodeMirror content and editor revision, checks mode/save/remote-conflict/user fences, calls replaceDocument through the existing edit/Undo path and updates only local draft. Formal body change remains the explicit Save PATCH with expectedUpdatedAt; title updates additionally require tree revision. Candidate generation or acceptance does not call save automatically.
- `AssistCandidateReview.tsx`, agent panel styles: independent hunks, accepted progress, full-document download, bounded preview and explicit Save language; scroll containers and fixed composer actions inspected. Static class inspection is not a fresh 390px visual acceptance.

## New verification

1. `pnpm exec vitest run src/features/agent-session/AgentSessionPanel.spec.tsx src/features/agent-session/AgentSessionNotes.spec.tsx src/features/agent-session/agentSessionCandidate.spec.ts src/features/agent-session/readingSelection.spec.tsx src/features/page/assistCandidate.spec.ts src/features/page/AssistCandidateReview.spec.tsx src/features/page/PageEditor.spec.tsx` — **7 files, 233/233 passed**.
2. `pnpm exec vitest run src/features/page/usePersonalNotes.spec.tsx src/features/page/assistTargets.spec.ts` — **2 files, 60/60 passed**.
3. Independent temporary probe in `/tmp/agentwiki-comprehensive-audit-20261007/document-r2-probe/`: suspected cancel-denial/older-poll response race tested against actual component. A running history poll is pending, Stop returns 403, then old poll success resolves in the same batched update. **1/1 passed**, history stays removed. Do not report this unconfirmed hypothesis as a defect. `results.log` preserves output; 21 existing tests were skipped in this probe-only invocation.

## Prior evidence read, without promoting it to current acceptance

Read `docs/verification/document-workspace-20261006/acceptance.md`, `document-workspace-polish-20261006/acceptance.md`, and `document-workspace-completion-20261006/acceptance.md`. Their actual browser observations cover independently typed text surviving scoped acceptance, two-note partial acceptance, one-operation Undo, remote version conflict, and desktop/390px layouts. They explicitly identify model output as controlled fixtures and exclude real provider/Windows/native IME/multiplayer pressure. Those are prior results, not runs performed by this audit.

## Recommended root actual-flow checks

- Select rendered prose and raw Markdown fallback, stage notes, verify zero requests until explicit Send; verify chosen reference IDs and immutable versions in actual request/history.
- Produce two scoped candidates, type independently between them, accept one hunk at a time, Undo/Redo, switch page/Space and remount; assert no ledger replay and no formal body change before Save, then reload saved body.
- Move/delete a selected reference or downgrade proposal permission; reread session/list and assert no historic title/body/result remains accessible. Separately verify unsent private composer remains recoverable.
- Repeat long-candidate, multiple-reference and long-annotation states at desktop and 390px; confirm message field, Send and per-hunk actions remain reachable with keyboard and scrolling.

No full-system/browser/provider PASS is asserted here. Root owns the running full E2E and actual UI verification.
