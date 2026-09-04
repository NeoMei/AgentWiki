import React, { useState } from 'react';
import { Bot, Check, CheckCircle2, Copy, ScanSearch, ShieldCheck } from 'lucide-react';
import {
  LOCAL_SYNC_ONBOARD_COMMAND as ONBOARD_COMMAND,
  LOCAL_SYNC_VERSION,
} from '../../config/localSync';
import { useLanguage } from '../../context/LanguageContext';

const agentPrompt = (zh: boolean) => zh
  ? `请帮我完成 AgentWiki 自助接入。

请严格按下面的协议执行，不要只把命令展示给我；按事件向我收集或确认信息，并把带相同 requestId 的 JSON 回复写回进程 stdin：

1. 在本机用“可持续读取输出、可继续写入 stdin”的持久终端会话启动固定命令；不要当作等待退出的一次性命令。启动后立即告诉我正在准备环境，并持续读取 stdout 中的逐行 NDJSON，直到收到 completed 或 failed。
2. 首次运行 npx 可能需要安装依赖，几分钟内没有 stdout 也不代表失败。保持同一个进程会话并轮询输出，不要因为一次工具超时或暂时无输出就重启。5 分钟仍没有第一条 NDJSON 时，检查进程和 stderr；安装仍在运行就继续等待，进程已退出才报告错误。绝对不要同时启动第二个接入进程。
3. 收到 input_required：读取 fields，只向我询问缺少的值并尊重 defaultValue；paths 类型必须写成字符串数组，choice 类型只能使用 choices 中的值，string 类型写成字符串。收齐后向 stdin 写入一行 JSON，例如 {"requestId":"input-1","values":{"sourcePaths":["/path/to/source"],"role":"editor"}}。实际 requestId、字段名和值类型必须使用事件定义，不要自行改名或改型。
4. 收到 authorization_required：把 url 和 userCode 发给我，让我只在网页中登录或注册并批准；不要索取账号密码。然后保持同一个进程会话，继续轮询，不能重跑命令。
5. 收到 preview：把计划或同步预览完整展示给我，并记住它对应的下一次 confirmation_required；preview 本身不需要写 stdin。
6. 收到 confirmation_required：先取得我的明确确认。确认后向 stdin 写入一行 JSON，例如 {"requestId":"plan-1","confirmed":true,"planHash":"plan-hash-1"}；实际 requestId 和 planHash 必须逐字复制当前事件，只能使用 confirmed 布尔字段，不得增加其他确认字段、遗漏 planHash 或自行批准上传。
7. 收到 heartbeat 或 progress：继续轮询同一个会话，不要把它当成完成或失败。
8. 每次写 stdin 后继续读取。只有 completed 才算成功；failed 时完整报告 code、message、sessionId、retryable，以及事件包含时的 resumeSessionId 和 nextAction，不要臆造缺失字段或恢复方式。

完成后告诉我创建或复用的 Space、Agent、角色，以及 agentwiki MCP 连接和验证状态。若失败，保留 sessionId 并告诉我如何恢复。

固定命令：
${ONBOARD_COMMAND}`
  : `Please complete AgentWiki self-service onboarding for me.

Follow this protocol exactly; do not merely show me the command. Collect or confirm information with me for each event, then write a JSON reply with the same requestId back to the process stdin:

1. Start the pinned command in a persistent terminal session whose stdout can be polled and whose stdin remains writable. Do not run it as a one-shot command that waits for exit. Tell me immediately that the environment is being prepared, then keep reading line-delimited NDJSON from stdout until completed or failed.
2. The first npx run may need to install dependencies, so several minutes without stdout does not by itself mean failure. Keep the same process session and poll it; never restart because one tool call timed out or returned no output. If no first NDJSON event arrives after 5 minutes, inspect the process and stderr. Keep waiting while installation is active, and report an error only after the process exits. Never start a second onboarding process in parallel.
3. On input_required, read fields, ask me only for missing values, and honor defaultValue. A paths field must be a string array, a choice field must use one of choices, and a string field must be a string. Once collected, write exactly one JSON line such as {"requestId":"input-1","values":{"sourcePaths":["/path/to/source"],"role":"editor"}}. Use the event's actual requestId, field names, and value types; never rename or retype them.
4. On authorization_required, give me the url and userCode so I can sign in or register and approve only in the browser. Never ask for credentials in chat. Keep polling the same process session afterward; do not rerun the command.
5. On preview, show me the complete plan or sync preview and retain it for the following confirmation_required event. A preview does not itself require an stdin reply.
6. On confirmation_required, first obtain my explicit confirmation. Then write exactly one JSON line such as {"requestId":"plan-1","confirmed":true,"planHash":"plan-hash-1"}; copy the current event's actual requestId and planHash verbatim. Use only the confirmed boolean for the decision; never add another confirmation field, omit planHash, or approve an upload yourself.
7. On heartbeat or progress, keep polling the same session; neither event means completion or failure.
8. Continue reading after every stdin reply. Only completed means success. For failed, report code, message, sessionId, retryable, plus resumeSessionId and nextAction when present; never invent missing fields or recovery instructions.

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
