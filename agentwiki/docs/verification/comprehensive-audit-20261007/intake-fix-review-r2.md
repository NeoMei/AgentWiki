# Independent F1 fix review — round 2

Decision: APPROVE. No actionable finding in the reviewed patch.

Immutable input: `/tmp/agentwiki-comprehensive-audit-20261007/intake-fix-r1.patch`, SHA256 `3196863a47652c32244ea37c5bfceb676c17276647678cda5acca328d4e96a24`. Independently verified the hash, and verified the exact current two-file diff produces that same SHA256. Did not review or modify other in-flight author changes.

## Correctness

- Existing identity resolution now has an empty upsert update. The source is locked and the receipt (including its inputHash) checked before metadata updates. Ordinary, noop and legacy receipt returns therefore cannot rewrite a later source name/kind/producer.
- First intake retains unchanged create metadata; its subsequent metadata update is redundant but consistent and is inside the same transaction. New accepted inputs still update metadata before their version/head/run/receipt are committed.
- Lock order remains principal → Space advisory/Space row → Source. Intake already obtains `lockSourceMutationSpace` before upsert. Empty upsert does not move the lock boundary or introduce a new lock order. Same-Space concurrent first-source intake remains serialized by the existing Space lock, and the unchanged unique-conflict fallback reacquires live authorization/Space/Source before receipt lookup.
- Archived-source rejection still occurs through `lockSourceHead`. Content mismatch still fails through `findReceipt`. The previous implementation would already roll back mismatched-input metadata writes in a real Prisma transaction; this fix must not be described as preventing a previously committed mismatch pollution bug.

## Test causality and independent verification

The updated fixture applies upsert.update, correcting the previous mock that masked the actual defect. Ordinary/noop/manual-rename cases compare source metadata plus head, versions, runs and receipts before and after a replay. Their metadata differences directly distinguish the old code from the fix; checking B metadata before replay also verifies that newly accepted metadata is not accidentally disabled.

The mismatch test establishes the stronger ordering property in an in-memory mock without rollback. It is useful as an ordering guard but is not evidence of old production committed-state corruption. Unit mocks do not prove PostgreSQL concurrent-first-source behavior; lock reasoning above supports compatibility, and root owns runtime/DB validation.

Independently ran:
`./node_modules/.bin/jest --runInBand --no-cache --runTestsByPath src/knowledge-pipeline/knowledge-sync.service.spec.ts`
from `agentwiki/apps/server`: 1 suite PASS, 13/13 tests PASS, 2.629 s. No product edits, build, DB/runtime or browser started. Original defect evidence remains `backend-idempotent-replay-proof.json` and root's actual API reproduction is separate.
