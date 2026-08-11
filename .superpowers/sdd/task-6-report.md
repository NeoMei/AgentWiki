# Task 6 Report — Three-client onboarding and local knowledge synchronization

## Status

DONE — execution completed with an overall **FAIL** outcome. Spec section 16.8 triggered at SYNC-006, so further production write testing remains stopped pending owner-authorized cleanup remediation.

## Scope and window

- Production: `https://agentwiki.quukk.com`
- Package: `@neomei/agentwiki-local-sync@0.3.1`
- Cases: ONBOARD-001..007 and SYNC-001..006
- Production writes were limited to User A and `3PT-20260811-CODEX-*` resources in the existing test Space.
- No SSH or database operation was used.

## Case totals

- Total: 13
- PASS: 5
- FAIL: 8
- BLOCKED: 0
- P0: 4 PASS / 7 FAIL
- P1: 1 PASS / 1 FAIL

Passed: ONBOARD-002, ONBOARD-005, SYNC-002, SYNC-003, SYNC-005.

Failed: ONBOARD-001, ONBOARD-003, ONBOARD-004, ONBOARD-006, ONBOARD-007, SYNC-001, SYNC-004, SYNC-006.

## Task 6 defect totals and stop condition

- S0: 0
- S1: 0
- S2: 6 — non-canonical device URL; invalid Codex/Claude MCP registrations; incomplete preview totals; omitted deletion; fake-marker handling; uninstall/cleanup stop.
- S3: 1 — NDJSON onboarding processes remained open after terminal events.
- S4: 0
- Stop: `STOP-3PT-20260812-002` — all three normal uninstall paths left the isolated test gateway in configuration; no further production write test is authorized.

The earlier Task 4 S1 stop remains separately recorded and is outside these Task 6 defect totals. Downgrading the isolated, unconfirmed fake-marker finding to S2 does not change SYNC-004 or the final release result: both remain **FAIL**.

No uncontrolled duplication, silent overwrite, non-3PT write, or production health regression was observed.

## Three-client onboarding result

- Codex, Claude Code, and OpenCode each completed Device Auth and created exactly one prefixed Agent, credential, grant binding, and local connection in its own isolated home.
- The primary Codex flow was interrupted and resumed before plan confirmation and before sync confirmation; exactly one Codex Agent remained.
- Denied and naturally expired requests created no Agent. Re-polling the consumed request returned `authorization_consumed` and no credential.
- All three generated authorization URLs used a non-canonical, non-HTTPS origin and required replacing only the origin with the public HTTPS production origin.
- OpenCode passed all nine doctor checks. Codex and Claude Code failed only `mcp-registration`; their generated entries were present but not accepted by the clients.

## Synchronization result

- SYNC-001 created and updated the expected synthetic pages, but deletion of `obsolete.md` was absent from both the preview contract and the resulting ChangeSet.
- The second environment pulled the same authoritative Revision as the first.
- A stale second-environment push was rejected with an explicit authoritative-revision-changed response. Pull, explicit merge, and repush preserved both branches, and observed Revision values advanced consecutively.
- Two unchanged syncs returned `noop`, retained the same Revision, and created no ChangeSet.
- The fake-marker preview was isolated and unconfirmed. It created no remote ChangeSet or page and was removed before subsequent synchronization.

## Resource inventory

Sanitized individual handles are in `evidence/04-onboarding-sync/TASK6-resource-inventory.json`:

- 6 Device Request handles, including the separate consumed-request handle retained by ONBOARD-006 evidence
- 3 Agents
- 3 credential records
- 3 Agent-to-Space grant bindings
- 3 local connections
- 11 local jobs and 11 previews
- 7 submissions and 7 ChangeSets
- 4 pages and 3 recorded page versions
- 5 authoritative Revisions
- 0 Sources and 0 Runs created by Task 6

Raw identifiers and credentials are not present in tracked artifacts.

## Configuration and uninstall result

- Before onboarding, each isolated config contained one synthetic unrelated MCP entry and no `agentwiki` entry.
- After onboarding, each contained exactly one unrelated entry and one `agentwiki` entry.
- Product uninstall result:
  - Codex: non-zero exit; gateway and connection remain.
  - Claude Code: non-zero exit; gateway and connection remain.
  - OpenCode: zero exit and connection removed, but the gateway entry remains orphaned.
- All unrelated entries remain present. No daily client configuration was read or modified.
- The isolated root remains retained for Task 8 remediation and verification.

## Evidence and safety validation

- Four retained PNGs were visually inspected: correct client/version or denial state; no email, credential, code, or raw resource ID visible.
- Structured evidence stores only counts, statuses, booleans, safe names, and SHA-256 handles.
- Records-only remediation does not access production or isolated temporary homes.
- JSON validation, evidence-reference checks, focused secret/raw-ID scans, and `git diff --check` are required before the remediation commit.

## Commits

- Task 6 execution records: `7241aa7` — `test: record three-client onboarding and sync acceptance`
- Records-only independent-review remediation: this remediation commit.
