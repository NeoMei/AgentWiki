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
