### Spec Compliance

- ❌ Issues found in frozen Task5 final integration `b89a3f84dc5de5aa1537b44be89cd0ed8ab6d0a4..dfd4bbbaef474418624bd9a05d201bab504d7179`: closing the drawer loses reviewable candidates and resets auto-submit protection (`PageEditor.tsx:1258–1284`); coarse line-hunk coverage can resolve an unchanged note (`usePersonalNotes.ts:73–84`).
- ✅ Source selection and section/document transport are integrated (`PageEditor.tsx:814–820,1250–1251,1270–1278`; `PageEditor.spec.tsx:2384–2430`). Explicit successful dispatch, readiness and hunk acceptance remain separate note states (`usePersonalNotes.ts:63–87`, `reviewComments.ts:42–50`).
- ✅ No API/schema/dependency/external permission changes occur in this seven-file delta. Browser acceptance is still pending and is not inferred from the reported tests.

### Strengths

- Parent revalidates current account authorization, exact saved version, current title/source, capabilities, remote revision and unresolved socket revision before writing (`PageEditor.tsx:821–837`). A second parent-owned ledger rejects duplicate ids and ledger drift (`PageEditor.tsx:826–828,840`).
- Accepted content uses the existing isolated `replaceDocument` transaction; synchronous `handleContentChange` retains local-draft scheduling and draft revision changes (`PageEditor.tsx:837–840,717–722`; `MarkdownWorkspace.tsx:684–692`). Scoped selection test preserves unrelated typing and verifies undo; independent hunk test verifies separate undo operations (`PageEditor.spec.tsx:2395–2417`).
- Hook visibility and callbacks are bound to user/Space/page/write permission generation, and dispatch uses latest source/version with bounded intent (`usePersonalNotes.ts:11–24,36–56`). Missing/ambiguous anchors and storage failure retain original notes (`usePersonalNotes.spec.tsx:38–58`).
- The earlier redundant panel application check is removed while independent parent validation remains (`AgentAssistPanel.tsx:337–339`; `PageEditor.tsx:829–837`).

### Issues

#### Critical (Must Fix)

- None identified.

#### Important (Should Fix)

1. **[P2] Closing the drawer destroys candidates and permits the same note request to auto-submit again.** `PageEditor.tsx:1258–1259,1264–1284`: the Close action sets both open flags false, removing the subtree containing `AgentAssistPanel`. Its candidates, accepted-id ledger and `autoSubmittedRef` are component-local (`AgentAssistPanel.tsx:145,158–159,180–186`). For a ready or partially accepted candidate, close/reopen leaves only the server task's historical output; `loadTasks` never reconstructs a candidate without an existing generating entry (`AgentAssistPanel.tsx:221–224,498–503`). Linked notes remain awaiting review with no usable candidate to finish. For a failed or in-flight selected-note POST, the parent hook still retains the same `assistRequest`; closing/reopening resets the Set and `AgentAssistPanel.tsx:405–408` automatically POSTs the same id again. An in-flight first task can also succeed after unmount while its response is dropped (`AgentAssistPanel.tsx:377–378`), producing duplicate tasks. Keep the identity-scoped controller mounted when the drawer is hidden, or lift candidate/request/attempt state into a parent controller. Test close/reopen for generating/ready/partially accepted candidates, failed auto-submit, and a delayed first POST; each request id must auto-submit once across drawer visibility changes.

2. **[P2] Unchanged notes on the same line are marked resolved.** `usePersonalNotes.ts:75–84`: coverage is assigned using positional overlap with candidate edit items, but `createCandidateEdits` produces line-level edits (`assistTargets.ts:69–85`). Example: source `one and two`, two notes anchored to `one` (0..3) and `two` (8..11), dispatch both, candidate `ONE and two`. The single edit spans 0..11, so both notes receive `edit-1`; accepting it resolves both even though the second quoted passage was not changed. Adjacent unchanged passages inside an indivisible large edit have the same problem. This violates the note lifecycle's requirement to resolve linked accepted changes rather than declare unaddressed notes solved. Establish actual changed-span coverage within each edit (including insertions/deletions), or conservatively leave a note awaiting review when its passage cannot be shown to have changed; never infer note coverage from the line/container interval alone. Add same-line notes where only one passage changes, and an indivisible edit retaining one selected note passage unchanged.

#### Minor (Nice to Have)

- None additional.

### Assessment

**Task quality:** Needs fixes.

**Reasoning:** Live editor application and authorization/version gates are sound in this delta, but drawer lifetime defeats the advertised candidate/auto-submit continuity and line-level overlap produces false note resolution. Repair those two paths before the combined acceptance gate.

**Checks:** Reviewed all seven delta files from the frozen commit, updated Phase2B report, approved design and plan. No suite rerun: report records 354 tests/17 files, tsc and focused lint passing. Concrete focused checks outside delta: `reviewComments.ts:42–57` for task-bound lifecycle/dispatch; `assistTargets.ts:69–85` for hunk granularity; `AgentAssistPanel.tsx:221–224,377–408,498–503` for request/candidate lifetime; `PageEditor.tsx:338–408,717–734` for revoked authorization/current remote baseline/local-draft provenance; `MarkdownWorkspace.tsx:681–692` for synchronous isolated undo transaction. No product, index, branch or commit changes; only this report written.
