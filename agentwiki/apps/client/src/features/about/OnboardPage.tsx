import React, { useState } from 'react';
import { Bot, Check, Copy, FileCheck2, ShieldCheck } from 'lucide-react';
import { LOCAL_SYNC_VERSION } from '../../config/localSync';
import { useLanguage } from '../../context/LanguageContext';
import { buildOnboardPrompt, ONBOARD_CLIENTS, type OnboardClient } from './onboardPrompt';

export const OnboardPage: React.FC = () => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const [client, setClient] = useState<OnboardClient>('generic');
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const serverUrl = `${window.location.origin}/api`;
  const prompt = buildOnboardPrompt(zh, client, serverUrl);
  const copied = copiedPrompt === prompt;
  const copyPrompt = async () => {
    setCopyFailed(false);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(prompt);
      setCopiedPrompt(prompt);
    } catch { setCopyFailed(true); }
  };
  const steps = zh ? [
    ['准备环境', 'Agent 检查环境并启动接入。'],
    ['浏览器授权', '自动打开浏览器，在当前服务器登录并允许接入；未打开时提供链接。'],
    ['确认空间和权限', '按名称选择空间，确认账号、角色和配置位置。'],
    ['配置并允许工具', '导入或保存连接配置，在客户端允许 MCP 和工具调用。'],
    ['实际读取验证', '需要时重载或重启客户端并新建对话，再读取一篇已知页面。'],
  ] : [
    ['Prepare the environment', 'Your Agent checks the environment and starts setup.'],
    ['Authorize in your browser', 'Your browser opens automatically for sign-in and approval; a link is available if it cannot open.'],
    ['Confirm space and permissions', 'Choose a space by name and review the account, role, and configuration path.'],
    ['Configure and allow tools', 'Import or save the connection. Allow MCP and tool calls in your client.'],
    ['Verify a real page read', 'Reload or restart your client and start a new conversation when needed, then read a known page.'],
  ];
  return (
    <article className="min-w-0 text-gray-900">
      <header>
        <p className="flex items-center gap-2 text-sm text-gray-500"><Bot size={18} /> AgentWiki · {LOCAL_SYNC_VERSION}</p>
        <h1 className="mt-4 text-2xl font-semibold">{zh ? '连接你的 Agent' : 'Connect your Agent'}</h1>
        <p className="mt-3 max-w-2xl text-base leading-6 text-gray-600">{zh ? '把通用提示词交给支持本地 MCP 的 Agent，即可开始接入。Agent 会引导你授权、配置工具并验证实际读取。' : 'Give the universal prompt to any Agent with local MCP support. Your Agent guides authorization, tool setup, and a real page-read check.'}</p>
      </header>
      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6" aria-labelledby="agent-connect-title">
        <h2 id="agent-connect-title" className="text-lg font-semibold">{zh ? '复制整段提示词到你的 Agent' : 'Copy the full prompt into your Agent'}</h2>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={zh ? '选择客户端' : 'Choose a client'}>
          {ONBOARD_CLIENTS.map(item => <button key={item.id} type="button" aria-pressed={client === item.id} onClick={() => { setClient(item.id); setCopiedPrompt(null); setCopyFailed(false); }} className={`rounded-lg border px-4 py-2 text-sm font-medium ${client === item.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}>{zh && 'labelZh' in item ? item.labelZh : item.label}</button>)}
        </div>
        <p className="mt-3 text-sm leading-6 text-gray-600">{client === 'generic'
          ? (zh ? '通用方式生成标准 MCP 配置，由 Agent 导入当前客户端。已知客户端也可使用上方快捷配置。' : 'Generic setup exports standard MCP configuration for your Agent to import into this client. Known clients can also use the shortcuts above.')
          : (zh ? '将为所选客户端写入 MCP 配置。请把提示词粘贴到该客户端，之后按提示允许工具并重载。' : 'Setup writes MCP configuration for the selected client. Paste the prompt into that client, then allow tools and reload as directed.')}</p>
        <button type="button" onClick={() => void copyPrompt()} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 sm:w-auto">
          {copied ? <Check size={16} /> : <Copy size={16} />}{zh ? '复制提示词' : 'Copy prompt'}
        </button>
        {copied ? <p role="status" className="mt-2 text-sm text-gray-600">{zh ? '已复制，粘贴到所选客户端即可开始。' : 'Copied. Paste it into your selected client to begin.'}</p> : null}
        <p className="mt-3 text-sm leading-6 text-gray-500">{zh ? '每一步都会保存进度。等待授权或操作中断后，可让 Agent 从同一会话继续。' : 'Progress is saved at every step. Ask your Agent to continue the same session after authorization or an interruption.'}</p>
        {copyFailed ? <p role="alert" className="mt-3 text-sm text-red-700">{zh ? '浏览器未允许复制，请展开下方全文并手动复制。' : 'Clipboard access was blocked. Expand the full prompt below and copy it manually.'}</p> : null}
        <details className="mt-4 border-t border-gray-100 pt-4" open={copyFailed || undefined}>
          <summary className="cursor-pointer text-sm font-medium text-gray-700">{zh ? '查看完整提示词' : 'View the full prompt'}</summary>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-4 text-sm leading-6 text-gray-700">{prompt}</pre>
        </details>
      </section>
      <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map(([title, description], index) => <li key={title} className="rounded-xl border border-gray-200 p-4"><span className="text-sm text-gray-500">0{index + 1}</span><h2 className="mt-2 font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-gray-600">{description}</p></li>)}
      </ol>
      <section className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:p-6">
        <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} />{zh ? '知识导入可以稍后进行' : 'Import knowledge later'}</h2>
        <p className="mt-2 text-sm leading-6 text-gray-600">{zh ? '连接时无需提供本地目录。完成连接后，再选择需要整理的资料、检查预览并确认同步。' : 'No local folder is needed to connect. After setup, choose your sources, review a preview, and confirm synchronization separately.'}</p>
        <p className="mt-3 flex items-start gap-2 text-sm leading-6 text-gray-600"><FileCheck2 size={18} className="mt-1 shrink-0" />{zh ? '配置完成、网关检查通过和客户端实际读取成功会分别报告。' : 'Configuration, gateway checks, and successful reading in your client are reported separately.'}</p>
      </section>
    </article>
  );
};
