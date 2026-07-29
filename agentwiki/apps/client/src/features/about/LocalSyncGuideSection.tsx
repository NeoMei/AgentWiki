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
