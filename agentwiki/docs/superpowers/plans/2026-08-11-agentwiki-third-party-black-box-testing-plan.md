# AgentWiki 0.3.1 Third-Party Black-Box Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a complete third-party test pack, execute the approved production-safe black-box cases, remove every test resource, and issue a defensible AgentWiki 0.3.1 acceptance decision.

**Architecture:** Treat the approved Spec as the immutable test contract. Build reusable reporting artifacts first, then execute tests in risk-ordered batches with explicit entry/exit gates; production writes are limited to `3PT-*` resources, and cleanup is a blocking final task rather than an informal afterthought.

**Tech Stack:** Markdown/CSV evidence pack, Chrome stable, Chrome 390px viewport, Node.js, npm, Codex, Claude Code, OpenCode, HTTPS production site `https://agentwiki.quukk.com`.

## Global Constraints

- Execute only against `https://agentwiki.quukk.com` after the production owner authorizes the test window.
- Every created entity name must begin with `3PT-20260811-测试员缩写-序号`.
- Never use or record real passwords, tokens, cookies, API keys, Device Codes, customer data, private repositories, or personal files.
- Do not perform load, stress, DoS, brute-force, port-scan, or unapproved vulnerability-exploitation testing.
- Use isolated HOME/config directories for Codex, Claude Code, and OpenCode.
- Stop immediately on any condition in Spec section 16.
- P0 pass rate must be 100%; P1 pass rate must be at least 95%; no open S0/S1/S2 defects are allowed.
- Cleanup is incomplete until the residual-data list is empty and the production health endpoint is green.
- The authoritative requirements are in `docs/superpowers/specs/2026-08-11-agentwiki-third-party-black-box-testing-design.md`.

---

## File Structure

The execution creates the following focused artifacts under one run directory:

```text
docs/testing/third-party/0.3.1-20260811/
├── README.md                 # Run identity, authorization, environment, people, and final artifact index
├── case-matrix.csv           # One row per Spec case with result, evidence, defect, and cleanup state
├── execution-report.md       # Batch summaries, metrics, deviations, risks, and acceptance decision
├── defects.md                # S0-S4 defect records and retest status
├── cleanup-checklist.md      # Every created entity/config and its verified removal
├── residual-data.md          # Empty-on-success list of resources that could not be removed
└── evidence/
    ├── 01-baseline/
    ├── 02-auth-space-page/
    ├── 03-source-review-agent/
    ├── 04-onboarding-sync/
    ├── 05-admin-ux-security/
    └── 06-cleanup/
```

Screenshots and recordings are stored outside Git when they contain account identifiers. Markdown/CSV files reference only sanitized evidence filenames.

---

### Task 1: Build the third-party execution pack

**Files:**
- Create: `docs/testing/third-party/0.3.1-20260811/README.md`
- Create: `docs/testing/third-party/0.3.1-20260811/case-matrix.csv`
- Create: `docs/testing/third-party/0.3.1-20260811/execution-report.md`
- Create: `docs/testing/third-party/0.3.1-20260811/defects.md`
- Create: `docs/testing/third-party/0.3.1-20260811/cleanup-checklist.md`
- Create: `docs/testing/third-party/0.3.1-20260811/residual-data.md`
- Reference: `docs/superpowers/specs/2026-08-11-agentwiki-third-party-black-box-testing-design.md`

**Interfaces:**
- Consumes: The 52 unique case IDs and acceptance rules from the approved Spec.
- Produces: A versioned execution pack used by Tasks 2-8.

- [ ] **Step 1: Create the run directory and evidence folders**

```bash
mkdir -p "docs/testing/third-party/0.3.1-20260811"/evidence/{01-baseline,02-auth-space-page,03-source-review-agent,04-onboarding-sync,05-admin-ux-security,06-cleanup}
```

Expected: exactly six evidence subdirectories exist under the run directory.

- [ ] **Step 2: Create the run README**

The README must contain these headings and no credentials:

```markdown
# AgentWiki 0.3.1 Third-Party Test Run

## Authorization
- Production owner: NOT_RECORDED — Task 2 entry gate blocks execution until recorded
- Approved window: NOT_RECORDED — Task 2 entry gate blocks execution until recorded
- Scope: controlled production black-box acceptance

## People
- Test lead: NOT_RECORDED — Task 2 entry gate blocks execution until recorded
- Testers: NOT_RECORDED — Task 2 entry gate blocks execution until recorded
- System contact: NOT_RECORDED — Task 2 entry gate blocks execution until recorded

## Environment
- Production URL: https://agentwiki.quukk.com
- Browser/version: NOT_RECORDED — Task 2 entry gate blocks execution until recorded
- Node.js version: NOT_RECORDED — Task 2 entry gate blocks execution until recorded
- Codex version: NOT_RECORDED — Task 2 entry gate blocks execution until recorded
- Claude Code version: NOT_RECORDED — Task 2 entry gate blocks execution until recorded
- OpenCode version: NOT_RECORDED — Task 2 entry gate blocks execution until recorded

## Test Identities
- User A sanitized identifier: NOT_RECORDED — Task 2 entry gate blocks execution until recorded
- User B sanitized identifier: NOT_RECORDED — Task 2 entry gate blocks execution until recorded
- User C sanitized identifier: NOT_RECORDED — Task 2 entry gate blocks execution until recorded
- Admin D sanitized identifier: NOT_RECORDED — Task 2 entry gate blocks execution until recorded

## Artifact Index
- Case matrix: case-matrix.csv
- Execution report: execution-report.md
- Defects: defects.md
- Cleanup: cleanup-checklist.md
- Residual data: residual-data.md
```

- [ ] **Step 3: Generate the 52-row case matrix**

Use this exact CSV header:

```csv
case_id,priority,domain,tester,start_time,end_time,result,evidence_files,defect_ids,created_resources,cleanup_status,notes
```

Extract all Spec headings matching `### [A-Z]+-[0-9]{3}` and preserve document order. Set each result to `NOT_RUN` and cleanup status to `NOT_REQUIRED` or `PENDING` according to whether the case creates data:

```bash
python3 - <<'PY'
from pathlib import Path
import csv, re
spec = Path('docs/superpowers/specs/2026-08-11-agentwiki-third-party-black-box-testing-design.md').read_text()
rows = re.findall(r'^### (([A-Z]+)-\d{3}).*?（(P[01])）', spec, re.M)
assert len(rows) == 52
assert len({case_id for case_id, _, _ in rows}) == 52
creates_data = {'AUTH', 'SPACE', 'PAGE', 'SOURCE', 'REVIEW', 'ONBOARD', 'SYNC', 'ADMIN'}
output = Path('docs/testing/third-party/0.3.1-20260811/case-matrix.csv')
with output.open('w', newline='') as handle:
    writer = csv.writer(handle)
    writer.writerow([
        'case_id', 'priority', 'domain', 'tester', 'start_time', 'end_time',
        'result', 'evidence_files', 'defect_ids', 'created_resources',
        'cleanup_status', 'notes',
    ])
    for case_id, domain, priority in rows:
        writer.writerow([
            case_id, priority, domain, '', '', '', 'NOT_RUN', '', '', '',
            'PENDING' if domain in creates_data else 'NOT_REQUIRED', '',
        ])
print('52 unique cases')
PY
```

Expected: `52 unique cases`.

- [ ] **Step 4: Create report, defect, cleanup, and residual-data schemas**

Create `execution-report.md` with this exact initial structure:

```markdown
# AgentWiki 0.3.1 Third-Party Test Execution Report

## Gates
- Entry gate: NOT_RUN
- Baseline gate: NOT_RUN
- Pre-cleanup defect gate: NOT_RUN
- Cleanup gate: NOT_RUN

## Batch Results
| Batch | Cases | Pass | Fail | Blocked | Not applicable | Gate |
|---|---:|---:|---:|---:|---:|---|

## Defect Summary
| Severity | Open | Closed | Retested |
|---|---:|---:|---:|

## Deviations and Accepted Risks
None recorded.

## Final Decision
NOT_RUN
```

Create `defects.md` with this repeatable record:

```markdown
# Defects

No defects recorded.

## Defect Record Schema
- Defect ID:
- Severity: S0 / S1 / S2 / S3 / S4
- Title:
- Case ID:
- Discovery time:
- Role and environment:
- Preconditions:
- Reproduction steps:
- Expected result:
- Actual result:
- Reproduction rate:
- Sanitized evidence files:
- Affected 3PT resources:
- Containment action:
- Retest result: NOT_RUN / PASS / FAIL
- Cleanup state: NOT_REQUIRED / PENDING / PASS / FAIL
```

Create `cleanup-checklist.md` with this exact table header:

```markdown
# Cleanup Checklist

| Resource type | Sanitized name | Owning user | Space | Creation case | Deletion method | Deletion time | Verifier | Verification method | Result |
|---|---|---|---|---|---|---|---|---|---|
```

Create `residual-data.md` with the pre-cleanup state:

```markdown
# Residual Test Data

Cleanup has not run. Task 8 must replace this statement with either the exact no-residual-data success text or a complete residual-resource record.
```

- [ ] **Step 5: Validate pack completeness**

Run:

```bash
find "docs/testing/third-party/0.3.1-20260811" -maxdepth 2 -type d -o -type f | sort
```

Expected: all six files and six evidence directories from the File Structure section exist; no credential file, browser profile, HOME directory, or raw token dump is present.

- [ ] **Step 6: Commit the reusable execution pack**

```bash
git add "docs/testing/third-party/0.3.1-20260811"/*.md "docs/testing/third-party/0.3.1-20260811"/case-matrix.csv
git commit -m "test: prepare AgentWiki 0.3.1 third-party test pack"
```

Do not commit screenshots or recordings until the test lead confirms they are sanitized.

---

### Task 2: Obtain production authorization and provision isolated test identities

**Files:**
- Modify: `docs/testing/third-party/0.3.1-20260811/README.md`
- Modify: `docs/testing/third-party/0.3.1-20260811/cleanup-checklist.md`
- Modify: `docs/testing/third-party/0.3.1-20260811/execution-report.md`

**Interfaces:**
- Consumes: The empty execution pack from Task 1.
- Produces: A signed test window, four test identities, three isolated client environments, and an inventory that later cleanup can prove complete.

- [ ] **Step 1: Record explicit authorization**

Record the production owner, approved start/end times, allowed testers, allowed admin D, and the exact `3PT-*` prefix in README. Do not begin any write test without these five fields.

- [ ] **Step 2: Prepare users A/B/C and admin D**

Create or receive four dedicated accounts through the approved channel. Record only sanitized identifiers such as `user-a-3pt`; credentials remain in the test team's password manager.

Expected: A/B/C are ordinary human users; D is the dedicated test `super_admin`; none is a real production operator account.

- [ ] **Step 3: Create three isolated client homes**

```bash
root="$(mktemp -d "${TMPDIR:-/tmp}/agentwiki-3pt.XXXXXX")"
mkdir -p "$root"/{codex,claude,opencode,knowledge-a,knowledge-b}
printf '%s' "$root" > "${TMPDIR:-/tmp}/agentwiki-3pt-root"
chmod 600 "${TMPDIR:-/tmp}/agentwiki-3pt-root"
printf '%s\n' "$root"
```

Record the sanitized root label in cleanup-checklist.md, not the full user-specific filesystem path.

- [ ] **Step 4: Create synthetic knowledge fixtures**

```bash
root="$(cat "${TMPDIR:-/tmp}/agentwiki-3pt-root")"
cat > "$root/knowledge-a/overview.md" <<'MARKDOWN'
# 3PT Product Overview

Unique marker: `3PT-KNOWLEDGE-20260811-01`.

Continue with [Setup](setup.md).
MARKDOWN
cat > "$root/knowledge-a/setup.md" <<'MARKDOWN'
# 3PT Setup

1. Prepare an isolated test directory.
2. Review the synchronization preview.
3. Confirm only synthetic content.
MARKDOWN
cat > "$root/knowledge-a/obsolete.md" <<'MARKDOWN'
# 3PT Obsolete Page

This synthetic page is deleted during SYNC-001.
MARKDOWN
cp -R "$root/knowledge-a/." "$root/knowledge-b/"
find "$root"/knowledge-{a,b} -maxdepth 1 -type f -print | sort
```

Expected: each environment contains exactly `overview.md`, `setup.md`, and `obsolete.md`; no real file or credential is present.

- [ ] **Step 5: Complete the entry-condition gate**

Confirm every Spec section 5.1 item. Record `ENTRY GATE: PASS` with time and approver in execution-report.md.

Expected: If any item fails, set affected cases to `BLOCKED` and do not continue to Task 3.

---

### Task 3: Capture production baseline and public-entry evidence

**Files:**
- Modify: `docs/testing/third-party/0.3.1-20260811/case-matrix.csv`
- Modify: `docs/testing/third-party/0.3.1-20260811/execution-report.md`
- Evidence: `docs/testing/third-party/0.3.1-20260811/evidence/01-baseline/`

**Interfaces:**
- Consumes: Authorized window and test identities from Task 2.
- Produces: ENV-001 through ENV-003 results and a green baseline used to detect test-caused regressions.

- [ ] **Step 1: Execute ENV-002 health verification**

```bash
curl --fail --silent --show-error https://agentwiki.quukk.com/api/health
```

Expected JSON fields: `status=ok`, `database=ok`, `redis=ok`, `auditPersistence=ok`.

- [ ] **Step 2: Execute ENV-003 retired-endpoint verification**

```bash
curl --silent --output /tmp/agentwiki-3pt-onboard-json \
  --write-out '%{http_code}\n' \
  https://agentwiki.quukk.com/api/onboard.json
```

Expected: `410`; body names the pinned 0.3.1 command and no old dual-MCP installation.

- [ ] **Step 3: Execute ENV-001 in signed-out Chrome**

Visit `/`, `/guide`, and `/onboard`; capture sanitized screenshots of HTTPS, rendered content, and the pinned command.

- [ ] **Step 4: Record the baseline gate**

Mark ENV-001, ENV-002, and ENV-003 and attach evidence filenames. Record `BASELINE GATE: PASS` only when all three pass.

- [ ] **Step 5: Commit sanitized baseline records**

```bash
git add "docs/testing/third-party/0.3.1-20260811"/case-matrix.csv "docs/testing/third-party/0.3.1-20260811"/execution-report.md "docs/testing/third-party/0.3.1-20260811"/evidence/01-baseline
git commit -m "test: record third-party production baseline"
```

---

### Task 4: Execute human account, Space, page, search, and graph journeys

**Files:**
- Modify: `docs/testing/third-party/0.3.1-20260811/case-matrix.csv`
- Modify: `docs/testing/third-party/0.3.1-20260811/defects.md`
- Modify: `docs/testing/third-party/0.3.1-20260811/cleanup-checklist.md`
- Evidence: `docs/testing/third-party/0.3.1-20260811/evidence/02-auth-space-page/`

**Interfaces:**
- Consumes: Users A/B/C/D and green baseline.
- Produces: AUTH-001..006, SPACE-001..006, PAGE-001..006, SEARCH-001..002, and GRAPH-001 results; also produces the main test Space needed by Task 5.

- [ ] **Step 1: Execute AUTH-001 through AUTH-003**

Use users A/B/C. Verify registration/login persistence, safe errors, logout, browser back, refresh, and direct protected URLs. Record a row immediately after each case.

- [ ] **Step 2: Execute AUTH-004 through AUTH-006**

Admin D may act only on B or a disposable `3PT-*` account. Verify temporary-password forced change, session invalidation on lock, re-login after unlock, and soft-delete denial.

- [ ] **Step 3: Execute SPACE-001 through SPACE-003**

Create one `3PT-*` Space as A, add B as Editor, prove edit ability, then downgrade B to Viewer and prove all write paths reject it.

- [ ] **Step 4: Execute SPACE-004 and SPACE-005**

Use C for non-member isolation and B for revoke-while-editor-open. Treat any disclosed title, snippet, node, count, or successful write as S1 and stop.

- [ ] **Step 5: Execute PAGE-001 through PAGE-006**

Create the required hierarchy, render Markdown, test two-user stale-save protection, reorder, restore version one, and verify script/dangerous-link inputs never execute.

- [ ] **Step 6: Execute SEARCH-001, SEARCH-002, and GRAPH-001**

Search the unique marker as A/B and C; verify updates/deletions and graph isolation. Record indexing wait time rather than repeatedly forcing refresh.

- [ ] **Step 7: Run the batch gate**

Expected: every P0 in this task is `PASS`; P1 failures have defects; cleanup-checklist lists every created user, Space, and page.

- [ ] **Step 8: Commit sanitized batch records**

```bash
git add "docs/testing/third-party/0.3.1-20260811"/case-matrix.csv "docs/testing/third-party/0.3.1-20260811"/defects.md "docs/testing/third-party/0.3.1-20260811"/cleanup-checklist.md "docs/testing/third-party/0.3.1-20260811"/evidence/02-auth-space-page
git commit -m "test: record account and knowledge workspace acceptance"
```

---

### Task 5: Execute Source, review, publication, and Agent authorization journeys

**Files:**
- Modify: `docs/testing/third-party/0.3.1-20260811/case-matrix.csv`
- Modify: `docs/testing/third-party/0.3.1-20260811/defects.md`
- Modify: `docs/testing/third-party/0.3.1-20260811/cleanup-checklist.md`
- Evidence: `docs/testing/third-party/0.3.1-20260811/evidence/03-source-review-agent/`

**Interfaces:**
- Consumes: Main test Space from Task 4.
- Produces: SOURCE-001..002, REVIEW-001..005, and SPACE-006 results plus a review-verified test Agent/Grant used by Task 6.

- [ ] **Step 1: Execute SOURCE-001**

Create a text Source with the unique marker, start one Run, and record every visible stage and terminal result. Add Source, Run, and ChangeSet identifiers to cleanup-checklist.

- [ ] **Step 2: Execute SOURCE-002**

Create one approved invalid URL Source, verify bounded failure and clear feedback, and prove repeated clicks do not produce uncontrolled duplicate Runs.

- [ ] **Step 3: Execute REVIEW-001 and REVIEW-002**

Before approval, prove candidate content is absent from formal pages/search. Capture sanitized Diff and evidence that belongs only to the test Space.

- [ ] **Step 4: Execute REVIEW-003 and REVIEW-004**

Reject one ChangeSet and prove no publication; create another, approve it once, then verify page, search, graph, version, and Run consistency.

- [ ] **Step 5: Execute SPACE-006**

Add the test Agent to the Space, verify its selected role/Grant, and repeat the operation once to prove no duplicate Grant.

- [ ] **Step 6: Execute REVIEW-005**

Start a test Agent/user operation, revoke or lock before publication, and verify it cannot publish with stale authority. Any successful stale-authority publication is S1 and triggers the stop procedure.

- [ ] **Step 7: Run the batch gate and commit**

Expected: all P0 cases pass and every created Source/Run/ChangeSet/Agent/Grant is inventoried.

```bash
git add "docs/testing/third-party/0.3.1-20260811"/case-matrix.csv "docs/testing/third-party/0.3.1-20260811"/defects.md "docs/testing/third-party/0.3.1-20260811"/cleanup-checklist.md "docs/testing/third-party/0.3.1-20260811"/evidence/03-source-review-agent
git commit -m "test: record source review and Agent authorization acceptance"
```

---

### Task 6: Execute three-client onboarding and local knowledge synchronization

**Files:**
- Modify: `docs/testing/third-party/0.3.1-20260811/case-matrix.csv`
- Modify: `docs/testing/third-party/0.3.1-20260811/defects.md`
- Modify: `docs/testing/third-party/0.3.1-20260811/cleanup-checklist.md`
- Evidence: `docs/testing/third-party/0.3.1-20260811/evidence/04-onboarding-sync/`

**Interfaces:**
- Consumes: Isolated homes, synthetic fixtures, user A, and the test Space.
- Produces: ONBOARD-001..007 and SYNC-001..006 results, three verified client configurations, and two synchronized local environments.

- [ ] **Step 1: Verify the npm release before execution**

```bash
npm view @neomei/agentwiki-local-sync version dist-tags.latest --json
```

Expected: both `version` and `dist-tags.latest` are `0.3.1`.

- [ ] **Step 2: Execute ONBOARD-001 through ONBOARD-004 on the primary client**

Give this exact command to the selected Codex, Claude Code, or OpenCode Agent:

```bash
npx --yes @neomei/agentwiki-local-sync@0.3.1 onboard --server https://agentwiki.quukk.com/api --protocol ndjson
```

Complete Device Auth, plan confirmation, single gateway installation, first Markdown/TXT scan, preview, confirmation, and remote verification. Redact every code/token in evidence.

- [ ] **Step 3: Execute ONBOARD-005 and ONBOARD-006**

Interrupt once after authorization and once before sync confirmation, resume from the emitted session ID, then test one denied, one expired, and one consumed request. Inventory and remove any disposable resources.

- [ ] **Step 4: Execute ONBOARD-007 on all clients**

The primary client completes the full flow. The other two each complete Device Auth, plan confirmation, single `agentwiki` MCP installation, reload if requested, and `doctor`. Confirm their isolated homes never modify one another.

- [ ] **Step 5: Execute SYNC-001 and SYNC-002**

Modify/add/delete the prescribed fixture files, confirm preview counts, Push, verify remote, then Pull into the second isolated environment and verify the authoritative Revision.

- [ ] **Step 6: Execute SYNC-003**

Create divergent edits from one shared base. Push environment one, then attempt environment-two Push. Require an explicit conflict/Pull/merge path; silent overwrite is S1 and triggers the stop procedure.

- [ ] **Step 7: Execute SYNC-004 and SYNC-005**

Use only `FAKE_TOKEN_3PT_DO_NOT_USE`; prove it is skipped/redacted, then run two unchanged syncs and prove no duplicate pages, relations, revisions, or ChangeSets.

- [ ] **Step 8: Execute SYNC-006**

Compare each isolated client config before onboarding and after uninstall. Require removal of the test gateway and exact preservation of unrelated MCP entries.

- [ ] **Step 9: Run the batch gate and commit**

Expected: Codex, Claude Code, and OpenCode each pass their required path; every P0 passes; no credential appears in tracked artifacts.

```bash
git grep -n -E 'awo_|awd_|FAKE_TOKEN_3PT_DO_NOT_USE|Bearer [A-Za-z0-9._-]+' -- "docs/testing/third-party/0.3.1-20260811" ':!**/case-matrix.csv'
```

Expected: no real credential pattern; the literal fake marker may appear only in the case description, never in captured output.

```bash
git add "docs/testing/third-party/0.3.1-20260811"/case-matrix.csv "docs/testing/third-party/0.3.1-20260811"/defects.md "docs/testing/third-party/0.3.1-20260811"/cleanup-checklist.md "docs/testing/third-party/0.3.1-20260811"/evidence/04-onboarding-sync
git commit -m "test: record three-client onboarding and sync acceptance"
```

---

### Task 7: Execute administrator, mobile, internationalization, and negative-security checks

**Files:**
- Modify: `docs/testing/third-party/0.3.1-20260811/case-matrix.csv`
- Modify: `docs/testing/third-party/0.3.1-20260811/defects.md`
- Evidence: `docs/testing/third-party/0.3.1-20260811/evidence/05-admin-ux-security/`

**Interfaces:**
- Consumes: Remaining test identities and test resources before cleanup.
- Produces: ADMIN-001..004 and UX-001..004 results plus the final pre-cleanup defect gate.

- [ ] **Step 1: Execute ADMIN-001 and ADMIN-002**

Verify ordinary-user denial, admin-D access, sanitized statistics, search, filters, roles, statuses, and pagination.

- [ ] **Step 2: Execute ADMIN-003 and ADMIN-004**

Operate only on test users. Verify reset/lock/unlock/delete propagation and self-operation protection; do not touch any real administrator.

- [ ] **Step 3: Execute UX-001**

Switch Chinese/English on homepage, Dashboard, Space, page, Agent, review, and admin surfaces; record missing keys, mojibake, overflow, and persistence.

- [ ] **Step 4: Execute UX-002**

Set Chrome viewport to 390px and complete login, navigation, Space read, page read, member view, and review view. Reset the viewport after evidence capture.

- [ ] **Step 5: Execute UX-003 and UX-004**

Double-click the specified mutating actions, simulate one short network interruption, and trigger safe error states. Require idempotency, bounded loading, actionable messages, and no internal detail disclosure.

- [ ] **Step 6: Run the pre-cleanup defect gate**

Count results by priority and severity. Stop before acceptance if any P0 is failed or any S0/S1/S2 is open.

- [ ] **Step 7: Commit sanitized batch records**

```bash
git add "docs/testing/third-party/0.3.1-20260811"/case-matrix.csv "docs/testing/third-party/0.3.1-20260811"/defects.md "docs/testing/third-party/0.3.1-20260811"/evidence/05-admin-ux-security
git commit -m "test: record admin mobile and negative-security acceptance"
```

---

### Task 8: Remove all test data and issue the final acceptance decision

**Files:**
- Modify: `docs/testing/third-party/0.3.1-20260811/case-matrix.csv`
- Modify: `docs/testing/third-party/0.3.1-20260811/execution-report.md`
- Modify: `docs/testing/third-party/0.3.1-20260811/defects.md`
- Modify: `docs/testing/third-party/0.3.1-20260811/cleanup-checklist.md`
- Modify: `docs/testing/third-party/0.3.1-20260811/residual-data.md`
- Evidence: `docs/testing/third-party/0.3.1-20260811/evidence/06-cleanup/`

**Interfaces:**
- Consumes: Complete case matrix and full created-resource inventory.
- Produces: Empty residual-data list, green post-test health, final metrics, and one of the three permitted acceptance decisions.

- [ ] **Step 1: Freeze new test writes**

Record `WRITE TESTING CLOSED` with time and test lead. No case may create new resources after this point.

- [ ] **Step 2: Execute the Spec section 18 cleanup order**

Cancel/finish Runs and syncs; resolve ChangeSets; remove Sources/pages/relations; revoke Agent Grants/credentials; uninstall client gateways; remove Agents/members/Spaces; soft-delete A/B/C as authorized; leave admin D disposition to the production owner.

After all three clients are uninstalled and their before/after configuration evidence is saved, remove the isolated local root:

```bash
root="$(cat "${TMPDIR:-/tmp}/agentwiki-3pt-root")"
python3 - <<'PY'
from pathlib import Path
import os
import shutil
marker = Path(os.environ.get('TMPDIR', '/tmp')) / 'agentwiki-3pt-root'
root = Path(marker.read_text())
assert root.name.startswith('agentwiki-3pt.')
shutil.rmtree(root)
marker.unlink()
PY
test ! -e "$root"
```

Expected: the isolated root and marker file no longer exist; no daily client configuration was touched.

- [ ] **Step 3: Verify every cleanup row independently**

A second tester verifies each row through product UI, direct old URL, and unique-marker search. `cleanup_status=PASS` requires all three checks where applicable.

- [ ] **Step 4: Produce residual-data.md**

On success, the file must contain exactly:

```markdown
# Residual Test Data

No residual `3PT-*` test data was found after cleanup.
```

If any resource remains, list its type, sanitized ID, owner, reason, attempted cleanup, impact, assigned defect, and responsible owner; classify it at least S2.

- [ ] **Step 5: Run post-test health and public smoke**

```bash
curl --fail --silent --show-error https://agentwiki.quukk.com/api/health
curl --fail --silent --show-error https://agentwiki.quukk.com/ >/dev/null
```

Expected: health fields all `ok`; homepage request succeeds; signed-out login and one authorized read path still work.

- [ ] **Step 6: Calculate final metrics**

Report P0/P1 pass rates; count PASS/FAIL/BLOCKED/NOT_APPLICABLE; count S0-S4 defects by open/closed/retested; list deviations; and confirm whether the residual list is empty.

- [ ] **Step 7: Apply the exact acceptance rule**

Choose exactly one:

- `PASS`: every exit condition is met.
- `CONDITIONAL PASS`: no S0/S1/S2; only accepted S3/S4 with written risk acceptance.
- `FAIL`: any P0 failure, open S0/S1/S2, privilege breach, leak, silent overwrite, or residual test data.

Record the decision, rationale, test lead, third-party approver, production owner, and decision time in execution-report.md.

- [ ] **Step 8: Run artifact safety checks**

```bash
git diff --check
git grep -n -E 'Bearer [A-Za-z0-9._-]+|awo_[A-Za-z0-9_-]+|awd_[A-Za-z0-9_-]+|password[=:][^ ]+' -- "docs/testing/third-party/0.3.1-20260811"
```

Expected: no formatting errors and no credential matches. Manually inspect every committed screenshot before staging.

- [ ] **Step 9: Commit the final report**

```bash
git add "docs/testing/third-party/0.3.1-20260811"
git commit -m "test: publish AgentWiki 0.3.1 third-party acceptance report"
```

- [ ] **Step 10: Obtain final signatures**

The third-party test lead and production owner review the Spec, case matrix, defects, cleanup proof, residual-data file, and acceptance decision. Testing is complete only after both record approval.
