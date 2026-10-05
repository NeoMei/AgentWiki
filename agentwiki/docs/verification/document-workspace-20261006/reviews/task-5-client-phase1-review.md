### Spec Compliance

- ❌ Issues found within the CLIENT phase1 scope: malformed original note offsets are not rejected by persistence validation (`agentwiki/apps/client/src/features/page/reviewComments.ts:13-14`).
- ✅ Scoped helpers validate original quotes, UTF16 boundaries and candidate prefix/suffix protection; live application requires a unique unchanged contextual anchor (`assistTargets.ts:25-54`).
- ✅ Hunk acceptance recalculates expected source with the accepted ledger, applies offsets in reverse source order, and refuses repeated acceptance (`assistTargets.ts:87-103`). The supplied tests exercise CRLF, insertions, deletions, reverse order and overlap refusal (`assistTargets.spec.ts:19-74`).
- ✅ Personal notes use an explicit user/Space/page storage key and require matching task linkage for readiness and acceptance; dispatch does not resolve notes (`reviewComments.ts:16,38-55`). The panel labels privacy and retains orphan quotes (`PersonalNotesPanel.tsx:20-31`).
- ✅ ReviewPage reads the authorized current page and verifies returned page/Space identity, calls a matching version current content, and warns when the proposal baseline is missing/stale (`ReviewPage.tsx:26-46`). Its diff changes neither approval nor per-item decision preconditions (`ReviewPage.tsx:395-400`).
- ⚠️ The explicit controller phase1 boundary defers PageEditor/AgentAssistPanel integration, transport/server authorization, task-note linkage and atomic source/ledger application. Those are not missing-phase1 findings; the controller must check them at the later integrated gate. No historical snapshot API is introduced in this phase.

### Strengths

- Scoped candidate validation checks all original content outside the submitted target before extracting replacement text, and ambiguity fails closed (`assistTargets.ts:34-54`).
- Source-line decomposition retains separators and bounds the LCS matrix; acceptance reconstructs prior accepted changes before locating the next hunk (`assistTargets.ts:58-103`).
- Notes retain their original quote on orphaning and distinguish successful dispatch, completion awaiting review and explicit resolution (`reviewComments.ts:38-55`, `PersonalNotesPanel.tsx:27-31`).
- Current-page read failure exposes candidate text without inventing a baseline; metadata remains visible and downloads retain full Markdown (`ReviewPage.tsx:36-51`).

### Issues

#### Critical (Must Fix)

- None found in the reviewed phase1 slice.

#### Important (Should Fix)

- **P2 — Reject malformed original offsets before normalizing context validation.** `agentwiki/apps/client/src/features/page/reviewComments.ts:13-14`: `validNote` compares/subtracts the persisted `from`/`to`, then replaces both with integer context offsets before calling `validateAssistTarget`. Consequently both `{from: 7.5, to: 12.5}` and `{from: "7", to: "12"}` for the original five-character `quote` are accepted by `loadPersonalNotes` as `loaded` and `savePersonalNotes` as `saved`. The same loaded note subsequently fails `notesForDispatch` because `resolveAssistTarget` correctly rejects these offsets. This contradicts the malformed-record contract and turns corrupt records into permanently undispatchable notes that may be persisted again. Validate the original `from` and `to` as safe integers and nonnegative ordered offsets before deriving the context-local target. Add focused cases for fractional and string offsets to the existing malformed-persistence test; both load and save should report `invalid` and preserve the original stored bytes.

#### Minor (Nice to Have)

- None.

### Assessment

**Task quality:** Needs fixes.

**Reasoning:** The phase1 behavior and later integration boundary are clear, and the scoped-edit/ReviewPage changes meet the visible contracts. One reproducible persistence-validation defect should be fixed before relying on these helpers in phase2.

### Checks and evidence

- Read the supplied immutable `review-4dd0294a..ac3a7734.diff` once. The tool truncated its middle, so only that omitted segment was retrieved to complete the same pass; no changed source files were reread and no outside code was crawled.
- Focused read-only reproduction transpiled only the supplied diff versions of `assistTargets.ts` and `reviewComments.ts` in memory. The outline import was stubbed and unused by the selection-only reproduction. Fractional/string persisted offsets each produced `loaded`, `saved`, then dispatch `conflict`; an inconsistent unsafe-integer range was rejected.
- The implementer reports 52 tests, TypeScript, lint and diff-check passing. These are reported evidence, not independent reruns; no suite was repeated. Existing malformed-range coverage checks length inconsistency (`reviewComments.spec.ts:40-49`) and misses the coercible/fractional cases above.
