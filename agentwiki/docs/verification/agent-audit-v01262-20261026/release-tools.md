# v0.12.62 release procedure and identifiers

- Product fixes: `ee955c72ac7ff0260f27da3e4e1b4546e8c82a19`, `1a6de6c8028e18c1c0fa3fdfd5c0dd32fed1e0a2`.
- Frozen release: `2635bc66dd669d94f00650d3488f62e455719cab`.
- Manifest: 1437 deployed source files; SHA-256 `48cbf3ee42efe2f447130d7fb7cf91d7e049dc5f94070e4cec756e393c743734`.
- Standalone verifier SHA-256: `dd4e867e7457ab061150d2dff7902eb18c1c3bbacedc111655b99d7044042cc4`.

## Source preparation

Run the release guard in the canonical checkout, freeze the versioned code in Git, then create a clean detached worktree at the release commit. `deploy.sh` packages working-tree files, so this isolation is required. The local detached release tree was removed cleanly after deployment; it can be recreated from the frozen commit.

```sh
python3 agentwiki/docs/verification/agent-audit-v01262-20261026/prepare-source-manifest.py   --repo . --revision 2635bc66dd669d94f00650d3488f62e455719cab   --out-dir /tmp/agentwiki-v01262-receipts-2635bc66
```

The generator only reads Git archive bytes; package versions and verifier source are bound to that exact revision. Its output directory must be new. Existing receipts must not be deleted or reused for another revision.

## Backup and deployment

Execute `backup-production-v01262.sh` on production. It temporarily stops API/worker while capturing database plus attachments, verifies checksums and restores services before exit. The verified server-private paired backup is `/var/backups/agentwiki/agent-audit-v01262.7nox7xx3`; configuration secrets remain there.

From the clean detached application directory:

```sh
bash ./deploy.sh 113.249.120.24 root
```

Exit0; no pending migrations. Previous tree `/root/agentwiki-previous-20261026063503`. Recovery must pair this tree with its matching database/attachment backup.

## Verification

The copied verifier/manifest under `/root/agentwiki-release-tools-v01262-2635bc66` matched local hashes before execution.

```sh
python3 verify-release.py --mode host   --revision 2635bc66dd669d94f00650d3488f62e455719cab   --manifest-sha256 48cbf3ee42efe2f447130d7fb7cf91d7e049dc5f94070e4cec756e393c743734   --expected-files 1437 --manifest source-manifest.json

python3 verify-release.py --mode public   --revision 2635bc66dd669d94f00650d3488f62e455719cab   --manifest-sha256 48cbf3ee42efe2f447130d7fb7cf91d7e049dc5f94070e4cec756e393c743734   --expected-files 1437 --host-receipt production-host.json
```

Both passed; three services active, five health fields ok, all source files and five public entry assets match. The explicit `.62` `live-model-smoke.cjs --run` passed question/proposal/auto-answer using synthetic Chinese/emoji content and in-memory routing health. It does not instantiate the app, database or Redis and cannot save pages. Provider usage zeros are retained as metadata, not a claim of free inference.

Publication uses an annotated `v0.12.62` tag at the frozen release SHA and a non-draft, non-prerelease GitHub Release with the same target. Evidence-only commits may advance the branch without changing this deployed tag. The GitHub connector has no release-creation capability; the existing authenticated `gh` CLI performs publication.
