# AgentWiki Local Sync 使用指南 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `/guide` 页面加入经过真实流程验证的 AgentWiki Local Sync 使用说明，让用户能理解安装、扫描、预览、确认同步和审批结果。

**Architecture:** 从现有 `UsageGuide.tsx` 抽出可复用截图组件，再新增独立的 `LocalSyncGuideSection`，由 `UsageGuide` 在 Agent 接入流程和权限模型之间组合。文案沿用页面当前的 `zh` 双语模式；真实截图作为静态资源，组件测试锁定内容、链接、折叠行为和资源路径，浏览器验收负责确认真实画面、响应式和不变形。

**Tech Stack:** React 18、TypeScript、Tailwind CSS、Lucide React、Vitest、Testing Library、Vite、真实 AgentWiki + OpenCode/Codex/Claude Code 本地同步流程。

## Global Constraints

- npm 包必须写为 `@neomei/agentwiki-local-sync`，当前展示版本必须为 `0.1.0`。
- Codex、Claude Code、OpenCode 是当前已验证自动配置的客户端；其他 stdio MCP 客户端只说明协议兼容，不承诺已经验证一键安装。
- 安装不会自动扫描或上传；远程模型调用和同步必须分别取得明确同意。
- 本地 Agent 只能提交同步结果并报告 ChangeSet 状态，不能代替用户审批 ChangeSet。
- 只使用真实 AgentWiki 与真实本地 Agent 截图，不使用模拟图、占位图或变形的全屏图。
- 所有新增内容必须同时支持中文、英文、桌面端、移动端、键盘操作和辅助技术。
- 不把真实 API Key、一次性安装码、私人绝对路径或内部生产地址写入源码、测试快照或截图。

---

### Task 1: 抽取可复用的指南截图组件

**Files:**
- Create: `apps/client/src/features/about/GuideScreenshot.tsx`
- Modify: `apps/client/src/features/about/UsageGuide.tsx`
- Test: `apps/client/src/features/about/UsageGuide.spec.tsx`

**Interfaces:**
- Produces: `GuideScreenshot(props: { src: string; alt: string; focus?: 'top' | 'center' | 'bottom'; fit?: 'cover' | 'contain'; heightClassName?: string })`。
- Consumes: 无。

- [ ] **Step 1: 先运行现有指南测试，建立重构基线**

Run:

```bash
pnpm --filter @agentwiki/client test -- UsageGuide.spec.tsx
```

Expected: `UsageGuide.spec.tsx` PASS，现有 Agent 接入截图断言全部通过。

- [ ] **Step 2: 创建截图组件**

Create `apps/client/src/features/about/GuideScreenshot.tsx`:

```tsx
import React from 'react';

type ScreenshotFocus = 'top' | 'center' | 'bottom';
type ScreenshotFit = 'cover' | 'contain';

const screenshotFocusClass: Record<ScreenshotFocus, string> = {
  top: 'object-top',
  center: 'object-center',
  bottom: 'object-bottom',
};

const screenshotFitClass: Record<ScreenshotFit, string> = {
  cover: 'object-cover',
  contain: 'object-contain',
};

export const GuideScreenshot: React.FC<{
  src: string;
  alt: string;
  focus?: ScreenshotFocus;
  fit?: ScreenshotFit;
  heightClassName?: string;
}> = ({ src, alt, focus = 'center', fit = 'cover', heightClassName = 'h-56 sm:h-72' }) => (
  <div className={`${heightClassName} overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm`}>
    <img
      src={src}
      alt={alt}
      className={`h-full w-full ${screenshotFitClass[fit]} ${screenshotFocusClass[focus]}`}
      loading="lazy"
    />
  </div>
);
```

- [ ] **Step 3: 让 UsageGuide 使用新组件**

在 `UsageGuide.tsx` 中删除本地的 `ScreenshotFocus`、`ScreenshotFit`、两个 class map 和 `GuideScreenshot` 定义，并加入：

```tsx
import { GuideScreenshot } from './GuideScreenshot';
```

不改变任何现有截图的 `src`、`alt`、`focus`、`fit` 或高度参数。

- [ ] **Step 4: 运行指南测试和类型检查**

Run:

```bash
pnpm --filter @agentwiki/client test -- UsageGuide.spec.tsx
pnpm --filter @agentwiki/client exec tsc --noEmit
```

Expected: 两条命令均退出码 `0`，现有截图断言不回归。

- [ ] **Step 5: 提交重构**

```bash
git add apps/client/src/features/about/GuideScreenshot.tsx apps/client/src/features/about/UsageGuide.tsx apps/client/src/features/about/UsageGuide.spec.tsx
git commit -m "refactor: share usage guide screenshot component"
```

---

### Task 2: 用测试驱动实现本地同步指南章节

**Files:**
- Create: `apps/client/src/features/about/LocalSyncGuideSection.tsx`
- Create: `apps/client/src/features/about/LocalSyncGuideSection.spec.tsx`

**Interfaces:**
- Consumes: `GuideScreenshot` from `./GuideScreenshot`；prop `zh: boolean`。
- Produces: `LocalSyncGuideSection({ zh }: { zh: boolean })`；导出常量 `LOCAL_SYNC_PACKAGE_URL` 供测试断言。

- [ ] **Step 1: 写失败的中文内容、链接和折叠测试**

Create `apps/client/src/features/about/LocalSyncGuideSection.spec.tsx`:

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LocalSyncGuideSection, LOCAL_SYNC_PACKAGE_URL } from './LocalSyncGuideSection';

describe('LocalSyncGuideSection', () => {
  it('shows the verified Chinese workflow and safe defaults', () => {
    render(<LocalSyncGuideSection zh />);

    expect(screen.getByRole('heading', { name: '从本地知识创建 Wiki' })).toBeInTheDocument();
    expect(screen.getByText('@neomei/agentwiki-local-sync')).toBeInTheDocument();
    expect(screen.getByText('版本 0.1.0')).toBeInTheDocument();
    expect(screen.getByText(/Codex、Claude Code、OpenCode/)).toBeInTheDocument();
    expect(screen.getByText(/其他兼容 stdio MCP/)).toBeInTheDocument();
    expect(screen.getByText(/安装只建立连接，不会自动扫描或上传/)).toBeInTheDocument();
    expect(screen.getByText(/是否同步到 AgentWiki/)).toBeInTheDocument();

    const npm = screen.getByRole('link', { name: '在 npm 上查看' });
    expect(npm).toHaveAttribute('href', LOCAL_SYNC_PACKAGE_URL);
    expect(npm).toHaveAttribute('target', '_blank');
    expect(npm).toHaveAttribute('rel', 'noopener noreferrer');

    const advanced = screen.getByText('高级命令').closest('details');
    expect(advanced).not.toHaveAttribute('open');
    fireEvent.click(within(advanced as HTMLElement).getByText('高级命令'));
    expect(advanced).toHaveAttribute('open');
    for (const command of ['doctor', 'inspect', 'scan', 'preview', 'sync --confirm', 'upgrade', 'uninstall']) {
      expect(within(advanced as HTMLElement).getByText(command)).toBeInTheDocument();
    }
  });

  it('renders English copy and real screenshot paths', () => {
    render(<LocalSyncGuideSection zh={false} />);

    expect(screen.getByRole('heading', { name: 'Create a Wiki from Local Knowledge' })).toBeInTheDocument();
    expect(screen.getByText(/Installation only establishes the connection/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Generated AgentWiki Local Sync instructions' }))
      .toHaveAttribute('src', '/screenshots/local-sync-installation.png');
    expect(screen.getByRole('img', { name: 'Local Agent knowledge preview awaiting confirmation' }))
      .toHaveAttribute('src', '/screenshots/local-sync-agent-preview.png');
    expect(screen.getByRole('img', { name: 'Local Agent sync completion result' }))
      .toHaveAttribute('src', '/screenshots/local-sync-agent-success.png');
    expect(screen.getByRole('img', { name: 'AgentWiki page published from local knowledge' }))
      .toHaveAttribute('src', '/screenshots/local-sync-published-page.png');
  });
});
```

- [ ] **Step 2: 运行测试并确认因组件缺失而失败**

Run:

```bash
pnpm --filter @agentwiki/client test -- LocalSyncGuideSection.spec.tsx
```

Expected: FAIL，错误包含 `Cannot find module './LocalSyncGuideSection'`。

- [ ] **Step 3: 实现组件的常量、步骤数据和命令数据**

Create `apps/client/src/features/about/LocalSyncGuideSection.tsx` with these exact exports and data before the JSX:

```tsx
import React from 'react';
import { ExternalLink, FolderSearch, PackageCheck, ShieldCheck } from 'lucide-react';
import { GuideScreenshot } from './GuideScreenshot';

const LOCAL_SYNC_VERSION = '0.1.0';
export const LOCAL_SYNC_PACKAGE_URL = `https://www.npmjs.com/package/@neomei/agentwiki-local-sync/v/${LOCAL_SYNC_VERSION}`;

const commands = [
  ['doctor', '检查安装、依赖、身份和权限', 'Check installation, dependencies, identity, and permissions'],
  ['inspect', '仅在本地检查目录', 'Inspect a directory locally'],
  ['scan', '生成本地知识预览，不上传', 'Create a local preview without uploading'],
  ['preview', '再次查看未过期的预览', 'Review a non-expired preview'],
  ['sync --confirm', '明确确认后同步预览', 'Sync a preview after explicit confirmation'],
  ['upgrade', '升级指定连接的精确版本', 'Upgrade one connection to an exact version'],
  ['uninstall', '移除本地 Agent 的 MCP 连接', 'Remove the local Agent MCP connection'],
] as const;

interface LocalSyncGuideSectionProps {
  zh: boolean;
}
```

- [ ] **Step 4: 实现插件概览和四步主流程**

Continue the same file with a single exported component. Keep every screenshot on `fit="contain"` so its original aspect ratio is preserved:

```tsx
export const LocalSyncGuideSection: React.FC<LocalSyncGuideSectionProps> = ({ zh }) => (
  <section className="mb-16" aria-labelledby="local-sync-guide-title">
    <h2 id="local-sync-guide-title" className="mb-8 flex items-center gap-2 text-2xl font-bold text-gray-900">
      <FolderSearch className="text-indigo-600" size={24} />
      {zh ? '从本地知识创建 Wiki' : 'Create a Wiki from Local Knowledge'}
    </h2>

    <div className="rounded-xl border border-indigo-200 bg-white p-5 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <PackageCheck size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900">AgentWiki Local Sync</h3>
          <p className="break-all font-mono text-sm text-indigo-700">@neomei/agentwiki-local-sync</p>
          <p className="mt-1 text-xs text-gray-500">{zh ? '版本 0.1.0' : 'Version 0.1.0'}</p>
        </div>
        <a
          href={LOCAL_SYNC_PACKAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          <ExternalLink size={15} />
          {zh ? '在 npm 上查看' : 'View on npm'}
        </a>
      </div>
      <p className="mt-4 text-sm leading-6 text-gray-600">
        {zh
          ? '已验证自动配置 Codex、Claude Code、OpenCode；底层使用标准 stdio MCP，其他兼容 stdio MCP 的本地 Agent 可按自身配置方式接入。'
          : 'Automatic setup is verified for Codex, Claude Code, and OpenCode. It uses standard stdio MCP underneath, so other compatible local Agents can connect through their own configuration.'}
      </p>
    </div>

    <ol className="mt-8 space-y-8">
      <li className="rounded-xl border border-gray-200 bg-white p-5 sm:p-8">
        <div className="mb-5 flex items-start gap-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 font-bold text-white">1</span>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{zh ? '生成一次性接入指令' : 'Generate one-time connection instructions'}</h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              {zh ? '在 Agent 详情页生成完整指令，再整段复制。指令绑定固定服务地址、精确插件版本和十分钟有效的一次性安装码。' : 'Generate and copy the complete instruction from the Agent detail page. It binds the server address, exact plugin version, and a one-time installation code valid for ten minutes.'}
            </p>
          </div>
        </div>
        <GuideScreenshot src="/screenshots/local-sync-installation.png" alt={zh ? 'AgentWiki 生成的 Local Sync 接入指令' : 'Generated AgentWiki Local Sync instructions'} fit="contain" heightClassName="h-48 sm:h-64" />
      </li>

      <li className="rounded-xl border border-gray-200 bg-white p-5 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-600 font-bold text-white">2</span>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{zh ? '交给本地 Agent 完成安装' : 'Let the local Agent complete setup'}</h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              {zh ? '把整段指令作为一条消息交给本地 Agent。Agent 会安装插件、注册 MCP、运行 doctor，并明确报告身份和权限检查是否成功。以下演示可以使用 OpenCode，但流程不绑定 OpenCode。' : 'Give the complete instruction to the local Agent as one message. It installs the package, registers MCP, runs doctor, and reports whether identity and permission checks succeeded. The example may use OpenCode, but the workflow is not OpenCode-specific.'}
            </p>
          </div>
        </div>
      </li>

      <li className="rounded-xl border border-gray-200 bg-white p-5 sm:p-8">
        <div className="mb-5 flex items-start gap-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-600 font-bold text-white">3</span>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{zh ? '扫描目录并检查预览' : 'Scan a directory and inspect the preview'}</h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              {zh ? '告诉 Agent 本地目录和目标 Space。它会先检查代码、Markdown、TXT、PDF 或 DOCX，并展示新增、更新、删除、未变化、跳过文件、上传大小和模型边界。此时不会上传。' : 'Tell the Agent the local directory and target Space. It inspects code, Markdown, TXT, PDF, or DOCX and shows added, updated, deleted, unchanged, skipped files, upload size, and model boundary. Nothing is uploaded yet.'}
            </p>
          </div>
        </div>
        <GuideScreenshot src="/screenshots/local-sync-agent-preview.png" alt={zh ? '本地 Agent 等待确认的知识预览' : 'Local Agent knowledge preview awaiting confirmation'} fit="contain" heightClassName="h-56 sm:h-72" />
      </li>

      <li className="rounded-xl border border-gray-200 bg-white p-5 sm:p-8">
        <div className="mb-5 flex items-start gap-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 font-bold text-white">4</span>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{zh ? '确认同步并查看结果' : 'Confirm synchronization and inspect the result'}</h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              {zh ? 'Agent 必须询问“是否同步到 AgentWiki？”。只有你在当前对话明确同意后才会上传。Agent 会报告 Source、Run 和审核状态，但不会替你审批；最终发布方式由权限和 Space 审批策略决定。' : 'The Agent must ask whether to sync to AgentWiki. Upload starts only after your explicit confirmation in the current conversation. The Agent reports the Source, Run, and review status but never approves for you; publishing remains controlled by permissions and the Space review policy.'}
            </p>
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <GuideScreenshot src="/screenshots/local-sync-agent-success.png" alt={zh ? '本地 Agent 同步完成结果' : 'Local Agent sync completion result'} fit="contain" heightClassName="h-52 sm:h-64" />
          <GuideScreenshot src="/screenshots/local-sync-published-page.png" alt={zh ? '由本地知识发布的 AgentWiki 页面' : 'AgentWiki page published from local knowledge'} fit="contain" heightClassName="h-52 sm:h-64" />
        </div>
      </li>
    </ol>
```

- [ ] **Step 5: 实现安全边界和默认收起的高级命令**

Finish the component before its final `</section>` with:

```tsx
    <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6">
      <h3 className="flex items-center gap-2 font-semibold text-emerald-950">
        <ShieldCheck size={18} />
        {zh ? '数据与权限边界' : 'Data and permission boundaries'}
      </h3>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-emerald-900">
        <li>{zh ? '安装只建立连接，不会自动扫描或上传。' : 'Installation only establishes the connection; it never scans or uploads automatically.'}</li>
        <li>{zh ? '使用远程模型前会单独说明提供方并再次询问。' : 'Before using a remote model, the Agent discloses the provider and asks separately.'}</li>
        <li>{zh ? '同步必须基于刚刚检查过的预览，并在当前对话再次确认。' : 'Synchronization must use the preview you just inspected and requires confirmation in the current conversation.'}</li>
        <li>{zh ? '凭据保存在本机，不会写进 MCP 配置或截图。' : 'Credentials stay on the local machine and are never written into MCP configuration or screenshots.'}</li>
      </ul>
    </div>

    <details className="mt-6 rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
      <summary className="cursor-pointer select-none font-semibold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        {zh ? '高级命令' : 'Advanced commands'}
      </summary>
      <div className="mt-4 overflow-x-auto">
        <dl className="min-w-[32rem] space-y-3">
          {commands.map(([command, zhDescription, enDescription]) => (
            <div key={command} className="grid grid-cols-[9rem_1fr] gap-3 border-b border-gray-100 pb-3 last:border-0 last:pb-0">
              <dt><code className="rounded bg-gray-100 px-2 py-1 text-xs text-indigo-700">{command}</code></dt>
              <dd className="text-sm text-gray-600">{zh ? zhDescription : enDescription}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  </section>
);
```

- [ ] **Step 6: 运行测试并修正至通过**

Run:

```bash
pnpm --filter @agentwiki/client test -- LocalSyncGuideSection.spec.tsx
pnpm --filter @agentwiki/client exec tsc --noEmit
```

Expected: `2 tests passed` and TypeScript exits `0`.

- [ ] **Step 7: 提交独立章节**

```bash
git add apps/client/src/features/about/LocalSyncGuideSection.tsx apps/client/src/features/about/LocalSyncGuideSection.spec.tsx
git commit -m "feat: add local sync guide section"
```

---

### Task 3: 把新章节接入现有使用指南

**Files:**
- Modify: `apps/client/src/features/about/UsageGuide.tsx`
- Modify: `apps/client/src/features/about/UsageGuide.spec.tsx`

**Interfaces:**
- Consumes: `LocalSyncGuideSection({ zh })` from `./LocalSyncGuideSection`。
- Produces: `/guide` 在 Agent 接入流程后、权限模型前展示本地同步章节。

- [ ] **Step 1: 扩展集成测试并确认失败**

在 `UsageGuide.spec.tsx` 的中文用例末尾加入：

```tsx
expect(screen.getByRole('heading', { name: '从本地知识创建 Wiki' })).toBeInTheDocument();
expect(screen.getByRole('link', { name: '在 npm 上查看' })).toHaveAttribute(
  'href',
  'https://www.npmjs.com/package/@neomei/agentwiki-local-sync/v/0.1.0',
);
expect(screen.getByText(/安装只建立连接，不会自动扫描或上传/)).toBeInTheDocument();
```

Run:

```bash
pnpm --filter @agentwiki/client test -- UsageGuide.spec.tsx
```

Expected: FAIL，因为 `UsageGuide` 尚未渲染该章节。

- [ ] **Step 2: 在正确位置渲染新章节**

在 `UsageGuide.tsx` 加入：

```tsx
import { LocalSyncGuideSection } from './LocalSyncGuideSection';
```

在“如何接入 Agent”章节闭合标签之后、“权限模型”注释之前插入：

```tsx
<LocalSyncGuideSection zh={zh} />
```

- [ ] **Step 3: 运行相关组件测试**

Run:

```bash
pnpm --filter @agentwiki/client test -- UsageGuide.spec.tsx LocalSyncGuideSection.spec.tsx
```

Expected: 两个测试文件全部 PASS；旧 Agent 接入截图和新本地同步章节同时存在。

- [ ] **Step 4: 提交集成**

```bash
git add apps/client/src/features/about/UsageGuide.tsx apps/client/src/features/about/UsageGuide.spec.tsx
git commit -m "feat: link local sync workflow from usage guide"
```

---

### Task 4: 完成真实本地同步演示并采集截图

**Files:**
- Create: `apps/client/public/screenshots/local-sync-installation.png`
- Create: `apps/client/public/screenshots/local-sync-agent-preview.png`
- Create: `apps/client/public/screenshots/local-sync-agent-success.png`
- Create: `apps/client/public/screenshots/local-sync-published-page.png`

**Interfaces:**
- Consumes: Agent 详情页 `LocalSyncInstallCard`、本地 `agentwiki-local-sync` Skill/MCP、目标演示 Space。
- Produces: 四张无敏感信息、保持真实比例、与组件资源路径一致的 PNG。

- [ ] **Step 1: 验证本地栈和插件 E2E 基线**

在一个终端运行：

```bash
pnpm dev
```

确认前端和 API 均打印 ready 后，在另一个终端运行：

```bash
pnpm --filter @neomei/agentwiki-local-sync build
AGENTWIKI_LOCAL_SYNC_E2E=1 AGENTWIKI_API_URL=http://127.0.0.1:3000/api pnpm test:e2e:local-sync
```

Expected: 最终 JSON 包含 `"status":"passed"`、`"pages":2` 且 `relationCount` 大于 `0`。如果开发服务实际 API 端口不同，只把 `AGENTWIKI_API_URL` 改为启动日志中明确显示的 loopback API 地址。

- [ ] **Step 2: 创建不含隐私信息的真实演示数据**

在真实 AgentWiki UI 中创建：

- Space：`Local Sync Demo`，审批策略 `always-review`；
- Agent：`Local Sync Demo Agent`；
- Space Grant：编辑者，并包含 `spaces:read`、`pages:read`、`sources:read`、`sources:write`、`runs:read`、`runs:write`、`review:read`；
- 演示目录：只放公开示例代码和 Markdown，不包含 `.env`、凭据、私人路径或个人信息。

在 Agent 详情页生成 `0.1.0` 的一次性本地同步接入指令。截图前用开发者工具确认截图区域没有完整安装码或 API Key；只保留包名、版本、生成成功状态和复制入口。用浏览器截图工具保存为 `apps/client/public/screenshots/local-sync-installation.png`。

- [ ] **Step 3: 用真实本地 Agent 生成预览并截图**

把完整指令交给 OpenCode（作为示例），让它完成连接和 `doctor`。随后要求：

```text
请先检查演示目录，使用本地知识同步为 Local Sync Demo 空间生成预览。先告诉我新增、更新、删除、未变化、跳过文件、上传大小和模型边界，不要同步。
```

Expected: OpenCode 先调用检查，再调用预览；结果明确显示目标 Space、变更计数、跳过文件、上传大小与 provider boundary，并询问“是否同步到 AgentWiki？”。此时不得出现同步 Run。

用浏览器插件截取 OpenCode 中从预览摘要到确认问题的实际区域，保存为 `apps/client/public/screenshots/local-sync-agent-preview.png`；隐藏一次性安装码、凭据和私人绝对路径，不截整个屏幕。

- [ ] **Step 4: 明确确认同步并完成真人审批**

在同一 OpenCode 对话中回复：

```text
确认同步到 AgentWiki。
```

Expected: OpenCode 报告 Source、Run 和 `pending_review` ChangeSet，不自行接受条目、不审批、不发布。用浏览器插件截取该结果区域，保存为 `apps/client/public/screenshots/local-sync-agent-success.png`。

随后由登录用户在 AgentWiki 审核页接受条目、批准并发布。打开发布后的 Wiki 页面，确保页面来源可识别为该 Agent/Run，再用浏览器插件只截文章标题、正文开头和来源区域，保存为 `apps/client/public/screenshots/local-sync-published-page.png`。

- [ ] **Step 5: 检查截图文件和画面**

Run:

```bash
file apps/client/public/screenshots/local-sync-*.png
```

Expected: 四个文件均识别为 `PNG image data`，宽高均大于 `0`。

逐张用图片查看器检查：内容非空白、文字可读、无压缩拉伸、无完整 Key/安装码/私人路径/生产地址。若任一项不满足，重新从真实界面按相关区域截图，不用 CSS 或图像编辑伪造。

- [ ] **Step 6: 提交真实截图**

```bash
git add apps/client/public/screenshots/local-sync-installation.png apps/client/public/screenshots/local-sync-agent-preview.png apps/client/public/screenshots/local-sync-agent-success.png apps/client/public/screenshots/local-sync-published-page.png
git commit -m "docs: add verified local sync guide screenshots"
```

---

### Task 5: 完成双语、响应式和全量回归验收

**Files:**
- Modify if needed: `apps/client/src/features/about/LocalSyncGuideSection.tsx`
- Modify if needed: `apps/client/src/features/about/LocalSyncGuideSection.spec.tsx`
- Modify if needed: `apps/client/src/features/about/UsageGuide.spec.tsx`

**Interfaces:**
- Consumes: 完整 `/guide` 页面和四张真实截图。
- Produces: 通过自动化测试与浏览器验收的最终功能。

- [ ] **Step 1: 运行客户端测试、类型检查和 lint**

Run:

```bash
pnpm --filter @agentwiki/client test
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/client lint
```

Expected: 所有命令退出码 `0`，无失败测试和 lint error。

- [ ] **Step 2: 运行仓库级回归**

Run:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Expected: 三条命令均退出码 `0`；服务端、客户端、本地同步插件和运行时测试全部通过。

- [ ] **Step 3: 用浏览器检查中文桌面布局**

打开 `http://localhost:5173/guide`，切到中文并使用约 `1440 × 900` 视口。验证：

- 新章节位于“如何接入 Agent”之后、“权限模型”之前；
- 包名、版本、npm 链接和四步顺序正确；
- 高级命令默认收起，鼠标点击后显示七类命令；
- 四张截图非空白、未裁掉关键内容、没有被拉伸；
- npm 链接在新标签打开 `https://www.npmjs.com/package/@neomei/agentwiki-local-sync/v/0.1.0`。

- [ ] **Step 4: 用浏览器检查英文和移动布局**

切到英文，再使用约 `390 × 844` 视口。验证：

- 所有新增标题、步骤、数据边界、命令说明和图注均为英文；
- 页面没有横向溢出，长包名可换行，高级命令区域自身可横向滚动；
- Tab 聚焦到“Advanced commands”后按 Enter/Space 可展开和收起；
- 图片按容器宽度等比显示，步骤顺序仍为 1 → 4。

- [ ] **Step 5: 最终差异与敏感信息检查**

Run:

```bash
git diff --check
git status --short
rg -n "npm_[A-Za-z0-9]|agk_[A-Za-z0-9_-]+|awk_[A-Za-z0-9_-]+|AW-[A-Za-z0-9_-]+" apps/client/src/features/about apps/client/public/screenshots docs/superpowers
```

Expected: `git diff --check` 无输出；`rg` 不返回真实凭据或安装码。如果测试代码需要模式文本，只允许保留明确的假值，并在提交前人工确认不是有效秘密。

- [ ] **Step 6: 提交验收修正**

如果浏览器验收产生代码修正：

```bash
git add apps/client/src/features/about/LocalSyncGuideSection.tsx apps/client/src/features/about/LocalSyncGuideSection.spec.tsx apps/client/src/features/about/UsageGuide.spec.tsx
git commit -m "fix: polish local sync usage guide"
```

若没有产生差异，不创建空提交。最终记录 `git status --short` 应为空，并报告自动化测试、真实同步 E2E 和四种浏览器状态的结果。
