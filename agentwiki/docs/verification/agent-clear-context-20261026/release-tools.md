# v0.12.61 clear-context release procedure

Frozen production revision: `4075638e390d9f6c8174721761a4a232b7d014a3`.
Feature source revision: `0c0777f9c40e8dc4d104d2f3133c8dfc4254abb9`.

The new receipt directory is independent from the rejected prompt-only 0.12.61 experiment. No acceptance result from that experiment is used here.

## Source preparation

Run the release guard in the canonical checkout. Freeze the versioned code and verifier entry in Git, create a clean detached worktree at that revision, then run:

```sh
python3 agentwiki/docs/verification/agent-clear-context-20261026/prepare-source-manifest.py \
  --repo . \
  --revision 4075638e390d9f6c8174721761a4a232b7d014a3 \
  --out-dir /tmp/agentwiki-v01261-receipts-4075638e
```

This reads only Git archive bytes and produces 1436 deployed source entries. The manifest SHA-256 is `150ee69a9936f111723617e20d9cf2200659ab1612c8a788696a36b1a7e2c7d4`. The standalone verifier embeds the existing read-only implementation from the same revision.

`deploy.sh` archives the working tree, so it must run from the clean detached checkout, with the explicit production host and user. The local candidate lock is not part of the deployed tarball.

## Backup and deployment

Execute `backup-production-v01261.sh` on production before deployment; require a verified receipt with API/Worker restored. Configuration and database credentials remain in the private backup and must not be copied to Git.

The verified paired backup is `/var/backups/agentwiki/agent-clear-context-v01261.IrzEQtJp`. From the frozen application directory, run:

```sh
bash ./deploy.sh 113.249.120.24 root
```

This deployment exited 0. No migration was pending. Previous application tree: `/root/agentwiki-previous-20261026055218`. Recovery must pair the previous tree with its matching database/attachment backup.

## Verification and publication

Transfer the generated manifest and standalone verifier to production. Host mode checks the explicit revision, manifest hash, expected file count, package versions, source bytes, three services, health and entry assets. Public mode consumes the host receipt and checks HTTPS health and exact entry HTML/assets. All identifier arguments are required; do not substitute an older receipt.

```sh
python3 verify-release.py --mode host \
  --revision 4075638e390d9f6c8174721761a4a232b7d014a3 \
  --manifest-sha256 150ee69a9936f111723617e20d9cf2200659ab1612c8a788696a36b1a7e2c7d4 \
  --expected-files 1436 --manifest source-manifest.json

python3 verify-release.py --mode public \
  --revision 4075638e390d9f6c8174721761a4a232b7d014a3 \
  --manifest-sha256 150ee69a9936f111723617e20d9cf2200659ab1612c8a788696a36b1a7e2c7d4 \
  --expected-files 1436 --host-receipt production-host.json
```

Production browser verification uses an isolated new session and unsent draft. It does not send a model request or modify the existing Bug summary page. Publish the annotated `v0.12.61` tag at the exact frozen production revision, then create a non-draft, non-prerelease GitHub Release with that target. Later evidence-only commits may advance the branch without changing the production tag.
