# Generic Agent Connection Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the usage guide describe AgentWiki as a generic Agent integration while retaining OpenCode as the verified example.

**Architecture:** Keep the MCP protocol and generated connection prompt unchanged. Update only the bilingual guide copy and its focused component test so the primary instructions target any local Agent and the screenshots are explicitly framed as an OpenCode example.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, pnpm

## Global Constraints

- AgentWiki is not tied to OpenCode; OpenCode is only the verified demonstration client.
- Chinese and English copy must express the same meaning.
- Keep the existing real OpenCode screenshots and MCP protocol unchanged.
- Authorization remains enforced by the AgentWiki server.
- Run pnpm commands from the product root `agentwiki/`; run Git commands from the outer repository root.

---

### Task 1: Clarify the Generic Agent Flow

**Files:**
- Modify: `apps/client/src/features/about/UsageGuide.spec.tsx:19-34`
- Modify: `apps/client/src/features/about/UsageGuide.tsx:234-291`

**Interfaces:**
- Consumes: the existing `UsageGuide` component and five verified screenshot paths.
- Produces: bilingual guide copy whose primary actor is a local Agent, with OpenCode labeled as the example.

- [x] **Step 1: Write the failing semantic test**

Replace the current test title and OpenCode-only heading assertion with assertions that require both the generic workflow and the concrete example:

```tsx
it('presents a generic Agent flow with OpenCode as the verified example', () => {
  renderGuide();

  expect(screen.getByRole('heading', { name: '生成 Key 与接入指令' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '把接入指令交给本地 Agent' })).toBeInTheDocument();
  expect(screen.getByText(/Codex、Claude Code、OpenCode/)).toBeInTheDocument();
  expect(screen.getByText(/以下以 OpenCode 为例/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '确认 Agent 接入与页面发布结果' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: '已生成 Key 和接入指令' })).toHaveAttribute('src', '/screenshots/step4-generated-credential.png');
  expect(screen.getByRole('img', { name: 'OpenCode 发布页面过程' })).toHaveAttribute('src', '/screenshots/step5-opencode-publish.png');
  expect(screen.getByRole('img', { name: 'OpenCode 接入成功结果' })).toHaveAttribute('src', '/screenshots/step6-opencode-success.png');
  expect(screen.getByRole('img', { name: 'AgentWiki 已发布页面' })).toHaveAttribute('src', '/screenshots/step6-published-page.png');
  expect(screen.getByRole('img', { name: 'AgentWiki MCP 活动记录' })).toHaveAttribute('src', '/screenshots/step6-activity-log.png');
});
```

- [x] **Step 2: Run the focused test and verify the new semantics fail**

Run:

```bash
pnpm --filter @agentwiki/client test -- src/features/about/UsageGuide.spec.tsx
```

Expected: FAIL because the current heading still says `把接入指令交给 OpenCode` and the generic-client explanation is absent.

- [x] **Step 3: Update the bilingual guide copy**

Use the following meaning in Step 5:

```tsx
<h3>{zh ? '把接入指令交给本地 Agent' : 'Give the Instructions to Your Local Agent'}</h3>
<p>
  {zh
    ? '把整段接入指令作为一条消息交给本地 Agent。Codex、Claude Code、OpenCode 等 Agent 都使用同一套 AgentWiki 接入方式：由 Agent 自行配置 MCP、校验身份并调用工具。'
    : 'Give the complete connection prompt to your local Agent as one message. Agents such as Codex, Claude Code, and OpenCode use the same AgentWiki connection flow: the Agent configures MCP, verifies its identity, and calls the tools itself.'}
</p>
```

Frame the existing screenshot callout as an example:

```tsx
<strong>{zh ? '以下以 OpenCode 为例：' : 'OpenCode example: '}</strong>
```

Update Step 6 to describe the generic success criteria while keeping the OpenCode screenshot label specific:

```tsx
<h3>{zh ? '确认 Agent 接入与页面发布结果' : 'Confirm Agent Connection and Page Publishing'}</h3>
<p>
  {zh
    ? '无论使用哪种本地 Agent，接入成功都应同时看到三项结果：Agent 明确报告成功、AgentWiki 中出现正式页面、活动记录中出现对应的 MCP 工具调用。以下截图继续展示 OpenCode 的真实验证结果。'
    : 'Regardless of which local Agent you use, a successful connection has three signals: the Agent reports success, the published page appears in AgentWiki, and the activity log records the corresponding MCP tool calls. The screenshots below show the verified OpenCode example.'}
</p>
```

- [x] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @agentwiki/client test -- src/features/about/UsageGuide.spec.tsx
```

Expected: `UsageGuide.spec.tsx` passes.

- [x] **Step 5: Run the client quality gate**

Run:

```bash
pnpm --filter @agentwiki/client test
pnpm lint
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/client build
git diff --check
```

Expected: all commands exit 0 with no failed test or lint error.

- [x] **Step 6: Commit and push**

```bash
git add agentwiki/apps/client/src/features/about/UsageGuide.tsx \
  agentwiki/apps/client/src/features/about/UsageGuide.spec.tsx \
  agentwiki/docs/superpowers/plans/2026-07-28-generic-agent-connection-guide.md
git commit -m "docs: generalize Agent connection guide"
git push origin master
```

Expected: `origin/master` advances to the new commit and the working tree is clean.
