import React, { useState } from 'react';
import { Bot, Check, CheckCircle2, Copy, ScanSearch, ShieldCheck } from 'lucide-react';
import {
  LOCAL_SYNC_ONBOARD_COMMAND as ONBOARD_COMMAND,
  LOCAL_SYNC_VERSION,
} from '../../config/localSync';
import { useLanguage } from '../../context/LanguageContext';

const agentPrompt = (zh: boolean) => zh
  ? `请帮我完成 AgentWiki 自助接入。

请在本机启动下面的固定版本命令，并作为它的协议驱动者持续读取 stdout 中的逐行 NDJSON；按事件向我收集或确认信息，再把带相同 requestId 的 JSON 回复写回进程 stdin，直到收到 completed 或 failed。不要只把命令展示给我，也不要把它当作普通的一次性终端命令运行。

遇到 authorization_required 时，把安全授权链接和 userCode 给我，我会在浏览器登录或注册并批准；账号密码只在网页输入，不要在对话中索取。遇到 input_required 时逐项问我。遇到 preview 和 confirmation_required 时先展示计划或同步预览，只有得到我的明确确认后才继续。不要自行批准上传。

完成后告诉我创建或复用的 Space、Agent、角色，以及 agentwiki MCP 连接和验证状态。若失败，保留 sessionId 并告诉我如何恢复。

固定命令：
${ONBOARD_COMMAND}`
  : `Please complete AgentWiki self-service onboarding for me.

Start the pinned command below on this machine and act as its protocol driver. Keep reading line-delimited NDJSON from stdout, collect or confirm information with me for each event, and write a JSON reply with the same requestId to the process stdin until it emits completed or failed. Do not merely show me the command, and do not run it as an ordinary one-shot terminal command.

For authorization_required, give me the secure authorization URL and userCode so I can sign in or register and approve in my browser. Credentials must only be entered on the web page; never ask for them in chat. For input_required, ask me for each field. For preview and confirmation_required, show me the plan or sync preview and continue only after my explicit confirmation. Never approve an upload yourself.

When finished, report the created or reused Space, Agent, role, and the agentwiki MCP connection and verification status. On failure, preserve the sessionId and tell me how to resume.

Pinned command:
${ONBOARD_COMMAND}`;

export const OnboardPage: React.FC = () => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const prompt = agentPrompt(zh);

  const copyPrompt = async () => {
    setCopyFailed(false);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  };

  const steps = zh ? [
    ['在浏览器中登录或注册并授权', 'Agent 启动流程后会给出安全授权页；账号密码不进入 Agent 对话。'],
    ['确认 Agent、Space、权限和本地扫描计划', '在本地 Agent 中按结构化提示填空确认，不必手写配置文件。'],
    ['预览整理后的知识并确认同步', '原始代码和文档留在本机，只有你确认的知识内容会同步。'],
  ] : [
    ['Authorize in your browser', 'Sign in or register on the secure authorization page. Agent credentials are never displayed there.'],
    ['Confirm the Agent, Space, permissions, and local scan plan', 'Answer the structured prompts in your local Agent without hand-writing configuration files.'],
    ['Preview the organized knowledge and confirm sync', 'Raw code and documents stay local; only knowledge you approve is synchronized.'],
  ];

  return (
    <div className="text-gray-900">
      <header className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
          <ShieldCheck size={14} /> AgentWiki {LOCAL_SYNC_VERSION}
        </span>
        <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
          {zh ? '让本地 Agent 帮你完成接入' : 'Let your local Agent handle onboarding'}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-gray-600">
          {zh
            ? '复制一段任务提示词到 Codex、Claude Code、OpenCode 等本地 Agent，让 Agent 替你驱动完整接入流程。'
            : 'Paste one task prompt into Codex, Claude Code, or OpenCode and let the Agent drive the complete onboarding flow.'}
        </p>
      </header>

        <section className="mt-10 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-800">
            <Bot size={18} className="text-blue-600" />
            {zh ? '复制整段提示词到你的 Agent' : 'Copy the full prompt into your Agent'}
          </div>
          <div className="rounded-xl bg-gray-950 p-4">
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-green-300">
              {prompt.slice(0, -ONBOARD_COMMAND.length)}
              <code className="text-green-200">{ONBOARD_COMMAND}</code>
            </pre>
            <button
              type="button"
              onClick={copyPrompt}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 hover:bg-gray-700 sm:w-auto"
            >
              {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
              {copied ? (zh ? '已复制提示词' : 'Prompt copied') : (zh ? '复制提示词' : 'Copy prompt')}
            </button>
          </div>
          <p className="mt-3 text-xs leading-5 text-gray-500">
            {zh
              ? '这不是普通终端命令：其中的 NDJSON 协议需要 Agent 持续读取事件并回写输入。'
              : 'This is not an ordinary terminal command: the Agent must keep reading NDJSON events and writing protocol replies.'}
          </p>
          {copyFailed ? (
            <p role="alert" className="mt-2 text-xs leading-5 text-red-600">
              {zh
                ? '浏览器未允许复制，请选中上方整段提示词后手动复制。'
                : 'Clipboard access was blocked. Select the full prompt above and copy it manually.'}
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
    </div>
  );
};
