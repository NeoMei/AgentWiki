# v0.12.57 / Local Sync 0.13.5 release

2026-10-23 用户明确授权“发布”。范围为本轮 12 项缺陷修复及同工作树已验证的宿主识别/连接身份修复。产品候选保持在 canonical worktree，历史 checkout 不参与构建或部署。

## Release identity

- Web/API/client: 0.12.57.
- Local Sync: 0.13.5; protocol: unchanged 0.6.1.
- Branch: `codex/agent-autochat-external-opencode`.
- Base: `ec4faa7f`, fetched from GitHub master; its tree matched prior candidate `cec79c4e` exactly before fast-forward.
- Production: `root@113.249.120.24:/root/agentwiki`, root user services `agentwiki-api`, `agentwiki-worker`, `agentwiki-frontend`.
- Public origin: https://agentwiki.quukk.com.

## Progress

The final uninterrupted `pnpm test:full` passed with **8223 passed, 5 environment-gated skips, 0 failed**. See `full-test-receipt.json`. Final build/typecheck/lint and both independent package-install gates passed. Protocol 0.6.1 matches the official registry byte contents. See `build-package-gates.json`. The initially failed version-fixture assertions were repaired before this successful invocation.

The coordinated production backup `/var/backups/agentwiki/bugs-v01257.oap6txmn` passed archive checksums, database catalog validation and attachment/source consistency checks. API/worker writes paused for about 9 seconds and resumed; all three user services and health recovered. See `backup-receipt.json`. No restore rehearsal was performed.

npm official web authentication and `whoami` succeeded for `neomei`. Registry latest remains 0.13.4, candidate 0.13.5 is unoccupied. Publish the frozen package under temporary tag `release-0-12-57`, verify exact registry bytes and empty-cache installation, deploy Web/API 0.12.57, then promote latest after production verification.

Final npm tarball: 179 files, 207492 bytes, SHA-256 `b566ae2a895e17fc4d5d22645e8184bd484d333fe5a87af330b2e897349c9e05`; prepack and package tests passed. See `frozen-pack-receipt.json`.

No new package or application release has been published yet. Frozen commit, package integrity, source manifest, deployment, public asset and report readback receipts will be added after their respective gates pass.
