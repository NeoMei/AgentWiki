# Client bundle budget repair

## Scope and diagnosis

- Owned change: `agentwiki/apps/client/vite.config.ts` only. No product editor, Assist, notes, package, lockfile or budget changes; no commit, deployment or service stop.
- Before repair, complete client production build failed the emitted-file budget: `assets/PageEditor-DFpPKIss.js` = 518706 bytes, ordinary limit = 500000 bytes. Original full repository build log: `/tmp/document-workspace-build.log`.
- Reproduced the same failure using Vite's actual config and a temporary pre-audit diagnostic plugin, with `write:false`. Module/chunk inventory: `/tmp/document-workspace-bundle-modules.json`. The pre-audit chunk was 516351 bytes; Vite's dynamic-import preload rewrite raised the final audited output to 518706 bytes. The existing post-order budget check remains unchanged.
- PageEditor contained CodeMirror language (91465 rendered bytes), Lezer markdown (86764), autocomplete (83415), Lezer common (83180), JavaScript grammar (80732), commands (70078), Lezer LR (54685), highlight (28854), plus product code. The existing `editor-core` contained only CodeMirror view/state and was 241355 bytes.
- Since the approved branch baseline, the only newly declared CodeMirror dependency is commands 6.10.4, promoted from an existing transitive dependency. No new heavy library caused this failure; growing product code and the pre-existing runtime aggregation pushed the page chunk beyond its budget.

## Repair

- Extend the existing `editor-core` manual chunk to include CodeMirror language and Lezer common/highlight/lr. These are the shared parsing/highlighting runtimes used by Markdown and other language modes.
- Retain `onlyExplicitManualChunks:true`, Rollup's independent language grammar/optional-mode chunks, and every existing budget. Do not merge all CodeMirror/language-data or all Lezer grammars into one vendor chunk, which would eagerly load optional language implementations with the editor.
- The emitted `editor-core` imports only the existing 6597-byte shared dependency chunk and has no reverse import of PageEditor. No new editor chunk cycle was reported.

## Fresh verification

Commands run from `agentwiki`; all exited 0:

- `pnpm --filter @agentwiki/client build`: complete TypeScript + production Vite build, 4796 modules; `/tmp/document-workspace-bundle-repair-build.log`.
- `pnpm --filter @agentwiki/client exec vitest run build/bundleBudget.spec.ts`: 1 suite / 6 tests pass; `/tmp/document-workspace-bundle-repair-tests.log`. Covers per-chunk limit, aggregate initial limit, lazy runtime rejection, bounded Mermaid-only exception and mixed-code rejection.
- `pnpm --filter @agentwiki/client exec tsc --noEmit`: `/tmp/document-workspace-bundle-repair-tsc.log`.
- `pnpm --filter @agentwiki/client exec tsc --noEmit --target ES2020 --module ESNext --moduleResolution bundler --allowSyntheticDefaultImports --skipLibCheck --strict vite.config.ts`: includes changed Vite config; `/tmp/document-workspace-bundle-repair-config-tsc-standalone.log`.
- `pnpm --filter @agentwiki/client lint`: complete client source lint; `/tmp/document-workspace-bundle-repair-lint.log`.
- `pnpm exec eslint apps/client/vite.config.ts --global URL:readonly --global process:readonly --global __dirname:readonly`: config-specific lint, globals supplied because repository frontend override only applies to `src`; `/tmp/document-workspace-bundle-repair-config-lint.log`.
- Git explicit-work-tree `diff --check` for owned file passes.

Final emitted file sizes read directly from `apps/client/dist/assets`:

| Artifact | Bytes | Limit |
| --- | ---: | ---: |
| PageEditor-Cqu3x2L_.js | 423120 | 500000 |
| editor-core-7MhzyKWc.js | 336673 | 500000 |
| Initial JavaScript static graph (budget plugin) | 547266 | 550000 |

The original build failure serves as RED; the complete production build with unchanged budget plugin serves as GREEN. No additional threshold changes or implementation-mirroring tests were needed.

## Limits and handoff

- Startup JavaScript has only 2734 bytes of remaining headroom; the existing aggregate gate remains active.
- Extra direct check using `tsconfig.node.json` failed due to pre-existing ES5 default target with Unicode regexes and composite include omitting `build/bundleBudget.ts` (TS1501/TS6307); `/tmp/document-workspace-bundle-repair-config-tsc.log`. A standalone strict ES2020 config check passes. This repair does not change that unrelated project configuration.
- Existing Mermaid circular-chunk warnings and the bounded full-parser exception remain visible. They were present before this repair and are not expanded by it.
- This receipt proves build and static checks, not native browser acceptance. Controller should include editing, undo and Markdown language loading in the final browser acceptance after integrating the repair.
- Local acceptance service at localhost:59105 was not touched.
