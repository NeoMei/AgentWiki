# Mixed-state note regeneration correction

Spec authority: docs/superpowers/specs/2026-10-06-agent-sessions.md; this corrective plan addresses one independently reproduced P2 at product1735f341. Base checkout fd9b97967aafe2b18c6bc762a6014530d9139718 (product unchanged from1735f341).

## Global Constraints

- Worktree `/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ` includes trailing space; app subdirectory agentwiki. Every Git command MUST explicitly use --work-tree; do not change core.worktree. Branch codex/document-workspace. Only local commits; no push, merge, release, deploy, or changes to original checkout.
- User-selected p5c07ff/gpt-6-astra / ultra. One fresh implementer, independent scoped task/final integration review. No implementer-spawned subagents.
- Preserve single Markdown source, standard linear Undo, historical acceptance/note status does not rewind with Undo, explicit candidate acceptance into draft and separate explicit Save. Never introduce PATCH on Send/Accept.
- Preserve Resolved notes without automatic reopening; immutable quote/body/source/version and fresh live authorization, user/Space/page/session isolation, explicit-send-only upload, old-task event fencing. No new dependencies or budget relaxation; initial JS maximum550000 bytes.
- Existing owned runtime cleaned. External independent acceptance uses51913/51914; do not access/change/rebuild/stop it or read its credentials. No CodeWiki or ACP/provider expansion. Current app CodeGraph explore reports unavailable despite an empty directory; do not index.
- Parent owns project memory/current/plan/ledger. Implementer owns only relevant product source and tests; no unrelated refactors.

### Task 1: Preserve unresolved note linkage when regenerating mixed status annotations

**Evidence:** /tmp/agentwiki-independent-acceptance-20261006.4eB3KG/candidate-review-final.md and mixed-note-probe.log. One passing probe asserts the defect, NOT product success. Read evidence, reproduce expected corrected behavior RED before source edit.

**Code surface:** apps/client/src/features/page/usePersonalNotes.ts and its spec; features/agent-session/AgentSessionNotes.spec.tsx; AgentSessionPanel.tsx/AgentAssistPanel.tsx request types only if needed. Prefer the smallest correct lifecycle fix, retaining canonical/history guards.

**Required behavior:** Two independently anchored notes explicitly staged in one Document proposal. Accept first hunk only: note1 Resolved, note2 Awaiting review. Standard Undo restores body but not note status. Append unrelated manual tail, remount to show Conflict, click product Regenerate, explicit Send, accept new hunk covering note2. note1 remains Resolved with its historical task/identity; note2 safely binds new task and becomes Resolved only after its own actual coverage accepted. Preserve manual tail, unrelated unselected notes, no automatic page PATCH.

Resolved annotations may remain explicitly visible in a regenerated context; their immutable proof must still validate, but they cannot veto an eligible unresolved note merely by coexisting. The implementation must keep complete receipt/request/event identity validation. Do not simply delete the resolved guard and reopen all notes. Bind/transition only eligible notes under valid old-task supersession, handle the full event note set consistently, including route-remount binding recovery. If all annotations are Resolved, they remain unchanged; missing/mismatched/changed/wrong-task/unauthorized notes may not be silently transferred. Failed Send preserves old bindings; stale events cannot reopen or resolve newly bound notes.

- [x] Add failing real production-panel/registry/notes/apply regression of exact mixed Document path; it must fail on note2 binding/Resolved expectation. Use actual candidate apply helper; a byte-exact body reset may model standard Undo, clearly label component rather than browser evidence.
- [x] Implement minimal safe mixed-state regeneration handling; ensure recovery after a further route remount also uses only correct new-task linkage. Preserve ordinary dispatch and Resolved safeguards.
- [x] Cover reverse order / all-Resolved / wrong supersedes task / immutable annotation or version mismatch / failed-send retry / late old-task events as relevant using existing test helpers. Avoid trivial duplicated suites; retain existing F1 and selection/document tests.
- [x] Run focused session/notes/candidate/editor tests, tsc, scopedeslint and productionbuild once stable. Existing recent fullclient2091 and final260 checks are prior receipts, not new final-head results; no need to repeat fullserver/client absent concrete new failure.
- [x] Self-review, commit exact product/test paths, write task-1-report.md with red/green commands/output/counts, full candidate SHA, files, mechanism, negative guards, build entry/budget, limitations. Do not claim actual UI or external provider verification. Return fixed candidate for independent review.

### Task 2: Independent review and immutable handoff

Parent creates BASE..HEAD review package; fresh independent reviewer checks Task1 spec and quality plus direct lifecycle integration impact. Prior overall feature review is inherited only outside this correction. If needed original implementer fixes concrete findings and reviewer scoped re-reviews.

- [x] Review verifies mixed-state exact path, Resolved unchanged, eligible new-task binding/remount recovery, immutable/source/auth/old-event fences and no automatic Save.
- [x] Parent records corrected current status, new fixed candidate and receipt paths; independent real UI remains a separate gate and no unperformed UI is claimed. Archive correction evidence, keep the task active for the external real-UI result and keep the local worktree clean.

## Fixed candidate handoff

Productf4325942c53101e8c628cd68fc1b7f23f07ae5cd, exact5source/testfiles;427focusedpass,static/buildpass,index-DXqBseLb.js,548914/550000. Independent spec/quality/direct integration Approved. Root read the old1735realCUAfailure receipt and viewed its screenshot; At handoff the new candidate actual UI was pending. Later independent UI acceptance and cleanup passed; final reports are archived under repository-root `.codex-memory/tasks/archive/agent-session-mixed-notes-20261007/`.

- [x] Separate independent actual-browser acceptance of the fixed candidate: A1–A6 passed, mixed-note P2 closed, exact native Undo/Redo and explicit Save verified. Newer independent cleanup receipt closes runtime cleanup; archive acceptance.md preserves fixture/provider/ACP/old HTTP gate/auth-injection boundaries. No implementation expansion or deployment; this period is closed.
