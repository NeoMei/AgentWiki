# Task 1 report: AgentWiki v0.9.1 release preparation

## Status

COMPLETE. Source compatibility and active version surfaces are implemented. Focused
tests, Local Sync package tests, runtime contract, typecheck, lint, build, registry gates
and exact-candidate clean install pass. The scoped source is frozen for review/release.

## Scope and inventory

- Current release surfaces: root `package.json`, server/client manifests, Local Sync
  manifest/runtime constants, client install guide, server onboarding guide, root and
  server environment examples, Docker default, README and testing guide.
- Compatibility surfaces: onboarding start/bootstrap DTOs and types, bootstrap session
  authorization, installation issue/exchange/replay DTO and service.
- Package gates: Local Sync exact protocol dependency, runtime alignment contract,
  release collision gate, public protocol parity and clean install.
- Historical release evidence and protocol golden vector are intentionally unchanged.

## Implementation

- Current root/server/client/Local Sync version and active guidance/defaults are `0.9.1`.
- Sync Protocol remains `0.6.0`; Local Sync depends on exact `0.6.0`.
- Server compatibility is explicit: `SUPPORTED_LOCAL_SYNC_VERSIONS = ['0.9.0', '0.9.1']`.
  Onboarding start/bootstrap and installation issue/exchange/replay accept only those two
  versions. Unsupported versions are rejected.
- Newly issued installation payloads and command instructions retain the exact requested
  supported version. Bootstrap passes the plan's exact requested version into issuance.
- Configuration must itself name a supported version; either deployed `0.9.0` or new
  `0.9.1` defaults allow both supported client requests during the patch transition.
- Raw onboarding plan hashing is unchanged; the existing `0.9.0` protocol golden vector
  remains in place and continues to verify exact compatibility.

## TDD and verification evidence

RED command:

```text
pnpm --filter @agentwiki/server test -- --runInBand src/onboard/onboard.dto.spec.ts src/onboard/onboard-bootstrap.service.spec.ts src/core/dto/local-sync.dto.spec.ts src/core/agent/local-sync-installation.service.spec.ts
```

Expected RED observed: 0.9.1 DTO/bootstrap types rejected, installation service rejected
0.9.1, and configured 0.9.1 caused 0.9.0-only tests to reject. Exit 1.

Fresh GREEN checks:

```text
pnpm --filter @agentwiki/server exec jest --runInBand src/onboard/onboard.dto.spec.ts src/onboard/onboard-bootstrap.service.spec.ts src/onboard/onboard-device.service.spec.ts src/core/dto/local-sync.dto.spec.ts src/core/agent/local-sync-installation.service.spec.ts src/core/agent/local-sync-installation.controller.spec.ts src/core/agent/local-sync-installation.composition.spec.ts
```

Result: 7 suites, 199 tests passed, exit 0. This includes 0.9.0/0.9.1 acceptance,
unsupported rejection, requested-versus-issued version, exchange/replay version retention,
old/current configured-default compatibility, and the original raw-plan golden vector.

```text
pnpm --filter @agentwiki/client exec vitest run src/features/about/GatewayGuidePreview.spec.tsx src/features/about/LocalSyncGuideSection.spec.tsx src/features/about/OnboardPage.spec.tsx src/features/agent/LocalSyncInstallCard.spec.tsx src/features/collaboration/agentPreparationApi.test.ts src/features/collaboration/components/AgentPreparationDialog.test.tsx
```

Result: 6 files, 79 tests passed, exit 0.

```text
node --test scripts/sync-v3-registry-collision-gate.test.mjs
```

Result: 14 tests passed, exit 0.

```text
pnpm --filter @neomei/agentwiki-local-sync test
```

Result: 61 files passed; 886 tests passed, 1 skipped; exit 0.

```text
node --test scripts/node-runtime-contract.test.mjs
```

Result: 33 tests passed, exit 0; includes live Local Sync build/dry-run pack and version,
package-name, protocol-dependency and active-surface contracts.

```text
git -C '<worktree>' --work-tree='<worktree>' diff --check
pnpm typecheck
pnpm lint
```

Result: all exit 0.

```text
pnpm build
```

Result: shared, Sync Protocol, server, client and Local Sync builds passed, exit 0. Vite
reported its existing large-chunk advisory; no build error occurred.

```text
pnpm test:release:sync-v3-registry
```

Result: registry `https://registry.npmjs.org/` reports
`@neomei/agentwiki-local-sync@0.9.1` available, exit 0.

```text
pnpm test:release:sync-protocol-registry-parity
```

Result: public `@neomei/agentwiki-sync-protocol@0.6.0` is byte-identical to the local
source package, exit 0. Protocol 0.6.0 is already published and must not be republished.

```text
pnpm test:package:local-sync-registry-protocol
```

Result: Local Sync prepack tests passed 886 with 1 skip; candidate packed as 153 files,
then installed in an empty directory with the real registry protocol 0.6.0. Installed
versions and exact dependency matched and CLI help ran. Exit 0. The gate's ephemeral
candidate SHA-1 was `94276ff8aef119b947a907f78314b61b7e4ca638`.

## Frozen artifacts

The tested Local Sync candidate was repacked from the same frozen build with
`npm pack --ignore-scripts --json` and reproduced the official gate's SHA-1 exactly:

- Local Sync candidate:
  `/Users/neomei/.codex/recovery/agentwiki-v091-release-20260906/neomei-agentwiki-local-sync-0.9.1.tgz`
  - size: 171920 bytes; files: 153
  - SHA-1: `94276ff8aef119b947a907f78314b61b7e4ca638`
  - SHA-256: `e202ecd5011ef68973fac7492642c0f8cafa4691f09bea23e00f7706d95f4ac4`
  - integrity: `sha512-5yguJ34Y9xzajXailcPxTbMLMBQKCYtgmyMZjAY8EmpjPaweo0UnJm6SD7S67YskJyEKVMGbAsQ8/2QEMMvkDQ==`
- Protocol comparison artifact, for inspection only; do not publish:
  `/Users/neomei/.codex/recovery/agentwiki-v091-release-20260906/neomei-agentwiki-sync-protocol-0.6.0.tgz`
  - size: 75208 bytes; files: 69
  - SHA-1: `27ab0950815f6a908aced1c176ddda8e24a0b048`
  - SHA-256: `42914257857b1f9216e990e6f302c50f2585140cb397690136a7e5f2b3faf505`
  - integrity: `sha512-gFm40xRJnw3DHYqC65U4n7T62VkWkyyuzgIV77ZHYEKaSnKYAWbkh4JrrvAstVGOtyD0BL0bFW9ydKwnOWf81w==`

The exact persistent Local Sync tarball was then installed with:

```text
env -u npm_config_allow_scripts npm install --prefix <fresh-install-root> --cache <fresh-cache-root> --registry=https://registry.npmjs.org/ --ignore-scripts --no-audit --no-fund /Users/neomei/.codex/recovery/agentwiki-v091-release-20260906/neomei-agentwiki-local-sync-0.9.1.tgz
node <fresh-install-root>/node_modules/@neomei/agentwiki-local-sync/dist/cli.js --help
```

Result: Local Sync `0.9.1`, registry protocol `0.6.0`, exact dependency `0.6.0`, and CLI
help all verified, exit 0. Preserved install root:
`/Users/neomei/.codex/recovery/agentwiki-v091-release-20260906/clean-install.H4oURw`.

## Boundary

No full regression, push, publish, deploy, production access or production writes were
performed by Task 1.

## Independent review remediation

The Task 1 independent review found one Important documentation mismatch in the active
deployment runbook. The README now matches the implemented collision gate: a successful
explicit-registry metadata response proves availability only when its version list omits
`0.9.1`; request failures, non-2xx responses (including `E404`) and invalid metadata fail
closed. No source or package artifact changed, so the frozen tarball hashes above remain
valid.
