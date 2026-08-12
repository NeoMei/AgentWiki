# Task 6 Retest Report — 0.3.2 production acceptance

## Outcome

**BLOCKED** — the newly published `@neomei/agentwiki-local-sync@0.3.2` package could not start Device Authorization against production.

The pinned Codex onboarding command emitted `input_required`, accepted the approved isolated 3PT inputs, then emitted `failed` with `REMOTE_UNAVAILABLE`. A focused direct probe of the same production Device Start endpoint returned HTTP 400 and reported that only package versions `0.3.0` and `0.3.1` were accepted. No `authorization_required` event was emitted, no Device Request was created, and no server-side AgentWiki resource was created.

Per the retest brief, paths that cannot be safely completed are marked BLOCKED rather than forced to PASS. Further production writes stopped after the blocker was confirmed.

## Scope and safety

- Branch/base: `codex/third-party-test-spec` on `b589190`.
- Package: exact `0.3.2`; npm `latest` was also `0.3.2` at preflight.
- Window: execution began within the approved 2026-08-12 17:30 CST–2026-08-13 01:30 CST window.
- Production health before and after the failed start: API, database, Redis, and audit persistence all reported `ok`.
- Credential file mode: `0600`; no credential, raw ID, email, cookie, token, or absolute isolated path was captured.
- Three fresh isolated client homes were created; daily Codex, Claude Code, and OpenCode configurations were not accessed.
- The fresh isolated root was removed after the pre-auth blocker. No server cleanup was required.
- No SSH or database operation was used.
- Spec §16 stop conditions triggered: none.

## Case results

| Case | Result | Evidence-based reason |
|---|---|---|
| ONBOARD-001 | BLOCKED | Production rejected `packageVersion: 0.3.2` before Device Auth, so the canonical HTTPS authorization URL and Chrome behavior could not be observed. |
| ONBOARD-003 | BLOCKED | No 0.3.2 onboarding-created MCP registration existed for safe three-client `doctor` verification. |
| ONBOARD-004 | BLOCKED | No authenticated onboarding preview could be produced. |
| ONBOARD-006 | BLOCKED | The pre-auth failed terminal exited 0.042 seconds after the terminal event, but completed/denied/expired terminal paths could not be reached; this is insufficient to confirm the defect fixed. |
| ONBOARD-007 | BLOCKED | Three-client Device Auth, confirmation, installation, and doctor flows could not begin. |
| SYNC-001 | BLOCKED | No 0.3.2 connection could be created, so add/modify/delete totals and the obsolete-page deletion candidate were not exercised. |
| SYNC-004 | BLOCKED | No 0.3.2 connection could be created, so fake-token skip/redaction and preview-state absence were not exercised. |
| SYNC-006 | BLOCKED | No 0.3.2 gateway could be installed, so the uninstall round-trip and byte-for-byte unrelated-entry preservation could not be exercised. |

Totals: **0 PASS / 0 FAIL / 8 BLOCKED**.

## Defect confirmations

| Defect | Retest status | Confirmation |
|---|---|---|
| DEF-3PT-20260812-001 | BLOCKED | Not confirmed fixed. Device Auth did not start. |
| DEF-3PT-20260812-002 | BLOCKED | Not confirmed fixed. Registrations and doctor checks were not created/reached. |
| DEF-3PT-20260812-003 | BLOCKED | Not confirmed fixed. Preview was not reached. |
| DEF-3PT-20260812-004 | BLOCKED | Not confirmed fixed. Deletion candidate flow was not reached. |
| DEF-3PT-20260812-005 | BLOCKED | Not confirmed fixed. Fake-token preview was not reached. |
| DEF-3PT-20260812-006 | BLOCKED | Not confirmed fixed. Only the pre-auth failure process exit was observed, not the required completed/denied/expired paths. |
| STOP-3PT-20260812-002 | BLOCKED | Not confirmed fixed. There was no installed 0.3.2 gateway to uninstall. |

## Blocker evidence

- `RETEST-ENV-001-preflight.json`: package, health, mode, isolation, and window checks.
- `RETEST-ONBOARD-001-device-start-blocked.json`: sanitized CLI event sequence, HTTP status/message, process exit timing, and zero-resource result.
- `RETEST-TASK6-blocked-summary.json`: eight-case and seven-defect conservative disposition.

## Required next action

Production must accept package version `0.3.2` on `/api/onboard/device/start` before these eight acceptance cases can be meaningfully rerun. This report does not claim any of the seven previous defects fixed.
