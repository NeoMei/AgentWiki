### Spec Compliance

- ❌ Fixround1 `dfd4bbba..0e47dfdc`: drawer continuity issue ADDRESSED; note false-resolution issue NOT ADDRESSED in full. The original separate-note cases are repaired, but a mixed multi-hunk note can still resolve before every overlapping change is accepted.

### Original Findings

1. **ADDRESSED — drawer/candidate lifetime and once-only auto-submit.** `PageEditor.tsx:171,612,816,1262–1269` keeps the controller mounted after its first opening, hides the drawer instead of removing it, and resets mounted state only with account/page lifecycle. Existing candidate ledger, polling/socket lifecycle and attempted-id Set therefore survive Close and notes/candidate switches. New behavior tests cover generating/ready/partial close/reopen and failed/delayed POST close/reopen, including one POST and usable remaining hunk (`PageEditor.spec.tsx:2433–2458`).

2. **NOT ADDRESSED — [P2] ambiguous hunk omission lets multi-hunk notes resolve early.** `usePersonalNotes.ts:10–20,91–98`: the new boolean returns false both for unchanged passage and uncertain retained excerpt. Coverage filters away uncertain hunks rather than blocking resolution. Example: one note quotes the whole `one\nkeep\ntwo` (0..12); candidate is `ONE\nkeep\nnew two old`. The line edit plan contains `edit-1` (`one\n` → `ONE\n`) and `edit-2` (`two` → `new two old`). `editChangesPassage` accepts edit-1 but rejects edit-2 because `two` survives anywhere in its result. The note's coverage becomes only `[edit-1]`; accepting edit-1 resolves the note while the edit-2 changes remain unaccepted. This contradicts both the “every mapped change” gate and the repair's stated “ambiguous correspondence stays awaiting review” policy. Distinguish unchanged/no-overlap from uncertain overlap (for example a tri-state result), and leave the note unresolved whenever any overlapping hunk is uncertain; alternatively require all intersecting hunks accepted in addition to positive actual-change evidence. Add a single note spanning one definite changed hunk plus one retained/ambiguous changed hunk, accepting only the definite hunk first.

### Strengths

- Actual prefix/suffix trimming repairs the original same-line and long indivisible examples; tests also cover insertion, deletion and unchanged interior quote (`usePersonalNotes.ts:11–20`; `usePersonalNotes.spec.tsx:79–102`).
- Page/account lifecycle clearing remains explicit and existing application/local-draft/version guards are not modified in this repair (`PageEditor.tsx:612–613`; package limits parent changes to mounted visibility).
- Mechanical lint changes preserve behavior: unnecessary regex escapes removed without changing bracket/backslash/newline handling (`commands.ts:25,55`); tree error wrapping retains localized message and original failure via `Object.assign(...,{cause:failure})`, without requiring the newer Error options constructor (`SpaceView.tsx:352,361,368`).

### Assessment

**Task quality:** Needs fixes for note resolution; drawer fix approved.

**Checks:** Read exact review package and appended repair report; no suite rerun. Report records 364 tests/17 files, tsc and touched-file lint passing. One read-only Node probe executed the exact new `editChangesPassage` function extracted from source with the two edits above and returned `covered:["edit-1"], accepted:["edit-1"], wouldResolve:true`. A focused regex equivalence probe confirmed old/new lint regex behavior for brackets, backslash, pipes, CR/LF and Chinese text. Focused unchanged CSS check (`index.css:73–78`) confirmed the drawer class does not override native hidden display. No product/index/branch mutations or agents; only this report written.
