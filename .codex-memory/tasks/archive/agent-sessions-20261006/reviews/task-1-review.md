# Task 1 independent review

- Reviewer: `sessions_backend_review`, read-only product review; no child reviewers.
- Candidate: `8489c685a131433d02fcd7ff934e0da220b723e8`.
- Immutable range: `b43593e9..8489c685` (includes the two coordinator-approved specification amendments).
- Review package SHA256: `b15d98a94a2269c64002afe80d7e7ef0b05a80973b579fa918b2c115e43f1f77`.
- Reviewed the supplied brief/report, amended specification, complete fixed diff in bounded chunks, and required surrounding authorization/locking code. Current/brief coordinator work outside the candidate was excluded.
- No product patches, gate writes, DB mutations, model requests, or rerun of passed suites.

## Verdicts

- **Specification compliance: CHANGES REQUESTED.** The durable API, separation of question/proposal, bounded inputs/output, cancellation, annotation snapshots, runtime boundary and authorization defenses substantially match Task 1. The three findings below prevent accepting independent-worker execution, continuous cross-document context and dependable session recovery.
- **Code quality: CHANGES REQUESTED.** Resolve the missing worker dependency, context replay and list failure coupling before Task 1 approval. No additional actionable security/SQL issue found in this bounded review.
- **Migration: APPROVED**, independently and separately from the product verdict, for the exact corpus and SQL hashes below. Isolated PostgreSQL application/concurrency acceptance remains a subsequent gate.

## Findings

### [P1] Register the session service in the independent worker dependency graph

Location: `agentwiki/apps/server/src/assist/assist.queue.ts:42`; required wiring is absent from `agentwiki/apps/server/src/worker.module.ts:29–36`.

`AssistQueue` now relies on `AssistSessionService` to authorize and construct every session turn, but the implementation registers this service only in `AssistModule`. The independent `WorkerModule` constructs its own `AssistQueue`, does not import that module and does not provide the session service. `@Optional()` lets Nest compile while injecting `undefined`; the first session execution enters `sessionContext()` and throws `Session authorization unavailable`. Thus the normal split API/worker topology accepts new turns and immediately fails them without starting the provider. This is a complete outage for the new feature in that supported topology.

Register/export the required session service through a worker-compatible module or the existing worker providers, preserving the no-HTTP-controller worker boundary. Avoid making the security dependency silently optional for production merely to retain old manual constructor tests. Add a real Nest dependency graph assertion that resolves `AssistQueue` with a usable session service, and verify a queued session reaches the fixture CLI under independent API and worker processes.

Independently compiled the actual built `WorkerModule` with `Test.createTestingModule({ imports: [WorkerModule] }).compile()` (no initialization/DB/model request). The probe returned:

```json
{"probe":"real-worker-nest-di","compiled":true,"assistQueueResolved":true,"sessionServiceInjected":false}
```

The current worker-module test only asserts that the module and `TemplateEffectsService` resolve; it cannot catch this optional dependency omission. The coordinator additionally reported the matching isolated runtime symptom: a successfully persisted session task fails immediately with zero attempts and the fixture CLI never starts. The reviewer independently confirmed the DI mechanism, not that separate runtime receipt.

### [P2] Preserve immutable source context in bounded historical replay

Location: `agentwiki/apps/server/src/assist/assist-session.service.ts:136–138` (`AgentHistoryTurn` also needs the corresponding typed contract).

`executionContext()` serializes only the old intent, summary, mode, page ID, candidate changes and annotations. It omits that turn's `pageSnapshot` and server-captured reference snapshots. The built-in provider starts a fresh CLI for each turn and advertises `resume: false`, so after asking about A with reference R, navigating to B and following up about an A/R detail that was absent from the first answer gives the model neither original source. The history window can report `included: 1, omitted: 0` even though the source context needed for the included conversation turn has disappeared. This defeats the explicitly requested continuous cross-document follow-up behavior; preserved browser history alone cannot fix the runtime input.

Include the relevant immutable source/reference snapshot and version data in each selected canonical history item, retaining current live authorization and the existing 10-turn/120000-character total window. Do not fetch current bodies in place of historical versions or add an unbounded context union. Add a regression in which the first answer omits unique source/ref markers, a second turn uses another page, and the actual runtime input still contains those markers and their original versions within the declared window.

Targeted probe against the built candidate's actual service (bounded persistence doubles, no model/DB) returned:

```json
{"history":[{"intent":"Summarize A","answer":"A is a document","mode":"question","pageId":"a"}],"hasOriginalA":false,"hasOriginalR":false,"historyWindow":{"included":1,"omitted":0,"maxTurns":10,"maxCharacters":120000}}
```

### [P2] Keep an inaccessible conversation from disabling the whole session list

Location: `agentwiki/apps/server/src/assist/assist-session.service.ts:41`.

The sequential `authorizedTurns()` check throws out of `list()` as soon as any one of the latest 50 conversations references a deleted/moved source (or has lost its proposal role). Consequently an independently valid or newly created conversation cannot be discovered through the list after refresh. There is no conversation deletion API in this contract to let the user remove the offending entry, and creating another conversation does not repair the list while the old one remains in the selected 50. This extends a single conversation's intentional fail-closed boundary to every unrelated conversation.

Exclude inaccessible summaries without returning their title or context, or provide another contract-compatible recovery path that still lets currently authorized conversations be listed. Preserve failure of direct content-bearing operations on the inaccessible conversation, and do not broadly swallow database failures. Add a regression with one deleted-source conversation and one valid conversation: the list must return the valid one without leaking the invalid one's metadata.

The targeted service probe confirmed that `get('good', 'user')` succeeded while `list('space', 'user')` returned HTTP 400 `Session page must exist in the selected Space` solely because another conversation lost its source.

## Security and lifecycle assessment

- Ownership is derived from human authentication and bound to both user and Space. Each source/ref remains checked against current same-Space, non-deleted Pages, including historical turns before read, send, execution, progress, publication and cancellation.
- The existing User → Space lock order is used with live principal checks. Send adds the session row lock; database request-key and active-turn indexes provide concurrency backstops. Full DB behavior is not inferred from serialized test doubles.
- Viewer questions and edit-role proposals are separated; malformed question changes fail and public result fields are explicitly selected. Legacy task APIs exclude session rows, and the socket relay independently rejects their events.
- Annotation body/quote/IDs are explicitly submitted, bounded, persisted and quoted against the sent snapshot. The service does not consult local note stores. Current source editing preserves historical display while rejecting stale active execution.
- Worker signal propagation, 500ms liveness checks, independent lease timer, guarded progress/completion writes and recovery predicates prevent observed cancellation resurrection or late successful publication. Router abort does not trigger fallback. The runner sends SIGTERM and has a five-second SIGKILL grace path.
- CLI progress for sessions is complete parsed summary text; it does not route raw reasoning, tool events or usage through session sockets. Existing legacy behavior remains separately gated.
- Runtime documentation marks ACP as a future local connector and disables unimplemented tools/permissions/native resume capabilities.

## Evidence and limits

Inspected the implementation's final log artifacts, without rerunning the successful suites:

- `/tmp/agentwiki-sessions-20261006/task1/server-final.log`: **159 passed suites, 5 skipped suites; 2866 passed tests, 26 skipped; zero failures**, 22.052 seconds.
- Recorded server typecheck/build and Prisma validation logs are successful; scoped lint and red/green work are described in the implementation report.
- The reviewed test code bypasses the spawn mock for one blocked Node fixture, waits for real stdout and close, checks SIGTERM and verifies PID disappearance. This is actual OS process termination evidence for the fixture, not an external-model request or external-model quality acceptance. The integration API/Redis/DB fixture, resistant-child SIGKILL path, rendered UI and real provider are not independently exercised here.
- Small probes targeted the previously uncovered worker DI and replay/list concerns. An allowed 90192-character Chinese context produced a 270625-byte prompt that spawned successfully on this Darwin host. The initial conclusion not to raise an argument-size issue was too broad: this only established Darwin behavior. The Linux portability finding in the addendum below corrects that assessment.

## Explicit migration approval

**APPROVED:** `agentwiki/apps/server/prisma/migrations/20261006200000_assist_sessions/migration.sql` in candidate `8489c685a131433d02fcd7ff934e0da220b723e8`.

- New SQL SHA256: `4eb3800ffc053830ab75ece50643d10d2224fa5d704f62364f1fb0d7553df690`.
- Reviewed complete corpus: **61 files**, SHA256 **`39e27b72da1e030c676cb858b642c3f231d6ddc4d5f531b7f4749f45c9ced7a5`**.
- Independently recomputed the existing corpus by excluding exactly the new migration: **60 files**, SHA256 **`4fa1e4a38a70ea63e2e7c62d24913edfb3f9fa499bb98d43463bc639acd11767`**, equal to the prior approved hash. The immutable range changes no existing migration.
- Inspected all 30 new SQL lines and corresponding Prisma additions. Required session user/Space relations, defaults, timestamps, nullability, cascade FKs, request unique index and ordered indexes agree. Existing tasks remain nullable-session proposals. The session context/request check does not conflict with existing task requester/Page SET NULL actions. The deliberate partial active-turn index is a valid PostgreSQL backstop not expressible by Prisma's model declaration.
- Global DDL boundary is unchanged: no extension, database setting, role, schema-global object or explicitly `public` operation is added. Existing pgvector/HNSW reviewed fragments and their byte-exact replacement safeguards remain untouched.

The coordinator may update only the two approved corpus-hash constants to this exact digest and run the protected isolated DB acceptance. This approval does **not** claim migration application, production deployment, or final Task 1 product approval, and it does not authorize weakening any gate.

## Addendum: fourth finding and correction of the Darwin-only assessment

### [P2] Transport accepted long prompts outside argv on Linux

Original candidate location: `agentwiki/apps/server/src/assist/opencode.runner.ts:42` and `:80–83`.

Both original CLI entry points put the complete prompt in a single process argument. Linux limits each argument/environment string to 32 pages (`MAX_ARG_STRLEN`), normally 128 KiB on 4 KiB-page hosts, separately from the aggregate argv/environment allowance. An allowed 90192-character context generated 270625 UTF-8 bytes in the reviewer fixture; that valid request exceeds the normal Linux per-string limit before the provider can start. The Darwin success above cannot establish Linux compatibility. This is a source/manual-based portability finding, not a claimed Linux-host reproduction. See the primary [Linux execve manual](https://man7.org/linux/man-pages/man2/execve.2.html).

Use supported stdin prompt transport, with EOF, cancellation and input-error handling, while keeping existing content limits. The pinned [OpenCode 1.18.12 run source](https://github.com/anomalyco/opencode/blob/v1.18.12/packages/opencode/src/cli/cmd/run.ts#L400-L402) reads non-TTY stdin into the run input. Require a large multibyte real-process fixture and cancellation/EPIPE regression coverage. This fourth finding is reviewed together with the first three in `task-1-rereview.md`; the original product verdict remains changes requested for `8489c685` and is superseded only by that later candidate-specific receipt.
