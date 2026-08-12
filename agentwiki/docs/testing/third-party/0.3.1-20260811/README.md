# AgentWiki 0.3.1 Third-Party Test Run

## Authorization
- Production owner: project-owner-codex-thread
- Approved window: 2026-08-11 22:00 CST through 2026-08-12 02:00 CST
- Allowed testers: Codex controller and designated fresh subagents
- Approved admin D: user-d-3pt-20260811 (dedicated test `super_admin`)
- Required production-write prefix: `3PT-20260811-CODEX-`
- Scope: controlled production black-box acceptance
- Write-test prerequisite: all five authorization fields above must remain recorded and valid before any production write.

### Continuation authorization after STOP-3PT-20260811-001

- Decision: production owner selected continuation option 1 in the Codex thread.
- Fresh approved window: 2026-08-11 23:34 CST through 2026-08-12 05:34 CST.
- Admin D exception: the dedicated test `super_admin` may passively see production-wide administrative metadata that the Dashboard renders automatically.
- Hard boundary: testers must not open, inspect, search for, or mutate any non-`3PT` Space, user, or resource. Non-test content, personal data, or any non-`3PT` write remains an immediate stop condition.
- All other isolation, prefix, evidence-redaction, and cleanup rules remain unchanged.

## People
- Test lead: Codex controller
- Testers: Codex controller and designated fresh subagents
- System contact: project-owner-codex-thread

## Environment
- Production URL: https://agentwiki.quukk.com
- Browser/version: Google Chrome 151.0.7922.76
- Node.js version: v24.18.0
- Codex version: codex-cli 0.147.0-alpha.6.5
- Claude Code version: 2.1.211
- OpenCode version: 1.18.16
- Isolated client homes: prepared for Codex, Claude Code, and OpenCode; see cleanup-checklist.md.

## Test Identities
- User A sanitized identifier: user-a-3pt-20260811 (dedicated ordinary human test user)
- User B sanitized identifier: user-b-3pt-20260811 (dedicated ordinary human test user)
- User C sanitized identifier: user-c-3pt-20260811 (dedicated ordinary human test user)
- Admin D sanitized identifier: user-d-3pt-20260811 (dedicated test `super_admin`)
- Credential handling: credentials remain outside this repository and this execution pack.

## Artifact Index
- Case matrix: case-matrix.csv
- Execution report: execution-report.md
- Defects: defects.md
- Cleanup: cleanup-checklist.md
- Residual data: residual-data.md

### Continuation authorization after 0.3.2 defect fixes (2026-08-12)

- Decision: production owner authorized retest after all seven Task 6 defects were fixed, tested, and published as `@neomei/agentwiki-local-sync@0.3.2`.
- Fresh approved window: 2026-08-12 17:30 CST through 2026-08-13 01:30 CST.
- Scope: re-run Task 6 (ONBOARD-001..007, SYNC-001..006) against 0.3.2 to confirm fixes, then continue Tasks 7-8.
- Production DEF-001 config fix already verified live; 0.3.2 code adds defense-in-depth.
- All prior isolation, prefix, evidence-redaction, cleanup, and stop-condition rules remain in force.
