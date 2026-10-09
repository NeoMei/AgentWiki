# Final lint repairs

Status: frozen for controller commit. No commit created; no subagent spawned.

## Exact changes

- `agentwiki/apps/client/src/components/markdown-tools/commands.ts`: removed two unnecessary opening-bracket escapes inside regular-expression character classes. The character sets and replacement behavior remain unchanged.
- `agentwiki/apps/client/src/features/space/SpaceView.tsx`: added `{ cause: failure }` to the three inline mutation error wrappers. The translated `apiErrorMessage` output, scope guard, and control flow remain unchanged.

Product delta: exactly 2 files, 5 insertions and 5 deletions. No other product file edited.

## Validation

- `pnpm exec eslint src/components/markdown-tools/commands.ts src/features/space/SpaceView.tsx` from `agentwiki/apps/client`: exit 0, no diagnostics.
- `pnpm exec vitest run src/components/markdown-tools/commands.spec.ts src/features/space/SpaceView.spec.tsx`: exit 0; 2 test files, 40 tests passed.
- `git --work-tree='/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ' diff --check -- agentwiki/apps/client/src/components/markdown-tools/commands.ts agentwiki/apps/client/src/features/space/SpaceView.tsx`: exit 0.

## ES2020 compatibility follow-up

The controller's build identified `TS2554`: this client's ES2020 library does not declare the two-argument `Error` constructor. The original scoped lint and tests had not caught that compatibility error.

Replaced the three wrappers with `Object.assign(new Error(existingMessage), { cause: failure })`. This preserves the translated message and original cause without changing `tsconfig` or target/library settings. Only `SpaceView.tsx` changed in this follow-up; no commit created.

Fresh validation after the compatibility fix:

- Full client `pnpm exec tsc --noEmit`: exit 0.
- Full client `pnpm lint`: exit 0, no diagnostics; log `/tmp/document-workspace-client-lint-compat.log`.
- Scoped lint of both owned files: exit 0, no diagnostics.
- Same focused Vitest command: 2 test files, 40 tests passed, exit 0.
- Scoped `git diff --check`: exit 0.

Status: frozen for controller commit.
