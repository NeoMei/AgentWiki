# Referenced relative image web rendering repair

## Spec and scope

User approved this bounded cross-repository fix after actual desktop first-image acceptance uploaded the correct image but the web Preview emitted a broken relative img src. Binding evidence: `/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/.worktrees/referenced-image-sync-v3/docs/verification/2026-09-06-u7-desktop-relative-image-rendering.md`.

## Global Constraints

- Preserve original Markdown content and standard image syntax, alt and title. Do not rewrite fixtures into wiki syntax to obtain a passing screenshot.
- Resolve supported local image references only to authorized attachments in the same Space, using the source Page syncPath where relative resolution needs it. Never fall back to another Space or basename-only guesses for a path that does not resolve.
- Reuse the existing Markdown resource resolver and authorized AttachmentImage Blob lifecycle. Never expose storage paths, bypass authorization, or use raw relative browser URLs for managed images.
- Preserve existing wiki-image, HTTPS-image, unsupported-scheme and safe-fallback behavior. Missing, malformed, ambiguous or unauthorized resources must not fetch arbitrary resources.
- No new protocol version, public package bump, schema migration, attachment-management feature, plugin changes, or production actions in implementation.
- Sole product writer operates only in the isolated main-project worktree. Read-only access to the explicitly named plugin evidence is allowed. Never read or serialize credentials.

## Task 1: Repair standard Markdown relative image resolution end to end

Read this task as the complete bounded requirements. The worktree root is `/Users/neomei/项目/codexprojects/AgentWiki /agentwiki/.worktrees/relative-image-web-rendering-20260906`; product directory is its `agentwiki` subdirectory. Branch `codex/relative-image-web-rendering`, baseline `9e6dc9a9f9ad8d0cb469cd32370973d9b1dc60b2`.

CRITICAL: repository shared Git config sets core.worktree to the original checkout. Every git command must explicitly use `git -C <isolated-root> --work-tree=<isolated-root> ...`, or per-command `GIT_WORK_TREE=<isolated-root>` when running repository scripts. Verify the isolated root and clean status before writes. Do not stage unrelated files/submodules.

Binding requirements are all Global Constraints above (read that section in this plan only), and the named plugin evidence document. Read applicable main AGENTS and required frontend rules. Use systematic debugging and TDD, including writing-good-tests.md, and React best-practices for touched React code. CodeGraph index exists in product; use codegraph explore before locating code, then inspect relevant omitted source as needed.

1. Reproduce with regression tests before edits: `![First local image](../assets/first-local.png)` in a Page with a stable pages/... syncPath and exactly one matching same-Space attachment must resolve via the public resource contract and render through real AttachmentImage. Preserve alt/title. Assert no raw relative browser fetch. Test actual collector/parser + renderer behavior, mocking only transport/Blob browser seams where necessary.
2. Inspect current Markdown.tsx SafeImage, markdown/resources.ts collector/tree resolution, AttachmentImage, server markdown-resource.service.ts and attachment-reference.ts existing path semantics. Reuse existing authoritative resolver/parser helpers where appropriate; avoid parallel approximate path rules. A client and server change is allowed only as required by this existing contract.
3. Cover supported relative/nested/encoded filenames and standard syntax variants already accepted by sync, missing/ambiguous/traversal/foreign-source-page handling, wiki compatibility and external HTTPS safety. Bounds and embedded source-page context must remain correct. Do not broaden supported image upload scope.
4. Implement the smallest cohesive repair; retain source-page and Space authorization boundaries. Add/update focused regression coverage. Run relevant client/server suites, typechecks and production builds of touched packages, plus broader relevant image/resource suites. Report exact commands, counts, RED and GREEN evidence, warnings and any unrun real-environment gates.
5. Self-review, commit only scoped product/tests and this plan if appropriate, freeze the resulting HEAD and write a full report to the SDD task-1-report.md path provided by the controller. Do not push, merge, publish, deploy, modify production fixtures, or spawn agents. Return only status, commits, test summary and concerns.

Controller owns independent task review, final branch review, and subsequent authorized production/browser/Android acceptance. Local tests do not constitute live acceptance.

## Task 2: User-authorized residual identity collision correction

The user explicitly continued on 2026-09-07 after the remaining Important finding was disclosed. This is a bounded follow-up, not a waiver of the finding. All Global Constraints above bind this task; read that section only in addition to this brief. Root worktree and required explicit Git --work-tree override are the same as Task 1. Current clean starting HEAD is 643392f2 (tested product96f9a325 plus verification documentation). Do not modify main checkout or deploy/push/publish.

Read `agentwiki/docs/verification/2026-09-06-relative-image-web-rendering.md` for the exact finding. Use CodeGraph first, systematic debugging and TDD. Client `standardMarkdownImageResourceRef` decodes then trims and passes the result through another trimming normalizer. This aliases rejected trailing-percent-encoded-whitespace targets with valid attachment targets; deduplication makes outcomes depend on first occurrence.

1. Write failing collector/identity and real Markdown-to-AttachmentImage tests for a same-page valid `../assets/first-local.png` and invalid `../assets/first-local.png%20`, in BOTH orders. Assert distinct keys and unchanged original request targets, valid image succeeds and invalid reference falls back with no wrong attachment fetch. Mock transport only, returning unresolved for the invalid reference as the authoritative server does.
2. Apply the minimal correction so decoded edge whitespace remains part of standard-image identity, bypassing BOTH trimming sites, while preserving NFC/casefold and one-decode semantics. Keep existing raw Chinese/spaces/mixed/already-encoded matches, double-encoded distinctions, external/wiki behavior and server authority intact. Do not change the shared wiki normalizer or rewrite request targets.
3. Check nearby encoded edge whitespace controls in focused identity tests without expanding path support. Run the two changed test suites RED then GREEN, requested five suites (resources, Markdown.relative-images, EmbeddedMarkdown, AttachmentImage, Markdown), full client once, root typecheck, targeted lint and client build. Report exact counts and any warnings. Do not run full server; no server change is expected.
4. Self-review, commit scoped code/tests and this plan addition, append report in the controller-provided Task2 report path, freeze HEAD. Return short status/commits/tests/concerns. Do not spawn subagents; controller owns independent review and frozen browser acceptance. Leave existing verification document NO_GO until controller records review closure.
