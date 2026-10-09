### Spec Compliance

- ✅ Scoped repair compliant. The prior Important finding is addressed: inline mutations capture a monotonic committed navigation generation, and completion effects require the same generation (`agentwiki/apps/client/src/features/space/SpaceView.tsx:143-146`, `:330-335`). Location key/path/query/hash, user, Space, selected document/folder and mode participate in invalidation, so same-Space A→B and A→B→A cannot revive the pending create.
- ✅ Stale completion cannot navigate, refresh page/tree state, expand a folder, or emit an inline failure into a later scope (`SpaceView.tsx:340-365`). The existing Space/user/mounted checks remain in the completion guard (`SpaceView.tsx:332-335`).

### Strengths

- Row instances are keyed by mutation scope, and root create forms use that same scope and close on scope changes. Old input instances therefore unmount; their existing active-instance cleanup protects newer inputs from an old onCancel/error completion (`ContentTree.tsx:143`, `SpaceDirectory.tsx:77`, `:157-158`). Optional defaults preserve existing callers (`ContentTree.tsx:31-33`, `:79`).
- Two deferred-request regressions keep the same SpaceView instance mounted and verify explicit navigation survives pending POST completion, including returning to the original path (`SpaceView.spec.tsx:610-626`). These target the reported defect rather than an implementation detail.

### Issues

#### Critical (Must Fix)

- None.

#### Important (Should Fix)

- None. Prior navigation Important closed.

#### Minor (Nice to Have)

- None found within this repair.

### Assessment

**Task quality:** Approved for the scoped Task 2 repair; prior Task 2 gate may now pass.

**Reasoning:** Generation checks prevent equality-based scope revival, while keyed inline instances isolate stale completion UI. No new breakage found in the four-file repair; original native browser acceptance caveats remain unchanged.

**Checks / scope:** Read immutable `review-c268fd83..9be0af67.diff` once for base `c268fd83`, head `9be0af67`, and the appended repair report. Read existing `/tmp/agentwiki-task2-navigation-green.log`: 2 files / 41 tests passed, no warnings. Read existing RED evidence: both new navigation cases failed before the repair (2 failed / 39 passed). No test reruns, outside-diff reads, product mutations, Git commands or subagents. Only this review report was created.
