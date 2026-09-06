# Relative Markdown image repair verification

Date: 2026-09-06. Tested code: `96f9a325ff25640d72670c5fedac7d535290379c`.
Branch: `codex/relative-image-web-rendering`, integrated published upstream `b776b830` (0.9.1).

**Status as of 2026-09-07: correction reviewed, source published, application deployed; original live Page and editor preview PASS. Android and broader plugin U7 acceptance remain pending.**

## 2026-09-07 production result

Source published to GitHub master `644b0ab1247ad235afc7276959ea89ab1ecc8279` with a normal fast-forward from `b776b830`; user main checkout/unrelated work preserved. This is an application-only code hotfix retaining0.9.1. No existing tag/release asset was replaced and no npm/protocol/plugin version was published.

Operational review C0/I0/M1 approved reuse of the unchanged verified wrapper. Its missing Git stamp was mitigated by packaging an exact `git archive` source directory, retaining uploaded archive SHA256 `c710d1d292783d14795e8d1af528eaaa333e3fb10b03b2a1311f54ab6774dcbc`, and matching all1,033 deployed input-file hashes to the frozen source after deployment.

Deployment exited0. Staged server/client builds and OpenCode runtime preflight1.18.12 passed before maintenance. Verified paired backup `/var/backups/agentwiki/space-name-v091.wS6pqO` captured2026-09-07 01:21:25 CST, includes database, attachment bytes, application and systemd.55 successful migrations matched; zero pending/unresolved (two historical rolled-back rows remain). Previous application retained at `/root/agentwiki-previous-20260907012128`. No disaster restore was performed or authorized.

- Backup manifest SHA256 `b24b88aae4bf1d9e436d77e18616c13817acdbca53fb27eb4f951c15381b6ae9`.
- Application backup SHA256 `d2838a72b96e5272ba7121fc4df195f0ac2d11ae0780e18135935ee69a9a9397`.
- Systemd backup SHA256 `476cb4cbfca4fcd34a26cf93f8f1832ef1429702a902a6db6c08ecf266435b24`.
- Two production env hashes exactly unchanged. API/worker/frontend active with NRestarts0; public health database/Redis/auditPersistence/attachmentStorage all ok.

Actual logged-in original Page `5cd9bf78-5ad2-41fa-a941-9e260b330b31` was reloaded without fixture edits or HTTP mocks. The previous broken relative image now renders through private `blob:https://agentwiki.quukk.com/...`, complete with naturalWidth480/naturalHeight270, original alt, no horizontal overflow. Entering the existing editor and selecting Preview also loads the same480x270 Blob. Save remained disabled; no edit/save was performed, and the browser returned to the original Page. No browser warning/error was recorded. Read-only database check confirmed the original standard reference `![First local image](../assets/first-local.png)` remains, with no wiki rewrite.

Private source archive, input inventories, logs, local HTTP audit and paired-backup receipt are retained at `/Users/neomei/.codex/recovery/agentwiki-relative-image-20260907/`. Existing older paired backups remain intact. Their presence is not authorization to discard later writes.

## 2026-09-07 residual correction closure

The user approved continuing the disclosed correction. Code `98d2d4f619929e17be95f88a62d7357a97aa864a` removes both decoded-edge trimming sites from standard-image identity while preserving one-decode, NFC/casefold and original resolver targets. Independent scoped review: spec compliant, quality approved, Critical0/Important0/Minor0; original whole-branch review plus the two scoped corrections now have no open findings.

- RED: eight expected failures (both collector/render orders plus four encoded-edge controls), 1,284 passed. GREEN: changed suites124/124, requested five suites184/184, full client94files1,292/1,292; typecheck/lint/client build passed with only existing chunk-size warning.
- Controller reran the five suites on the frozen commit:184/184 passed and diff check clean.
- Controller real Chrome through CUA: five supported URL forms x desktop1440x900/mobile390x844, plus valid-first/invalid-first pairs x both viewports:14 cases passed. Actual Markdown/AttachmentImage components rendered one valid Blob480x270, retained alt/title, invalid paired reference stayed fallback, no horizontal overflow. Hide/show remount passed; no console warnings/errors. Controlled HTTP audit:17 resolve calls and17 valid-content fetches, no unexpected API request; paired raw targets preserved.
- Initial new local harness response erroneously included `kind` on an unresolved result and was rejected by the existing exact response validator. Corrected the test-only response shape before the successful results above; no product code changed for that harness issue.

The earlier NO_GO and original counts below are historical evidence, not the latest code verdict. Production result is recorded above; Android remains separate.

## Completed checks

- Frozen client suite: 94 files, 1,284 tests passed.
- Frozen server suite: 145 suites, 2,550 tests passed; 2 suites / 10 tests skipped for environment/platform conditions. Skips are not passes.
- Integrated real PostgreSQL/Redis Markdown resolver gate: 11 tests passed, zero skipped. Final correction touched client identity only, not server code.
- Author final focused regression: 176 tests passed after 4 failing regression tests demonstrated the original URI mismatch. Typecheck, targeted lint and client production build passed. Integrated full lint and client/server builds also passed. Existing large-chunk Rollup warning remains.
- Frozen real Chrome: five URL forms (ASCII, Unicode+space, space, mixed encoding, already encoded), desktop 1440x900 and mobile viewport 390x844: all 10 passed. Actual Markdown and AttachmentImage components rendered 480x270 private Blob images, preserved alt/title, survived hide/show remounts and produced no unexpected requests or page errors. HTTP fixtures were controlled: this is not production authorization or Android acceptance.

## Historical blocking finding (closed by 98d2d4f6)

Final scoped review: Critical 0 / Important 1 / Minor 0. The original mdast/HAST Unicode identity mismatch is fixed, but decoding followed by trimming merges these distinct references:

```markdown
![Valid](../assets/first-local.png)
![Invalid](../assets/first-local.png%20)
```

The server rejects decoded trailing whitespace, while both client references currently share a canonical key. If the valid reference is first, the invalid one reuses its attachment; if the invalid reference is first, the valid one can also remain unresolved. A direct import of the frozen resource module confirmed the key collision. This is a correctness/fail-closed blocker, not a cross-Space authorization bypass claim.

Required next correction: preserve decoded edge whitespace in the standard Markdown image identity, avoiding both the direct trim and the trimming shared normalizer; add same-page valid/invalid regression cases in both orders. The controller accepted this finding and did not waive it because other tests were green. The SDD final fix/re-review cap was reached, so the residual is surfaced for a bounded follow-up rather than another automatic fix wave.

## Historical pre-deployment checkpoint (superseded above)

No push, main-branch merge, release or deployment was performed for this repair. The original live Page `5cd9bf78-5ad2-41fa-a941-9e260b330b31` remains untouched; its most recent live check still showed a raw relative image source with zero natural dimensions. The separately deployed 0.9.1 does not include this repair.

Android real first-image/recovery, remaining desktop lifecycle and public response-loss acceptance are still pending. The desktop CLI socket is currently absent; device connectivity/login alone does not close these gates. Plugin 0.4.0 is not released by this work.

Detailed reports and immutable review packages are retained in the isolated branch's `.superpowers/sdd/2026-09-06-relative-image-web-rendering/`. Controller runtime logs and Chrome screenshots are in `/tmp/agentwiki-relative-image-qa.aMGjNo/`.
