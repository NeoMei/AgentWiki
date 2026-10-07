# Independent F2 fix review — round 2

Decision: APPROVE for the Run association boundary fix. No actionable regression or remaining original F2 path established in this immutable patch.

Input: `/tmp/agentwiki-comprehensive-audit-20261007/run-boundary-fix-r1.patch`, independently verified SHA256 `e99f283f5403975364a786b9efeaee5ec4f1ceaee5329654819ee7ce833458c0`. Read the four specified files and relevant producer/schema/read-controller neighbors only. `git --work-tree=... apply --reverse --check <patch>` succeeded without applying anything, confirming patch compatibility with the fixed current files. Other authors' work was not reviewed or modified.

## Boundary behavior

- Run→Source is checked against the authorized Run Space; Source.get separately supplies its expected Space, closing its reverse-linked foreign Run alternative entry. Run detail denies incoherence with 404; list/source detail omit incoherent runs.
- Fixed input, result version, returned Source head and subsequently loaded Source head must belong to that Run Source. The helper validates the actual returned Source snapshot as well as current identities, so a repaired later head cannot sanitize an earlier bad response snapshot.
- Returned Evidence snapshots must match Run ID, Source ownership and, when present, fixed input. ChangeSet Space/run and item ownership are checked. Structured payload/before/changes source, version and evidence pointers are resolved and checked; arbitrary article text is not scanned.
- Null historical inputs/generations and older still-existing versions are preserved; active/current equality is deliberately not required. Same-Space payload references to another Source remain allowed. Relation evidence is allowed when its own Run/version associations are coherent, including same-Space evidence from another source rather than requiring it to be this ingestion source.
- Source.get preserves its previous compact ChangeSet shape after internal authorization fields are read. listRuns does the same. Existing raw allowed source/config/artifact content remains available, rather than unexpectedly replacing Source management with the narrower Page evidence DTO.
- Queries deduplicate IDs and batch at 200 per model. There is no per-Run authorization/lookup loop causing N+1 SQL. The service still relies on its existing controller to authorize the requested Space/Run and personal sources scope; this patch is not a new general authorization framework.

## Test review and independent execution

Read new corruption cases and positive controls. Tests invoke actual SourceService read paths with persistence mocked; the mocked snapshot and DB identity are separated in the repaired-head case. Existing lifecycle mocks now supply fields actually returned by Prisma, rather than weakening the new checks. No content-based redaction assertions masquerade as a source ownership check.

Independently ran from `agentwiki/apps/server`:
`./node_modules/.bin/jest --runInBand --no-cache --runTestsByPath src/knowledge-pipeline/source-run-read.spec.ts src/knowledge-pipeline/source.service.spec.ts`

Result: 2 suites PASS; 67/67 tests PASS; 3.333 s. Intentional audit-failure fixture logs an error but its test passes. The author's reported 74-test total includes a broader selection; this independent result is specifically these 67 tests. Root's DB/API corruption proof remains separate and was not run here. No product edits, build, services, DB or browser started.
