import React, { useState } from 'react';
import { Bot, Check, Copy, FileCheck2, ShieldCheck } from 'lucide-react';
import { LOCAL_SYNC_VERSION } from '../../config/localSync';
import { useLanguage } from '../../context/LanguageContext';
import { buildOnboardPrompt, ONBOARD_CLIENTS, type OnboardClient } from './onboardPrompt';

export const OnboardPage: React.FC = () => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const [client, setClient] = useState<OnboardClient>('codex');
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
    ['浏览器授权', '在当前服务器登录，允许这次接入。'],
    ['确认空间和权限', '按名称选择空间，确认账号、角色和配置位置。'],
    ['完成客户端配置', 'Agent 保存进度，配置连接并检查网关。'],
    ['实际读取验证', '需要时重载客户端，再实际读取一篇已知页面。'],
  ] : [
    ['Prepare the environment', 'Your Agent checks the environment and starts setup.'],
    ['Authorize in your browser', 'Sign in to this server and approve the connection.'],
    ['Confirm space and permissions', 'Choose a space by name and review the account, role, and configuration path.'],
    ['Configure your client', 'Your Agent saves progress, configures the connection, and checks the gateway.'],
    ['Verify a real page read', 'Reload the client when needed, then actually read a known page.'],
  ];
  return (
    <article className="min-w-0 text-gray-900">
      <header>
        <p className="flex items-center gap-2 text-sm text-gray-500"><Bot size={18} /> AgentWiki · {LOCAL_SYNC_VERSION}</p>
        <h1 className="mt-4 text-2xl font-semibold">{zh ? '连接你的 Agent' : 'Connect your Agent'}</h1>
        <p className="mt-3 max-w-2xl text-base leading-6 text-gray-600">{zh ? '选择正在使用的客户端，复制完整提示词。Agent 会引导你授权、确认配置并验证实际读取。' : 'Choose your client and copy the complete prompt. Your Agent guides authorization, configuration, and a real page-read check.'}</p>
      </header>
      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6" aria-labelledby="agent-connect-title">
        <h2 id="agent-connect-title" className="text-lg font-semibold">{zh ? '复制整段提示词到你的 Agent' : 'Copy the full prompt into your Agent'}</h2>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={zh ? '选择客户端' : 'Choose a client'}>
          {ONBOARD_CLIENTS.map(item => <button key={item.id} type="button" aria-pressed={client === item.id} onClick={() => { setClient(item.id); setCopiedPrompt(null); setCopyFailed(false); }} className={`rounded-lg border px-4 py-2 text-sm font-medium ${client === item.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}>{item.label}</button>)}
        </div>
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
