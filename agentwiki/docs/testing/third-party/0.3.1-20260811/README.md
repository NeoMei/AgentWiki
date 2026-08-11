# AgentWiki 0.3.1 Third-Party Test Run

## Authorization
- Production owner: project-owner-codex-thread
- Approved window: 2026-08-11 22:00 CST through 2026-08-12 02:00 CST
- Allowed testers: Codex controller and designated fresh subagents
- Approved admin D: user-d-3pt-20260811 (dedicated test `super_admin`)
- Required production-write prefix: `3PT-20260811-CODEX-`
- Scope: controlled production black-box acceptance
- Write-test prerequisite: all five authorization fields above must remain recorded and valid before any production write.

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
