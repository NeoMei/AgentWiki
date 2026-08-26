# Markdown Math and Mermaid Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe, lazy, locally bundled KaTeX and Mermaid rendering to the shared Markdown pipeline without weakening raw-HTML or URL protections.

**Architecture:** Parse math through remark/rehype and render Mermaid fenced blocks through a dedicated lazy React component. Keep Mermaid's dynamic SVG path isolated behind strict configuration, deterministic limits, DOMPurify SVG sanitization, and a local error boundary so malformed diagrams never break the document.

**Tech Stack:** remark-math 6.0.0, rehype-katex 7.0.1, KaTeX 0.18.4, Mermaid 11.17.2, DOMPurify 3.4.14, React 18, Vitest 3, Playwright 1.62, Vite 6.

## Global Constraints

- The core plan `2026-08-26-markdown-core-checklist-plan.md` must be complete and green first.
- KaTeX and Mermaid assets are bundled locally; no runtime CDN, remote script, or remote stylesheet.
- KaTeX uses `trust: false`, bounded size/expansion, and no shared mutable global macros.
- Mermaid uses `startOnLoad: false` and `securityLevel: 'strict'`; document content cannot override security configuration.
- Mermaid output is sanitized as SVG before the only controlled `dangerouslySetInnerHTML` use.
- Raw Markdown HTML and dangerous URL protocols remain disabled.
- Mermaid is dynamically imported only when a Mermaid code block renders.
- Malformed or over-limit content degrades within its own block and preserves readable source.
- Do not push, publish npm packages, migrate production, or deploy production in this plan.

---

## File Structure

- Modify `apps/client/package.json` and `pnpm-lock.yaml`: fixed rich-rendering dependencies.
- Create `apps/client/src/components/markdown/math.ts`: exported KaTeX plugin options.
- Create `apps/client/src/components/markdown/math.spec.tsx`: math, errors, trust, and raw HTML tests.
- Create `apps/client/src/components/markdown/mermaidSecurity.ts`: source limits and sanitized SVG function.
- Create `apps/client/src/components/markdown/mermaidSecurity.spec.ts`: malicious SVG and size tests.
- Create `apps/client/src/components/markdown/MermaidDiagram.tsx`: lazy loader, unique render IDs, cancellation, and fallback UI.
- Create `apps/client/src/components/markdown/MermaidDiagram.spec.tsx`: loader, render, failure, cleanup, and stale-result tests.
- Modify `apps/client/src/components/Markdown.tsx`: math plugins and Mermaid code component.
- Modify `apps/client/src/components/Markdown.spec.tsx`: integrated rendering and lazy-import contract.
- Modify `apps/client/e2e/markdown-core.spec.ts`: desktop/mobile math and Mermaid acceptance.
- Modify `apps/client/src/features/about/UsageGuide.tsx`, `apps/client/src/features/docs/DocsFeatures.tsx`, and `apps/client/src/i18n/messages.ts`: supported syntax and failure copy.

### Task 1: Add KaTeX dependencies and safe shared math rendering

**Files:**
- Modify: `apps/client/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/client/src/components/markdown/math.ts`
- Create: `apps/client/src/components/markdown/math.spec.tsx`
- Modify: `apps/client/src/components/Markdown.tsx`

**Interfaces:**
- Produces: `KATEX_OPTIONS` and shared support for `$...$` / `$$...$$`.
- Consumers: every shared Markdown render mode.

- [ ] **Step 1: Install the reviewed versions**

Run:

```bash
pnpm --filter @agentwiki/client add remark-math@6.0.0 rehype-katex@7.0.1 katex@0.18.4
```

Expected: lockfile resolves the exact versions and no CDN reference is introduced.

- [ ] **Step 2: Write failing math and security tests**

```tsx
it('renders inline and display math with accessible MathML', () => {
  renderMd('Euler: $e^{i\\pi}+1=0$\n\n$$\\int_0^1 x^2 dx$$');
  expect(document.querySelectorAll('.katex')).toHaveLength(2);
  expect(document.querySelector('math')).toBeInTheDocument();
});

it('renders an invalid formula as local error text without crashing', () => {
  renderMd('before $\\notARealCommand{$ after');
  expect(screen.getByText(/before/)).toBeInTheDocument();
});

it('does not trust external-resource or html commands', () => {
  renderMd('$\\includegraphics{https://evil.test/pixel.png}$ $\\htmlClass{x}{bad}$');
  expect(document.querySelector('img[src*="evil.test"]')).toBeNull();
  expect(document.querySelector('.x')).toBeNull();
});

it('still skips raw markdown html', () => {
  renderMd('<img src=x onerror=alert(1)>safe');
  expect(document.querySelector('img')).toBeNull();
  expect(screen.getByText('safe')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/markdown/math.spec.tsx
```

Expected: FAIL because math is rendered as literal text.

- [ ] **Step 4: Implement and wire exact options**

Create:

```ts
import type { Options as KatexOptions } from 'katex';

export const KATEX_OPTIONS: KatexOptions = Object.freeze({
  trust: false,
  strict: 'warn',
  throwOnError: false,
  maxSize: 20,
  maxExpand: 1000,
  output: 'htmlAndMathml',
  globalGroup: false,
});
```

Add `remarkMath` after GFM and `rehypeKatex` before heading autolinks/highlighting. Import `katex/dist/katex.min.css` from the client bundle. Set `skipHtml` on ReactMarkdown explicitly.

- [ ] **Step 5: Run math and Markdown regressions**

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/markdown/math.spec.tsx src/components/Markdown.spec.tsx
```

Expected: PASS with no `console.error` from invalid input.

- [ ] **Step 6: Commit safe math rendering**

```bash
git add apps/client/package.json pnpm-lock.yaml apps/client/src/components/markdown/math.ts apps/client/src/components/markdown/math.spec.tsx apps/client/src/components/Markdown.tsx
git commit -m "feat(markdown): render bounded KaTeX math"
```

### Task 2: Build strict Mermaid loading and SVG sanitization

**Files:**
- Modify: `apps/client/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/client/src/components/markdown/mermaidSecurity.ts`
- Create: `apps/client/src/components/markdown/mermaidSecurity.spec.ts`
- Create: `apps/client/src/components/markdown/MermaidDiagram.tsx`
- Create: `apps/client/src/components/markdown/MermaidDiagram.spec.tsx`

**Interfaces:**
- Produces: `MAX_MERMAID_SOURCE_CHARS = 20_000`, `sanitizeMermaidSvg(svg)`, `MermaidDiagram`, and test seam `loadMermaidRuntime()`.
- Consumers: shared Markdown code renderer in Task 3.

- [ ] **Step 1: Install reviewed Mermaid dependencies**

```bash
pnpm --filter @agentwiki/client add mermaid@11.17.2 dompurify@3.4.14
```

Expected: both packages are client dependencies and Vite can split Mermaid into a dynamic chunk.

- [ ] **Step 2: Write failing sanitizer tests**

```ts
import { describe, expect, it } from 'vitest';
import { sanitizeMermaidSvg } from './mermaidSecurity';

describe('sanitizeMermaidSvg', () => {
  it('removes executable and external navigation surfaces', () => {
    const dirty = '<svg><script>alert(1)</script><foreignObject><div>x</div></foreignObject><a href="javascript:alert(1)" onclick="x()"><text>bad</text></a><a href="#local"><text>ok</text></a></svg>';
    const clean = sanitizeMermaidSvg(dirty);
    expect(clean).not.toMatch(/script|foreignObject|onclick|javascript:/u);
    expect(clean).toContain('href="#local"');
  });

  it('rejects a non-svg root', () => {
    expect(() => sanitizeMermaidSvg('<div>no</div>')).toThrow('MERMAID_SVG_INVALID');
  });
});
```

Component tests must mock `loadMermaidRuntime` and assert initialize options, a sanitized render, invalid-source fallback, over-limit fallback without calling Mermaid, unique render IDs for two diagrams, and unmount/stale promise safety.

- [ ] **Step 3: Run tests and verify RED**

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/markdown/mermaidSecurity.spec.ts src/components/markdown/MermaidDiagram.spec.tsx
```

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement sanitizer and lazy runtime**

Implement `sanitizeMermaidSvg` with DOMPurify `USE_PROFILES: { svg: true, svgFilters: true }`, forbid `script`, `foreignObject`, `iframe`, `object`, `embed`, and `audio`, then parse the result and remove every `href`/`xlink:href` that is neither absent nor a local `#fragment`. Require an `<svg>` root and return its serialized string.

The runtime loader is a cached dynamic import:

```ts
let runtimePromise: Promise<typeof import('mermaid')['default']> | null = null;

export const loadMermaidRuntime = () => {
  runtimePromise ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'htmlLabels'],
      maxTextSize: 20_000,
      maxEdges: 200,
      suppressErrorRendering: true,
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: true },
    });
    return mermaid;
  });
  return runtimePromise;
};
```

`MermaidDiagram` must reject sources over 20,000 characters before loading, use a module counter plus `useId()`-derived safe ID, call `mermaid.parse` then `mermaid.render`, sanitize SVG, never call `bindFunctions`, and ignore results after unmount/source change. Render status/fallback with localized props rather than throwing.

- [ ] **Step 5: Run sanitizer and component tests**

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/markdown/mermaidSecurity.spec.ts src/components/markdown/MermaidDiagram.spec.tsx
```

Expected: PASS; malicious content is absent and mock `bindFunctions` has zero calls.

- [ ] **Step 6: Commit the isolated Mermaid renderer**

```bash
git add apps/client/package.json pnpm-lock.yaml apps/client/src/components/markdown/mermaidSecurity.ts apps/client/src/components/markdown/mermaidSecurity.spec.ts apps/client/src/components/markdown/MermaidDiagram.tsx apps/client/src/components/markdown/MermaidDiagram.spec.tsx
git commit -m "feat(markdown): add strict Mermaid renderer"
```

### Task 3: Integrate Mermaid code blocks, per-document limits, and responsive layout

**Files:**
- Modify: `apps/client/src/components/Markdown.tsx`
- Modify: `apps/client/src/components/Markdown.spec.tsx`
- Modify: `apps/client/src/i18n/messages.ts`

**Interfaces:**
- Consumes: `MermaidDiagram`, `MAX_MERMAID_SOURCE_CHARS`, and shared render modes.
- Produces: maximum 20 rendered Mermaid blocks per root document and normal highlighting for all other code blocks.

- [ ] **Step 1: Write failing integrated tests**

Mock `MermaidDiagram` and render one `language-mermaid` fence plus one TypeScript fence. Assert only the Mermaid fence invokes the component, the TypeScript fence retains Highlight.js classes, the 21st Mermaid block becomes a limit fallback, and a document without Mermaid does not invoke the runtime loader.

- [ ] **Step 2: Run Markdown tests and verify RED**

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/Markdown.spec.tsx
```

Expected: FAIL because Mermaid is still rendered as highlighted code.

- [ ] **Step 3: Add deterministic Mermaid indexing**

Add a remark/rehype annotation pass that numbers only fenced code nodes whose normalized language is `mermaid`. In the custom `code` component, render `MermaidDiagram` only when the node is a block, its language is Mermaid, and `data-mermaid-index < 20`; otherwise render the localized limit fallback or the existing highlighted code path. Do not infer block/inline status from removed react-markdown props; inspect the node/parent metadata created by the plugin.

Add responsive classes so Mermaid SVG, KaTeX display blocks, tables, preformatted code, and images are bounded by their content container and get local overflow where needed.

- [ ] **Step 4: Run integrated, workspace, and build checks**

```bash
pnpm --filter @agentwiki/client exec vitest run src/components/Markdown.spec.tsx src/components/MarkdownWorkspace.spec.tsx src/components/markdown
pnpm --filter @agentwiki/client build
```

Expected: tests PASS; build output contains a separate Mermaid chunk and normal pages retain the main bundle.

- [ ] **Step 5: Commit shared rich rendering**

```bash
git add apps/client/src/components/Markdown.tsx apps/client/src/components/Markdown.spec.tsx apps/client/src/i18n/messages.ts
git commit -m "feat(markdown): integrate safe rich rendering"
```

### Task 4: Accept rich rendering in real browsers and update support documentation

**Files:**
- Modify: `apps/client/e2e/markdown-core.spec.ts`
- Modify: `apps/client/src/features/about/UsageGuide.tsx`
- Modify: `apps/client/src/features/docs/DocsFeatures.tsx`
- Create: `docs/verification/markdown-rich-rendering-2026-08-26.md`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: desktop/mobile/security evidence and truthful user documentation.

- [ ] **Step 1: Extend the disposable browser fixture**

Add valid inline/display math, a valid Mermaid flowchart, invalid math, invalid Mermaid, a 20,001-character Mermaid fence, raw HTML, and a wide diagram. Assert `.katex`, accessible MathML, one rendered Mermaid SVG, three local fallbacks, no executable element/event attribute, no document overflow at 390px, and zero console errors/warnings.

- [ ] **Step 2: Run browser acceptance**

```bash
pnpm --filter @agentwiki/client exec playwright test e2e/markdown-core.spec.ts
```

Expected: PASS against local API/client; invalid blocks remain visible without white-screen failure.

- [ ] **Step 3: Update Chinese and English docs**

Add the exact `$...$`, `$$...$$`, and fenced Mermaid syntax. State that raw HTML is disabled, Mermaid clicks/HTML labels are disabled, malformed blocks show local errors, and diagrams are limited to 20 per root document.

- [ ] **Step 4: Run convergence gates and fresh security review**

```bash
pnpm --filter @agentwiki/client test
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

Review package versions, dynamic import behavior, SVG sanitizer URL attributes, Mermaid configuration directives, KaTeX trust commands, raw HTML, malformed AST, stale async renders, unique IDs, CSP compatibility, and 390px overflow. Every validated finding first gets a failing regression test.

- [ ] **Step 5: Record and commit verification**

Write exact command counts, browser viewport/results, generated chunk evidence, security cases, and release state to `docs/verification/markdown-rich-rendering-2026-08-26.md`.

```bash
git add apps/client/e2e/markdown-core.spec.ts apps/client/src/features/about/UsageGuide.tsx apps/client/src/features/docs/DocsFeatures.tsx docs/verification/markdown-rich-rendering-2026-08-26.md
git commit -m "docs: verify markdown rich rendering"
```
