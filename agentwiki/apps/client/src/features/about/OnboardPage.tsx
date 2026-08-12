import React, { useState } from 'react';
import { Check, CheckCircle2, Copy, ScanSearch, ShieldCheck, Terminal } from 'lucide-react';
import { GlobalNavigation } from '../../components/GlobalNavigation';
import { useLanguage } from '../../context/LanguageContext';

const ONBOARD_COMMAND = 'npx --yes @neomei/agentwiki-local-sync@0.3.5 onboard --server https://agentwiki.quukk.com/api --protocol ndjson';

export const OnboardPage: React.FC = () => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const copyCommand = async () => {
    setCopyFailed(false);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(ONBOARD_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  };

  const steps = zh ? [
    ['在浏览器中登录或注册并授权', '命令会打开安全授权页；网页不会展示 Agent 密钥。'],
    ['确认 Agent、Space、权限和本地扫描计划', '在本地 Agent 中按结构化提示填空确认，不必手写配置文件。'],
    ['预览整理后的知识并确认同步', '原始代码和文档留在本机，只有你确认的知识内容会同步。'],
  ] : [
    ['Authorize in your browser', 'Sign in or register on the secure authorization page. Agent credentials are never displayed there.'],
    ['Confirm the Agent, Space, permissions, and local scan plan', 'Answer the structured prompts in your local Agent without hand-writing configuration files.'],
    ['Preview the organized knowledge and confirm sync', 'Raw code and documents stay local; only knowledge you approve is synchronized.'],
  ];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <GlobalNavigation density="public" />
      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <header className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
            <ShieldCheck size={14} /> AgentWiki 0.3
          </span>
          <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
            {zh ? '让本地 Agent 帮你完成接入' : 'Let your local Agent handle onboarding'}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-gray-600">
            {zh
              ? '只运行一条命令。Codex、Claude Code、OpenCode 只是示例，任何支持 MCP 的 Agent 都可以使用同一流程。'
              : 'Run one command. Codex, Claude Code, and OpenCode are examples—the same flow works with any MCP-compatible Agent.'}
          </p>
        </header>

        <section className="mt-10 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-800">
            <Terminal size={18} className="text-blue-600" />
            {zh ? '在本地终端运行' : 'Run in your local terminal'}
          </div>
          <div className="flex flex-col gap-3 rounded-xl bg-gray-950 p-4 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-sm text-green-300">{ONBOARD_COMMAND}</code>
            <button
              type="button"
              onClick={copyCommand}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 hover:bg-gray-700"
            >
              {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
              {copied ? (zh ? '已复制' : 'Copied') : (zh ? '复制' : 'Copy')}
            </button>
          </div>
          <p className="mt-3 text-xs leading-5 text-gray-500">
            {zh
              ? '它会安装一个名为 agentwiki 的 Gateway MCP，统一处理远程 Wiki、本地扫描和知识同步。'
              : 'It installs one Gateway MCP named agentwiki for remote Wiki actions, local scans, and knowledge sync.'}
          </p>
          {copyFailed ? (
            <p role="alert" className="mt-2 text-xs leading-5 text-red-600">
              {zh
                ? '浏览器未允许复制，请选中上方命令后手动复制。'
                : 'Clipboard access was blocked. Select the command above and copy it manually.'}
            </p>
          ) : null}
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          {steps.map(([title, description], index) => (
            <article key={title} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">{index + 1}</div>
              <h2 className="font-semibold leading-6">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-gray-500">{description}</p>
            </article>
          ))}
        </section>

        <section className="mt-6 rounded-2xl border border-blue-100 bg-blue-50 p-5 sm:flex sm:items-start sm:gap-4">
          <ScanSearch className="mb-3 shrink-0 text-blue-600 sm:mb-0" size={24} />
          <div>
            <h2 className="font-semibold text-blue-950">{zh ? '三次确认，其余自动完成' : 'Three confirmations; everything else is automatic'}</h2>
            <p className="mt-1 text-sm leading-6 text-blue-800">
              {zh
                ? '安装连接、创建独立 Agent、配置 MCP、首次扫描与同步由本地流程串联完成；同一账号以后仍可再次运行，为另一个本地 Agent 建立独立接入。'
                : 'The local flow connects the account, creates an independent Agent, configures MCP, and runs the first scan and sync. Run it again later to connect another independent Agent under the same account.'}
            </p>
            <div className="mt-3 flex items-center gap-2 text-xs font-medium text-blue-700"><CheckCircle2 size={15} /> {zh ? '原始资料不上传' : 'Raw files never upload'}</div>
          </div>
        </section>
      </main>
    </div>
  );
};
