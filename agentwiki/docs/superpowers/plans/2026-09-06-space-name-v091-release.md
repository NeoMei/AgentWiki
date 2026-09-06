# Space name validation v0.9.1 release

**Goal:** Publish and deploy the verified 32-character Space-name fix.
**Architecture:** Patch release of app/server/client/Local Sync to 0.9.1; retain protocol 0.6.0 and accept both installed 0.9.0 and new 0.9.1 onboarding clients. Preserve raw onboarding plan/hash and old CLI replay compatibility.
**Tech Stack:** pnpm, TypeScript, NestJS, React, PostgreSQL, Redis, npm, systemd.
**Spec:** User authorized release of commit 6e677804; accepted behavior recorded in `.codex-memory/current.md` and existing tests.

## Global Constraints
- Work only in the existing isolated feature worktree. Always override Git work-tree because shared core.worktree points at main.
- Do not republish protocol 0.6.0 or overwrite Local Sync 0.9.0. Do not edit historical release evidence.
- Preserve production env files, current Space allowlist, attachments, DB data, unrelated main-worktree files.
- Controller owns authenticated production preflight, coordinated backup, merge/push, npm publication, deployment and real public acceptance. User already authorized all release steps.
- Report package, source, deployment and functional acceptance separately. No mocked browser evidence may be called public acceptance.

### Task 1: Prepare 0.9.1 source and packages
- [ ] Inventory active version/default/compatibility surfaces using repository tools; add focused tests that prove 0.9.0 and 0.9.1 accepted, unsupported versions rejected, newly issued package matches requested version.
- [ ] Bump current app/server/client/root/Local Sync versions to 0.9.1, active install guidance and configuration defaults; keep protocol 0.6.0. Maintain exact old plan/hash compatibility.
- [ ] Run affected tests, typecheck, lint and builds. Run release collision gate, protocol registry parity, Local Sync candidate clean install against registry protocol. Record exact tested artifact path/hash and commands/results.
- [ ] Commit only scoped release source/tests/docs and report. Do not push, publish or deploy.

### Task 2: Review and release gates
- [ ] Independent task review of Task 1, then whole-branch review from 9e6dc9a9 covering name fix plus release compatibility.
- [ ] Run appropriate full regression stages on frozen final source with isolated DB/Redis. Record all failures and resolved results accurately.
- [ ] Confirm npm/GitHub auth, target SSH and current app/services, backup wrapper integrity, main/remote Git state and preservation snapshot.

### Task 3: Publish and deploy (controller)
- [ ] Create release-owned pre-upgrade legacy-name fixture, preserve fixture IDs privately.
- [ ] Fast-forward main while preserving unrelated work, push source; publish tested Local Sync 0.9.1 artifact and verify fresh public install/help.
- [ ] Execute reviewed coordinated DB+attachments+app+unit backup and deployment to root@113.249.120.24:/root/agentwiki; verify manifest, env preservation, migrations, services and health.
- [ ] Verify actual public browser/API 32 accept/33 reject, trim, legacy-name settings save and rename persistence; test old/new onboarding version acceptance. Remove owned fixtures.
- [ ] Tag and GitHub Release with accurate evidence; update project current and release verification document, commit/push documentation.
