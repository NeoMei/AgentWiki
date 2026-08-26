# Markdown rich-rendering verification — 2026-08-26 plan

Verification was executed locally on 2026-08-27 (Asia/Shanghai) for branch `codex/markdown-rendering-attachments`, starting from Task 1–3 candidate `9635677f55f8404304b9ccbae2471acc195ed5d4`. This record covers local browser acceptance, documentation, security convergence, and repository gates only.

## Regression-first convergence

The bilingual guide test was extended before the guide copy changed:

```bash
pnpm --filter @agentwiki/client exec vitest run src/i18n/markdown-support-messages.spec.tsx
```

RED: 1 file ran and 2/2 tests failed because neither locale documented rich rendering. After adding the same contract to both guide surfaces, the focused GREEN command was:

```bash
pnpm --filter @agentwiki/client exec vitest run src/i18n/markdown-support-messages.spec.tsx src/features/about/UsageGuide.spec.tsx
```

Result: 2/2 files and 4/4 tests passed. Both Chinese and English now state the literal `$...$`, `$$...$$`, and fenced \`\`\`mermaid ... \`\`\` syntax; raw HTML is disabled; Mermaid clicks and HTML labels are disabled; malformed math or diagrams retain a readable local fallback; and each root document renders at most 20 Mermaid diagrams.

The first real Mermaid fixture exposed one product defect rather than a documentation discrepancy. Mermaid 11.17.2 produced `xlink:href` for the deliberately unsafe click directive without declaring `xmlns:xlink`; strict XML parsing rejected the otherwise renderable SVG before the sanitizer could strip the link. A regression was added first:

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/markdown/mermaidSecurity.spec.ts
```

RED: 12 tests ran, 11 passed, and the new namespace regression failed with `MERMAID_SVG_INVALID`. The narrow fix adds the standard XLink namespace only when Mermaid's leading `<svg>` has an undeclared `xlink:href`; normal DOMPurify and post-sanitizer URL checks then remove that link.

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/markdown/mermaidSecurity.spec.ts src/components/markdown/MermaidDiagram.spec.tsx
```

GREEN: 2/2 files and 24/24 tests passed. No other validated convergence finding required production changes.

## Real-browser acceptance

The run used only PostgreSQL database `agentwiki_collaboration_test`, role `neomei`, and disposable schema `collaboration_test_markdown_rich_task4_20260827_0005`. The target database and schema absence were checked before creation. `prisma migrate deploy` reported 43 migrations and applied them only to that schema; `public` was neither migrated nor removed. The local API health endpoint reported database, Redis, and audit persistence healthy before the browser run.

The final run used the repository Playwright harness with installed Chrome (`channel: chrome`), local web target `http://127.0.0.1:5173`, and local API target `http://127.0.0.1:3000/api/`:

```bash
AGENTWIKI_WEB_URL='http://127.0.0.1:5173' AGENTWIKI_API_URL='http://127.0.0.1:3000/api/' pnpm --filter @agentwiki/client exec playwright test e2e/markdown-core.spec.ts
```

Result: 1/1 passed; test body 18.2 seconds, command 23.4 seconds. Chrome's default 1280 × 720 desktop viewport and an explicit 390 × 844 viewport were exercised. The fixture and assertions proved:

- two `.katex` renderings and two accessible `.katex-mathml math` trees for inline and display formulas;
- exactly one ready, sanitized Mermaid SVG plus three local fallbacks: malformed math, malformed Mermaid, and a 20,001-character Mermaid source;
- readable invalid/over-limit source remained in its own block;
- raw `<script>`/`<img onerror>` Markdown was absent, and rendered content contained no script, iframe, object, embed, `foreignObject`, event handler, executable URL, remote URL attribute, or external request;
- the unsafe Mermaid click target had no `href`/`xlink:href`; clicking its visible `Start` node did not navigate;
- warning/error console collection remained empty;
- page view, editor preview, and version-history preview all used the shared rich renderer; historical and viewer checklists stayed read-only, while the owner checklist remained clickable, persisted, and created exactly one PageVersion;
- both desktop and 390 px checks had `documentElement.scrollWidth === clientWidth`; wide diagram, code, formula, and table content stayed contained or locally scrollable.

Passing-run screenshots were inspected from the system temporary directory and were not committed:

- `/var/folders/0n/49qgdd8x7kgcvh719fw743mh0000gn/T/agentwiki-markdown-core-qa/1787761088528-b0a5b4fd24d4b8/owner-persisted.png`
- `/var/folders/0n/49qgdd8x7kgcvh719fw743mh0000gn/T/agentwiki-markdown-core-qa/1787761088528-b0a5b4fd24d4b8/viewer-read-only.png`
- `/var/folders/0n/49qgdd8x7kgcvh719fw743mh0000gn/T/agentwiki-markdown-core-qa/1787761088528-b0a5b4fd24d4b8/mobile-390.png`

The API cleanup left active fixture users/Spaces/pages at `0/0/0`; audit rows were soft-deleted as designed. The task-owned API and client processes were stopped, ports 3000 and 5173 had no listeners, and the exact disposable schema count changed from 1 before `DROP SCHEMA` to 0 afterward. Redis was pre-existing and was not stopped. Generated Playwright failure artifacts were removed.

## Dependency, chunk, and security review

`pnpm --filter @agentwiki/client why remark-math rehype-katex katex mermaid dompurify` found one resolved version of every reviewed dependency: `remark-math@6.0.0`, `rehype-katex@7.0.1`, `katex@0.18.4`, `mermaid@11.17.2`, and `dompurify@3.4.14`. They are exact direct client dependencies; the root lockfile override also pins KaTeX 0.18.4.

The fresh production build transformed 4,731 modules in 16.52 seconds. It emitted local `Markdown-DGqifc7L.js` (665.54 kB, gzip 205.32 kB) and separate `mermaid.core-COZRzZHj.js` (666.75 kB, gzip 160.79 kB) assets; the Markdown chunk contains `import("./mermaid.core-COZRzZHj.js")`. No CDN, remote script, or remote stylesheet reference was found. The existing Vite advisory for chunks larger than 500 kB remains a non-blocking bundle-size concern.

Security review conclusions:

| Surface | Evidence and conclusion |
| --- | --- |
| KaTeX trust and bounds | `trust: false`, `throwOnError: false`, `maxSize: 20`, `maxExpand: 1000`, `globalGroup: false`, and `htmlAndMathml`; unsafe trust commands and malformed input have focused tests. |
| Mermaid directives | Cached dynamic import initializes once with `startOnLoad: false`, `securityLevel: 'strict'`, protected `secure` keys, `maxTextSize: 20_000`, `maxEdges: 200`, suppressed error DOM, and HTML labels off. Render callback binding is never invoked. |
| SVG sanitization | SVG root and namespace must parse strictly. DOMPurify's SVG profiles remove executable tags/events; the post-pass permits only local fragment hrefs and removes external/encoded/mixed-case URL forms. CSS URL resources, escaped/ambiguous CSS, unscoped selectors, sibling escapes, and invalid roots fail closed. The Mermaid XLink compatibility repair does not retain the click URL. |
| Raw HTML and malformed trees | React Markdown uses `skipHtml` and does not enable `rehypeRaw`; fenced Mermaid classification requires the annotated `pre > code.language-mermaid` AST shape. Malformed and over-limit content falls back locally without replacing the document. |
| Async lifecycle and identity | Focused tests prove unique safe render IDs, stale source results ignored, and pending results discarded after unmount. The 20-diagram cap is counted independently for each render root. |
| CSP and runtime network | All JS, CSS, KaTeX fonts, and Mermaid assets are self-hosted; the feature adds no runtime CDN or eval path, and browser request capture saw zero non-loopback requests. The application source does not itself install a CSP response header, so this is compatibility evidence rather than a claim that Task 4 enabled CSP enforcement. |
| Responsive containment | Shared Markdown styles bound Mermaid SVG, KaTeX display blocks, images, code, and tables. Real desktop and 390 px document-overflow assertions passed. |

## Fresh gates

Every required command exited 0 in this order:

1. `pnpm --filter @agentwiki/client test`: 74/74 files and 825/825 tests passed in 48.87 seconds.
2. `pnpm lint`: passed with no diagnostics across server/client source and local sync.
3. `pnpm typecheck`: passed for server, client, sync protocol, and local sync.
4. `pnpm build`: passed for shared, sync protocol ESM/CJS, server, client, and local sync; Vite transformed 4,731 modules in 16.52 seconds and emitted only the recorded size advisory.
5. `git diff --check`: passed with no whitespace errors.

## Release state

- **Local branch:** Task 4 is committed locally on `codex/markdown-rendering-attachments` after the verified Task 1–3 candidate `9635677f55f8404304b9ccbae2471acc195ed5d4`.
- **GitHub:** not pushed by Task 4; no remote branch or release claim is made.
- **npm:** not published by Task 4; no registry release claim is made.
- **Production:** not migrated, deployed, or probed by Task 4; loopback Chrome evidence is local acceptance only.

No push, npm publish, production migration, or production deployment was authorized or performed.
