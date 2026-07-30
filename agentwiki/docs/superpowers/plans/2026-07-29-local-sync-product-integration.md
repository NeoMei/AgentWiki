# Local Sync Product Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give users a simple AgentWiki UI for generating the local-sync instruction, explain the workflow with real screenshots, and verify the complete install → scan → preview → confirm → review/publish loop.

**Architecture:** Add one focused card to the existing Agent detail access page rather than redesigning Agent management. Keep the guide product-oriented and capture screenshots only from the real running system after the end-to-end path succeeds.

**Tech Stack:** React 18, Vite 5, Tailwind CSS, Vitest/Testing Library, Playwright 1.61, existing Nest API, the packaged `@agentwiki/local-sync` CLI.

## Global Constraints

- Chinese and English copy must ship together through the existing language context.
- The normal Agent credential UI remains available; local sync enrollment is an additional simple path.
- The generated instruction contains a 10-minute one-time code, not a long-lived Agent API key.
- The UI must not advertise the npm command until `@agentwiki/local-sync@0.1.0` is actually published or a development feature flag is active.
- OpenCode is one verified example, not the only supported Agent.
- Guide images must be cropped from the real AgentWiki and real local Agent interfaces; no mockups or stretched full-screen images.
- Installation never implies permission to scan a directory, use a remote model, sync data, or auto-publish.
- Default local-sync scopes are least-privilege; auto-publish is opt-in and still constrained by Space grant/policy.
- Desktop and 390×844 mobile layouts must have no horizontal overflow.

---

## File Structure

- `apps/client/src/features/agent/LocalSyncInstallCard.tsx`: local-sync scopes, instruction generation, expiry, copy, and status UI.
- `apps/client/src/features/agent/LocalSyncInstallCard.spec.tsx`: API, secret, copy, expiry, and error tests.
- `apps/client/src/features/agent/AgentDetail.tsx`: place the focused card in the existing access page.
- `apps/client/src/i18n/messages.ts`: add paired local-sync messages.
- `apps/client/src/features/about/UsageGuide.tsx`: replace obsolete raw-key instructions with the plugin workflow and real results.
- `apps/client/src/features/about/UsageGuide.spec.tsx`: assert generic Agent wording and local-sync steps/images.
- `apps/client/public/screenshots/local-sync-*.png`: real cropped screenshots captured only after E2E success.
- `apps/client/e2e/local-sync.spec.ts`: browser coverage for generating/copying the enrollment instruction.
- `scripts/local-sync-e2e.mjs`: isolated-home CLI and real API workflow verifier.
- `scripts/local-sync-e2e.test.mjs`: deterministic argument/cleanup/loopback safety tests for the verifier.
- `README.md`: concise installation, local knowledge, security boundary, and support matrix.
- `design/OPERATIONS.md`: server variables, npm release dependency, logs, revocation, and rollback.

### Task 1: Build a simple local-sync enrollment card

**Files:**
- Create: `apps/client/src/features/agent/LocalSyncInstallCard.tsx`
- Create: `apps/client/src/features/agent/LocalSyncInstallCard.spec.tsx`
- Modify: `apps/client/src/i18n/messages.ts`

**Interfaces:**
- Consumes: `POST /agents/:agentId/local-sync-installations`.
- Produces: `<LocalSyncInstallCard agentId />`.

- [ ] **Step 1: Write failing component tests**

```tsx
it('generates a short-lived instruction without rendering a permanent key', async () => {
  api.post.mockResolvedValue({ data: {
    installationId: 'install-1',
    code: 'AW-ABCD-EFGH',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    instructions: '# 接入\nnpx -y @agentwiki/local-sync@0.1.0 connect --code AW-ABCD-EFGH',
  } });
  renderCard();
  await user.click(screen.getByRole('button', { name: '生成本地同步接入指令' }));
  expect(api.post).toHaveBeenCalledWith('/agents/agent-1/local-sync-installations', {
    pluginVersion: '0.1.0',
    scopes: ['spaces:read', 'pages:read', 'sources:read', 'sources:write', 'runs:read', 'runs:write', 'review:read'],
  });
  expect(screen.getByText(/@agentwiki\/local-sync@0.1.0/)).toBeInTheDocument();
  expect(screen.queryByText(/agk_/)).not.toBeInTheDocument();
});

it('adds auto-publish only when the user opts in', async () => {
  renderCard();
  await user.click(screen.getByRole('checkbox', { name: '允许符合空间策略时直接发布' }));
  await user.click(screen.getByRole('button', { name: '生成本地同步接入指令' }));
  expect(api.post.mock.calls[0][1].scopes).toContain('review:auto-publish');
});

it('copies the complete instruction and shows expiration', async () => {
  renderCard();
  await generate();
  await user.click(screen.getByRole('button', { name: '复制接入指令' }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('AW-ABCD-EFGH'));
  expect(screen.getByText(/10 分钟/)).toBeInTheDocument();
});
```

Also test: button disabled while generating; stable server error shown; expired instruction becomes disabled and offers regeneration; unmount clears the countdown timer; English renders equivalent accessible names.

- [ ] **Step 2: Run the test and observe failure**

```bash
pnpm --filter @agentwiki/client test -- src/features/agent/LocalSyncInstallCard.spec.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Add paired i18n messages**

Add these keys in both languages:

```ts
'agent.localSync.title'
'agent.localSync.description'
'agent.localSync.generate'
'agent.localSync.generating'
'agent.localSync.copy'
'agent.localSync.copied'
'agent.localSync.expiresIn'
'agent.localSync.expired'
'agent.localSync.regenerate'
'agent.localSync.autoPublish'
'agent.localSync.autoPublishHelp'
'agent.localSync.installOnly'
'agent.localSync.failed'
```

Chinese core copy:

```text
本地知识同步
生成一段接入指令，交给 Codex、Claude Code、OpenCode 等本地 Agent。安装完成后不会自动扫描或上传。
允许符合空间策略时直接发布
安装只建立连接；扫描目录、调用远程模型和同步内容仍会分别询问。
```

- [ ] **Step 4: Implement the card**

```tsx
const BASE_SCOPES = [
  'spaces:read', 'pages:read', 'sources:read', 'sources:write',
  'runs:read', 'runs:write', 'review:read',
];
const LOCAL_SYNC_VERSION = '0.1.0';

export const LocalSyncInstallCard: React.FC<{ agentId: string }> = ({ agentId }) => {
  const { t } = useLanguage();
  const [autoPublish, setAutoPublish] = useState(false);
  const [result, setResult] = useState<{
    installationId: string;
    expiresAt: string;
    instructions: string;
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!result) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [result]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const scopes = autoPublish ? [...BASE_SCOPES, 'review:auto-publish'] : BASE_SCOPES;
      const response = await api.post(`/agents/${agentId}/local-sync-installations`, {
        pluginVersion: LOCAL_SYNC_VERSION,
        scopes,
      });
      setResult(response.data);
      setCopied(false);
      setNow(Date.now());
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || t('agent.localSync.failed'));
    } finally {
      setGenerating(false);
    }
  };

  const remainingSeconds = result ? Math.max(0, Math.ceil((Date.parse(result.expiresAt) - now) / 1_000)) : 0;
  const expired = result ? remainingSeconds === 0 : false;
  const remaining = `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`;
  return (
    <section className="border rounded-[14px] bg-white p-5">
      <h2 className="font-semibold flex items-center gap-2">
        <PlugZap size={18} /> {t('agent.localSync.title')}
      </h2>
      <p className="mt-2 text-sm text-gray-500">{t('agent.localSync.description')}</p>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={autoPublish} onChange={(event) => setAutoPublish(event.target.checked)} />
        <span>{t('agent.localSync.autoPublish')}</span>
      </label>
      {error ? <p role="alert" className="mt-3 text-sm text-red-600">{error}</p> : null}
      {result ? (
        <div className="mt-4">
          <p className="text-xs text-gray-500">
            {expired ? t('agent.localSync.expired') : t('agent.localSync.expiresIn', { remaining })}
          </p>
          <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-gray-50 p-3 text-xs">
            {result.instructions}
          </pre>
          <div className="mt-3 flex gap-2">
            <button
              disabled={expired}
              onClick={() => {
                void navigator.clipboard.writeText(result.instructions);
                setCopied(true);
              }}
            >
              {copied ? t('agent.localSync.copied') : t('agent.localSync.copy')}
            </button>
            <button onClick={() => void generate()}>{t('agent.localSync.regenerate')}</button>
          </div>
        </div>
      ) : (
        <button
          disabled={generating}
          onClick={() => void generate()}
          className="mt-4 h-9 rounded-lg bg-blue-600 px-4 text-sm text-white disabled:opacity-50"
        >
          {generating ? t('agent.localSync.generating') : t('agent.localSync.generate')}
        </button>
      )}
      <p className="mt-3 text-xs text-gray-500">{t('agent.localSync.installOnly')}</p>
    </section>
  );
};
```

Use one compact white card with a `PlugZap` icon, one opt-in checkbox, and one primary button. After generation, replace the button area with the expiry label, copy button, monospaced wrapping instruction, and regenerate action. Do not expose editable server/version/code fields.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @agentwiki/client test -- src/features/agent/LocalSyncInstallCard.spec.tsx
git add apps/client/src/features/agent/LocalSyncInstallCard.tsx apps/client/src/features/agent/LocalSyncInstallCard.spec.tsx apps/client/src/i18n/messages.ts
git commit -m "feat: add local sync enrollment card"
```

Expected: PASS and commit succeeds.

### Task 2: Integrate enrollment into Agent detail without disturbing credential management

**Files:**
- Modify: `apps/client/src/features/agent/AgentDetail.tsx`
- Create: `apps/client/src/features/agent/AgentDetail.spec.tsx`

**Interfaces:**
- Consumes: `LocalSyncInstallCard` from Task 1.
- Preserves: existing grants, credentials, activity, memory, and settings flows.

- [ ] **Step 1: Write a failing placement/regression test**

Mock the three initial GET requests and render `/agents/agent-1`. Assert:

```tsx
await user.click(screen.getByRole('button', { name: '访问权限' }));
expect(screen.getByRole('heading', { name: '本地知识同步' })).toBeInTheDocument();
expect(screen.getByRole('heading', { name: '空间访问权限' })).toBeInTheDocument();
expect(screen.getByRole('heading', { name: '凭据' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: '创建凭据' })).toBeInTheDocument();
```

Assert the local-sync card appears after Space grants and before low-level credential creation so the recommended path is visible without removing advanced control.

- [ ] **Step 2: Run the test and observe failure**

```bash
pnpm --filter @agentwiki/client test -- src/features/agent/AgentDetail.spec.tsx
```

Expected: FAIL because the card is not rendered.

- [ ] **Step 3: Integrate the component**

```tsx
import { LocalSyncInstallCard } from './LocalSyncInstallCard';

// inside tab === 'access', after the Space access section:
<LocalSyncInstallCard agentId={agent.id} />
```

Do not add another tab. Keep one access page with three vertically ordered cards: Space access → Local knowledge sync → Credentials.

- [ ] **Step 4: Run Agent tests and commit**

```bash
pnpm --filter @agentwiki/client test -- src/features/agent/AgentDetail.spec.tsx src/features/agent/LocalSyncInstallCard.spec.tsx src/features/agent/connectInstructions.spec.ts
git add apps/client/src/features/agent/AgentDetail.tsx apps/client/src/features/agent/AgentDetail.spec.tsx
git commit -m "feat: expose local sync from Agent access"
```

Expected: PASS and the legacy generic MCP instruction tests remain green.

### Task 3: Rewrite the guide around the actual plugin workflow

**Files:**
- Modify: `apps/client/src/features/about/UsageGuide.tsx`
- Modify: `apps/client/src/features/about/UsageGuide.spec.tsx`
- Add later in Task 5: `apps/client/public/screenshots/local-sync-install.png`
- Add later in Task 5: `apps/client/public/screenshots/local-sync-doctor.png`
- Add later in Task 5: `apps/client/public/screenshots/local-sync-preview.png`
- Add later in Task 5: `apps/client/public/screenshots/local-sync-published-page.png`

**Interfaces:**
- Consumes: real product flow and screenshots.
- Produces: a short generic Agent guide with OpenCode as one demonstration.

- [ ] **Step 1: Update the guide test first**

Replace obsolete assertions about exposing a permanent Key with:

```tsx
expect(screen.getByRole('heading', { name: '生成本地同步接入指令' })).toBeInTheDocument();
expect(screen.getByText(/10 分钟有效的一次性安装码/)).toBeInTheDocument();
expect(screen.getByRole('heading', { name: '本地 Agent 自动安装并自检' })).toBeInTheDocument();
expect(screen.getByText(/Codex、Claude Code、OpenCode/)).toBeInTheDocument();
expect(screen.getByRole('heading', { name: '扫描、预览并确认同步' })).toBeInTheDocument();
expect(screen.getByText(/是否同步到 AgentWiki/)).toBeInTheDocument();
expect(screen.getByRole('img', { name: '本地同步接入指令' }))
  .toHaveAttribute('src', '/screenshots/local-sync-install.png');
```

Keep the existing global navigation assertions.

- [ ] **Step 2: Run the guide test and observe failure**

```bash
pnpm --filter @agentwiki/client test -- src/features/about/UsageGuide.spec.tsx
```

Expected: FAIL because the old six-step raw credential flow is still rendered.

- [ ] **Step 3: Replace the Agent connection section with four steps**

The visible flow is exactly:

1. Create an Agent and grant it one or more Spaces.
2. On Agent detail, generate the local-sync instruction; explain 10-minute single use and no permanent key in the prompt.
3. Paste the instruction to any capable local Agent; show `doctor` result and explain OpenCode is the screenshot example only.
4. Ask the Agent to scan a code/document directory; show provider disclosure, local diff, the explicit “是否同步到 AgentWiki？” question, and published/review result.

Remove script-heavy content, raw bearer headers, client-specific configuration syntax, and repeated permission details. Keep one compact permission explanation linking to Agent access settings.

- [ ] **Step 4: Keep screenshot boxes aspect-safe before real files arrive**

Use `object-contain`, fixed responsive heights, and meaningful alt text. Do not create placeholder images. During implementation the browser may show missing files until Task 5 captures real screenshots; do not commit the guide change until Task 5 supplies the images in the same branch.

- [ ] **Step 5: Run the guide test**

```bash
pnpm --filter @agentwiki/client test -- src/features/about/UsageGuide.spec.tsx
```

Expected: PASS after real screenshot filenames exist.

### Task 4: Add deterministic browser and CLI end-to-end harnesses

**Files:**
- Create: `apps/client/e2e/local-sync.spec.ts`
- Create: `scripts/local-sync-e2e.mjs`
- Create: `scripts/local-sync-e2e.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `pnpm test:e2e:local-sync` guarded by loopback-only and explicit opt-in.
- Consumes: running local AgentWiki, built plugin package, PostgreSQL, and Redis.

- [ ] **Step 1: Write safety tests for the Node verifier**

```js
test('rejects non-loopback AgentWiki targets', () => {
  assert.throws(() => assertLoopbackUrl('https://agentwiki.example/api'), /loopback/);
});

test('requires explicit destructive-test opt-in', () => {
  assert.throws(() => requireOptIn({}), /AGENTWIKI_LOCAL_SYNC_E2E=1/);
});

test('redacts agent credentials from output', () => {
  assert.equal(redact('failed agk_secret-value'), 'failed [REDACTED]');
});
```

- [ ] **Step 2: Implement browser UI coverage**

The Playwright test logs in, opens an Agent access page, generates the instruction, verifies it contains `@agentwiki/local-sync@0.1.0` and `AW-`, verifies it does not contain `agk_`, copies it, and verifies the expiry label. Use API setup/cleanup for the temporary Agent and Space.

- [ ] **Step 3: Implement the isolated-home CLI verifier**

The Node script must:

1. require `AGENTWIKI_LOCAL_SYNC_E2E=1`;
2. reject non-loopback `AGENTWIKI_API_URL`;
3. register a temporary human, Space, Agent, editor grant, and installation code through real APIs;
4. create a temporary HOME and run the packed `agentwiki-local-sync connect` command;
5. verify local config, mode `0600`, Skill, MCP registration, and `doctor`;
6. run a prepared deterministic two-page OKF upload path and verify preview-before-upload;
7. confirm sync, poll the real Run, inspect pending review, publish as the human, and verify Page/Relation/Evidence;
8. repeat unchanged content and assert `noop`;
9. revoke the credential and assert 401;
10. delete temporary server data and local temp directories in `finally`.

Use `execFile` arrays and native `fetch`; do not print request bodies containing secrets.

- [ ] **Step 4: Add the guarded script**

```json
{
  "scripts": {
    "test:e2e:local-sync": "node scripts/local-sync-e2e.mjs"
  }
}
```

- [ ] **Step 5: Run deterministic tests**

```bash
node --test scripts/local-sync-e2e.test.mjs
pnpm --filter @agentwiki/client exec playwright test e2e/local-sync.spec.ts
```

Expected: safety tests pass; browser test passes against the local stack; no persistent test data remains.

- [ ] **Step 6: Commit harnesses**

```bash
git add apps/client/e2e/local-sync.spec.ts scripts/local-sync-e2e.mjs scripts/local-sync-e2e.test.mjs package.json
git commit -m "test: cover local sync product flow"
```

### Task 5: Run real OpenWiki/MarkItDown synchronization and capture real screenshots

**Files:**
- Create: `apps/client/public/screenshots/local-sync-install.png`
- Create: `apps/client/public/screenshots/local-sync-doctor.png`
- Create: `apps/client/public/screenshots/local-sync-preview.png`
- Create: `apps/client/public/screenshots/local-sync-published-page.png`
- Modify: `apps/client/src/features/about/UsageGuide.tsx`
- Modify: `apps/client/src/features/about/UsageGuide.spec.tsx`

**Interfaces:**
- Consumes: real local plugin, OpenWiki, MarkItDown, browser, and AgentWiki.
- Produces: evidence that the advertised workflow actually ran.

- [ ] **Step 1: Verify dependencies without installing them**

```bash
openwiki --version
markitdown --version
codex --version
claude --version
opencode --version
```

Expected: versions are reported. Missing OpenWiki or MarkItDown is reported to the user with the exact install option; do not install silently.

- [ ] **Step 2: Inspect and disclose OpenWiki provider**

Run plugin `inspect` against the fixture source. If it reports a non-loopback provider, show the provider, model, source types, and data boundary to the user and obtain explicit consent before continuing. This confirmation is required during execution and cannot be assumed from approval of this implementation plan.

- [ ] **Step 3: Create a real mixed fixture**

Use a temporary directory containing:

- a small TypeScript repository with two linked modules;
- one Markdown and one TXT document;
- one generated PDF and one DOCX fixture containing non-sensitive text.

Do not use the AgentWiki repository itself, private user documents, or secrets.

- [ ] **Step 4: Run the real local Agent flow**

Use OpenCode for the screenshot demonstration and repeat the connection/doctor checks with Codex and Claude Code. In OpenCode:

1. paste the generated AgentWiki instruction;
2. let OpenCode run `connect` and report `doctor`;
3. ask it to scan the fixture and use codebase-memory for the TypeScript structure;
4. allow the already-disclosed OpenWiki model boundary;
5. capture the preview before answering the sync question;
6. answer yes;
7. verify Run/review/publish and page provenance in AgentWiki.

Expected: MarkItDown converts PDF/DOCX, OpenWiki emits OKF, codebase-memory summary is present, no Source/Run exists before sync confirmation, and final AgentWiki pages have evidence and internal relations.

- [ ] **Step 5: Capture cropped screenshots with the browser tool**

Capture only these real functional regions at native aspect ratio:

1. AgentWiki enrollment card with generated instruction and expiry.
2. OpenCode terminal result showing connection and masked `doctor` status.
3. OpenCode preview and explicit sync question.
4. AgentWiki published page showing Source/Run/Agent provenance.

Do not capture full desktop, browser chrome, unrelated user data, keys, emails, absolute paths, or distorted resized windows. Save PNGs under the exact filenames listed above.

- [ ] **Step 6: Finish and test the guide**

```bash
pnpm --filter @agentwiki/client test -- src/features/about/UsageGuide.spec.tsx
pnpm --filter @agentwiki/client build
```

Expected: PASS, all four images load, and browser console has no image/decode/layout errors.

- [ ] **Step 7: Commit guide and real screenshots together**

```bash
git add apps/client/src/features/about/UsageGuide.tsx apps/client/src/features/about/UsageGuide.spec.tsx apps/client/public/screenshots/local-sync-install.png apps/client/public/screenshots/local-sync-doctor.png apps/client/public/screenshots/local-sync-preview.png apps/client/public/screenshots/local-sync-published-page.png
git commit -m "docs: show verified local knowledge sync flow"
```

### Task 6: Update product documentation and run final release gates

**Files:**
- Modify: `README.md`
- Modify: `design/OPERATIONS.md`
- Modify: `.codex-memory/current.md`
- Modify: `.codex-memory/tasks/active/local-knowledge-sync/brief.md`
- Modify: `.codex-memory/tasks/active/local-knowledge-sync/refs.md`
- Move when complete: `.codex-memory/tasks/active/local-knowledge-sync/` to `.codex-memory/tasks/archive/local-knowledge-sync/`
- Modify: `.codex-memory/tasks/index.md`

**Interfaces:**
- Consumes the complete server, plugin, UI, and E2E implementation.
- Produces release-ready documentation and project handoff.

- [ ] **Step 1: Update README**

Add concise sections:

- what AgentWiki is: a shared brain for multiple Agents;
- generate an Agent and Space permission;
- generate/copy the local-sync instruction;
- inspect → prepare → preview → explicit confirm → review/publish;
- supported local source types;
- local versus remote model data boundaries;
- npm package exact version and source/release link;
- revocation and uninstall.

Do not include raw keys, mock screenshots, or commands for an unpublished version.

- [ ] **Step 2: Update operations documentation**

Document `PUBLIC_API_URL`, `LOCAL_SYNC_PACKAGE_VERSION`, Redis TTL/GETDEL dependency, npm release ordering, credential revocation, local-sync audit fields, 10 MiB upload limit, migration/rollback, and what to inspect in systemd logs without logging secrets.

- [ ] **Step 3: Run complete automated gates**

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm lint
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Run real functional gates repeatedly**

Run the guarded local-sync E2E once for each Agent adapter, then one additional full OpenCode scan/sync cycle. Repeat after every bug fix. Stop when:

- all adapters install and uninstall cleanly;
- expired/reused codes fail safely;
- provider and sync confirmations are separate;
- reject/no-op paths create no extra server data;
- review and scoped auto-publish both behave according to policy;
- desktop/mobile guide and Agent detail have no overflow, distortion, console errors, or broken images;
- credentials are absent from process arguments, config, screenshots, logs, Git diff, and package tarball.

- [ ] **Step 5: Scan the release diff for secrets and accidental artifacts**

```bash
git diff --cached --check
git diff --cached --name-only
rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!*.png' '(agk_|awk_|BEGIN .*PRIVATE KEY|OPENAI_API_KEY=.+|ANTHROPIC_API_KEY=.+)' .
npm pack --dry-run --workspace packages/local-sync
```

Expected: no live credential or private key; only intentional placeholder names in tests/docs; package file list is minimal.

- [ ] **Step 6: Archive the task memory and commit**

Update current state with exact test counts and verified client/tool versions, move the active task directory to archive, update the task index, then:

```bash
git add README.md design/OPERATIONS.md .codex-memory
git commit -m "docs: complete local knowledge sync rollout"
```

- [ ] **Step 7: Publish project changes only with explicit authorization**

```bash
git status --short --branch
git log --oneline --decorate -12
git push origin master
```

Expected: clean `master`, remote contains all reviewed commits. npm publish, Git tag/Release, deployment, and Git push are external mutations and each must have the user's explicit authorization at execution time.
