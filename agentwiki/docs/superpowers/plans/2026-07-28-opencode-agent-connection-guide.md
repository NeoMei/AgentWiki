# OpenCode Agent Connection Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the usage guide with a real OpenCode-to-AgentWiki page publishing demonstration and verifiable success evidence.

**Architecture:** Keep the existing static React guide and its proportional screenshot component. Generate all new assets from the running AgentWiki and OpenCode Web UIs through the browser plugin, using a temporary least-privilege Agent credential and a dedicated auto-publish demo Space. The guide then presents a six-step linear flow and three independent success signals without adding a new backend protocol.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vitest, Testing Library, Vite, AgentWiki Streamable HTTP MCP, OpenCode 1.18.7, browser plugin screenshots.

## Global Constraints

- Use real AgentWiki and real OpenCode UI captures; never use mock screenshots.
- Keep all screenshot source dimensions proportional and crop only with `object-fit: cover` or a browser viewport.
- Add Simplified Chinese and English copy for every new visible instruction.
- Never store an active `agk_` credential, a prompt containing that credential, or an unredacted screenshot in the repository.
- Use only `spaces:read`, `pages:read`, `pages:write`, and `review:auto-publish` for the temporary credential.
- Auto-publish requires the demo Space policy, Agent approval mode, credential scope, and editor grant to all allow it.
- Revoke the temporary credential and remove the temporary OpenCode project configuration after capture.

---

### Task 1: Produce the real OpenCode publishing evidence

**Files:**
- Create: `apps/client/public/screenshots/step4-generated-credential.png`
- Create: `apps/client/public/screenshots/step5-opencode-publish.png`
- Create: `apps/client/public/screenshots/step6-opencode-success.png`
- Create: `apps/client/public/screenshots/step6-published-page.png`
- Create: `apps/client/public/screenshots/step6-activity-log.png`

**Interfaces:**
- Consumes: AgentWiki browser UI, `buildAgentConnectInstructions(input, zh)`, `/api/mcp`, OpenCode Web.
- Produces: five secret-free screenshot assets with their functional target centered in the viewport.

- [ ] **Step 1: Create a dedicated demo Space and Agent in the real UI**

Create a Space named `OpenCode 接入演示`, set its automation approval policy to `scoped-auto-publish`, create an Agent named `OpenCode Demo`, set that Agent's approval mode to `scoped-auto-publish`, and grant it editor access to the demo Space.

Expected UI state:

```text
Space: OpenCode 接入演示
Space approval policy: scoped-auto-publish
Agent: OpenCode Demo
Agent approval mode: scoped-auto-publish
Space grant: editor
```

- [ ] **Step 2: Create the least-privilege temporary credential**

Select exactly these credential scopes in the Agent access page:

```text
spaces:read
pages:read
pages:write
review:auto-publish
```

Create a credential named `OpenCode guide temporary`. Copy the generated integration instructions directly to the clipboard. Do not save the key or instructions to a workspace file.

- [ ] **Step 3: Capture the safe credential/instruction control state**

Use the browser viewport capability rather than screenshot `clip`. Scroll the real Agent page so only the generated-instruction label and `复制接入指令` control are visible; keep the key row and prompt body outside the viewport. Save the full viewport screenshot as:

```text
apps/client/public/screenshots/step4-generated-credential.png
```

Expected image properties:

```text
PNG format
width >= 1200
no complete agk_ token visible
no stretched controls or text
```

- [ ] **Step 4: Start OpenCode Web in an isolated project directory**

Run:

```bash
demo_dir="$(mktemp -d /tmp/agentwiki-opencode-guide.XXXXXX)"
cd "$demo_dir"
opencode web --hostname 127.0.0.1 --port 4099
```

Expected: OpenCode Web reports a listening URL on `http://127.0.0.1:4099` and uses the temporary directory as its project context.

- [ ] **Step 5: Feed the generated instructions to OpenCode and publish a page**

In OpenCode Web, paste the generated integration instructions and append this request in the same message:

```text
接入成功后，请在“OpenCode 接入演示”空间发布一个页面：
标题：OpenCode 已接入 AgentWiki
正文：这是由本地 OpenCode 通过 AgentWiki MCP 创建并自动发布的页面。
发布后读取该页面或重新列出页面，确认它已经正式发布，而不是停留在待审核状态。
```

Approve only the local configuration write and AgentWiki MCP connection required for this demonstration. Capture a full browser-plugin viewport focused on the visible tool-call sequence without the original secret-bearing user message, and save it as:

```text
apps/client/public/screenshots/step5-opencode-publish.png
```

- [ ] **Step 6: Verify and capture the OpenCode success response**

The response must report all of the following before capture:

```text
已接入 AgentWiki（OpenCode Demo）
空间：OpenCode 接入演示
页面：OpenCode 已接入 AgentWiki
状态：已发布
```

Capture the response-only viewport as:

```text
apps/client/public/screenshots/step6-opencode-success.png
```

- [ ] **Step 7: Verify and capture the published AgentWiki page**

Open the real page in AgentWiki and confirm the page detail shows the exact title and body plus Agent provenance. Capture it as:

```text
apps/client/public/screenshots/step6-published-page.png
```

- [ ] **Step 8: Verify and capture the Agent activity record**

Open `OpenCode Demo` → `活动记录`. Confirm successful calls from the same run include `list_spaces` and `propose_page`, then capture it as:

```text
apps/client/public/screenshots/step6-activity-log.png
```

- [ ] **Step 9: Revoke and clean up**

Revoke `OpenCode guide temporary`, verify the revoked credential receives HTTP 401 from `GET /api/integrations/mcp`, delete the dedicated demo Space and Agent, stop OpenCode Web, and remove the temporary directory:

```bash
rm -rf "$demo_dir"
```

Keep only the secret-free screenshots as documentation evidence; do not leave temporary AgentWiki or OpenCode state behind.

- [ ] **Step 10: Validate and commit only safe assets**

Run:

```bash
file apps/client/public/screenshots/step{4-generated-credential,5-opencode-publish,6-opencode-success,6-published-page,6-activity-log}.png
rg -a -n 'agk_[A-Za-z0-9_-]{8,}' apps/client/public/screenshots/step{4-generated-credential,5-opencode-publish,6-opencode-success,6-published-page,6-activity-log}.png
```

Expected: all five files are PNG images; `rg` prints no credential match.

Commit:

```bash
git add apps/client/public/screenshots/step4-generated-credential.png \
  apps/client/public/screenshots/step5-opencode-publish.png \
  apps/client/public/screenshots/step6-opencode-success.png \
  apps/client/public/screenshots/step6-published-page.png \
  apps/client/public/screenshots/step6-activity-log.png
git commit -m "docs: capture real OpenCode publishing flow"
```

---

### Task 2: Expand the guide to six steps

**Files:**
- Create: `apps/client/src/features/about/UsageGuide.spec.tsx`
- Modify: `apps/client/src/features/about/UsageGuide.tsx`

**Interfaces:**
- Consumes: `GuideScreenshot`, `LanguageProvider`, the five screenshot paths from Task 1.
- Produces: a bilingual six-step connection guide with proportional evidence images.

- [ ] **Step 1: Write the failing guide structure test**

Create `apps/client/src/features/about/UsageGuide.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { UsageGuide } from './UsageGuide';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

const renderGuide = () => render(
  <LanguageProvider>
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <UsageGuide />
    </MemoryRouter>
  </LanguageProvider>,
);

describe('UsageGuide Agent connection flow', () => {
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'zh-CN'));

  it('shows key generation, OpenCode publishing, and three success signals', () => {
    renderGuide();

    expect(screen.getByRole('heading', { name: '生成 Key 与接入指令' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '把接入指令交给 OpenCode' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '确认页面已发布' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '已生成 Key 和接入指令' })).toHaveAttribute('src', '/screenshots/step4-generated-credential.png');
    expect(screen.getByRole('img', { name: 'OpenCode 发布页面过程' })).toHaveAttribute('src', '/screenshots/step5-opencode-publish.png');
    expect(screen.getByRole('img', { name: 'OpenCode 接入成功结果' })).toHaveAttribute('src', '/screenshots/step6-opencode-success.png');
    expect(screen.getByRole('img', { name: 'AgentWiki 已发布页面' })).toHaveAttribute('src', '/screenshots/step6-published-page.png');
    expect(screen.getByRole('img', { name: 'AgentWiki MCP 活动记录' })).toHaveAttribute('src', '/screenshots/step6-activity-log.png');
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-flow failure**

Run:

```bash
pnpm --filter @agentwiki/client test -- UsageGuide.spec.tsx
```

Expected: FAIL because the three new headings and screenshot paths are not present.

- [ ] **Step 3: Replace the old credential step and add OpenCode steps**

In `UsageGuide.tsx`, keep Steps 1–3 and replace the current Step 4 card with these headings and image mappings:

```tsx
<h3>{zh ? '生成 Key 与接入指令' : 'Generate a Key and Instructions'}</h3>
<GuideScreenshot
  src="/screenshots/step4-generated-credential.png"
  alt={zh ? '已生成 Key 和接入指令' : 'Generated key and connection instructions'}
  focus="center"
/>

<h3>{zh ? '把接入指令交给 OpenCode' : 'Give the Instructions to OpenCode'}</h3>
<GuideScreenshot
  src="/screenshots/step5-opencode-publish.png"
  alt={zh ? 'OpenCode 发布页面过程' : 'OpenCode page publishing flow'}
  focus="center"
/>

<h3>{zh ? '确认页面已发布' : 'Confirm the Page Is Published'}</h3>
<GuideScreenshot
  src="/screenshots/step6-opencode-success.png"
  alt={zh ? 'OpenCode 接入成功结果' : 'OpenCode connection success'}
  focus="bottom"
/>
<GuideScreenshot
  src="/screenshots/step6-published-page.png"
  alt={zh ? 'AgentWiki 已发布页面' : 'Published AgentWiki page'}
  focus="center"
/>
<GuideScreenshot
  src="/screenshots/step6-activity-log.png"
  alt={zh ? 'AgentWiki MCP 活动记录' : 'AgentWiki MCP activity log'}
  focus="center"
/>
```

The Step 4 copy must say the key is shown once and the complete integration instructions are copied as one unit. The Step 5 copy must say the user pastes the instructions into a local Agent and may ask it to publish a page. The Step 6 copy must explain that OpenCode result, published page, and activity log are the three success signals.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @agentwiki/client test -- UsageGuide.spec.tsx
```

Expected: one test file passes with the six-step flow and all four evidence image assertions.

- [ ] **Step 5: Commit the guide implementation**

```bash
git add apps/client/src/features/about/UsageGuide.tsx \
  apps/client/src/features/about/UsageGuide.spec.tsx
git commit -m "feat: document OpenCode AgentWiki publishing flow"
```

---

### Task 3: Verify the guide visually and close out

**Files:**
- Modify if needed: `apps/client/src/features/about/UsageGuide.tsx`
- Modify if needed: `apps/client/src/features/about/UsageGuide.spec.tsx`

**Interfaces:**
- Consumes: completed guide and screenshot assets.
- Produces: a tested, responsive, secret-free guide committed and pushed to `master`.

- [ ] **Step 1: Run the complete client gate**

```bash
pnpm --filter @agentwiki/client lint
pnpm --filter @agentwiki/client test
pnpm --filter @agentwiki/client build
git diff --check
```

Expected: ESLint exits 0, all Vitest tests pass, TypeScript/Vite build exits 0, and `git diff --check` prints nothing.

- [ ] **Step 2: Check the live desktop guide with the browser plugin**

Open `http://localhost:5173/guide`, inspect Steps 4–6, and capture each visible state. Confirm:

```text
No stretched or compressed image
No blank image
No complete agk_ credential
OpenCode text remains readable
Published page title is readable
Activity entries are readable
```

- [ ] **Step 3: Check the responsive guide**

Use the browser viewport capability at `390x844`, reload `/guide`, and inspect Steps 4–6. Confirm that cards, captions, and images stay within the viewport and proportional cropping does not hide the primary result.

- [ ] **Step 4: Re-run focused verification after any visual adjustment**

```bash
pnpm --filter @agentwiki/client test -- UsageGuide.spec.tsx
pnpm --filter @agentwiki/client lint
pnpm --filter @agentwiki/client build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit final visual adjustments and push**

```bash
git add apps/client/src/features/about/UsageGuide.tsx \
  apps/client/src/features/about/UsageGuide.spec.tsx \
  apps/client/public/screenshots/
git commit -m "fix: polish OpenCode guide evidence layout"
git push origin master
```

Expected: `origin/master` advances to the final local commit and `git status --short` is empty.
