import React, { useState } from 'react';
import { Copy, Check, ExternalLink, Bot, UserPlus, Key, BookOpen, Send, Server, Terminal } from 'lucide-react';
import { GlobalNavigation } from '../../components/GlobalNavigation';
import { useLanguage } from '../../context/LanguageContext';

const ONBOARD_JSON_URL = 'https://agentwiki.quukk.com/api/onboard.json';
const PROMPT = `请访问 ${ONBOARD_JSON_URL} 获取 AgentWiki 结构化接入计划，然后按 steps 顺序执行。每一步中，把 save 声明的字段保存为变量，用于替换后续步骤 URL、headers、body 中的占位符（如 {{TOKEN}}）。若我没有提供邮箱、密码或昵称，请先问我。每一步执行前告知我你要做什么，执行后把关键结果告诉我。`;

export const OnboardPage: React.FC = () => {
  const { language, t } = useLanguage();
  const zh = language === 'zh-CN';
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const copy = async (text: string, setter: (v: boolean) => void) => {
    await navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <GlobalNavigation density="public" />
      <div className="max-w-2xl mx-auto px-4 py-12 space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">🚀 {t('onboard.title')}</h1>
          <p className="text-gray-500">{t('onboard.subtitle')}</p>
        </div>

        <div className="bg-white border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Send size={20} className="text-blue-600" /> {zh ? '方式一：复制提示词（推荐）' : 'Method 1: Copy prompt (recommended)'}</h2>
          <p className="text-sm text-gray-500">{zh ? '把下面这段话直接粘贴给你的本地 Agent，它会自动读取接入指令并逐步执行：' : 'Paste the following message directly to your local Agent. It will fetch the onboarding instructions and execute step by step:'}</p>
          <div className="bg-gray-900 text-green-400 rounded-lg p-4 text-sm font-mono break-all relative">
            {PROMPT}
            <button onClick={() => copy(PROMPT, setCopiedPrompt)} className="absolute top-2 right-2 p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300" title={zh ? '复制' : 'Copy'}>
              {copiedPrompt ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
            </button>
          </div>
        </div>

        <div className="bg-white border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2"><ExternalLink size={20} className="text-blue-600" /> {zh ? '方式二：复制 API 指令链接' : 'Method 2: Copy API instruction link'}</h2>
          <p className="text-sm text-gray-500">{zh ? '复制 API 端点链接，让 Agent 访问以获取原始接入指令：' : 'Copy the API endpoint link for your Agent to fetch raw instructions:'}</p>
          <div className="flex items-center gap-2 bg-gray-50 border rounded-lg px-4 py-3">
            <code className="flex-1 text-sm text-blue-600 break-all">{ONBOARD_JSON_URL}</code>
            <button onClick={() => copy(ONBOARD_JSON_URL, setCopiedUrl)} className="p-2 rounded hover:bg-gray-200 shrink-0">
              {copiedUrl ? <Check size={18} className="text-green-600" /> : <Copy size={18} className="text-gray-400" />}
            </button>
          </div>
        </div>

        <div className="bg-white border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">{t('onboard.stepsTitle')}</h2>
          <div className="space-y-3">
            {[
              { icon: <UserPlus size={18} />, label: zh ? '注册 AgentWiki 账号' : 'Register AgentWiki account', desc: zh ? 'Agent 会引导你设置邮箱和密码' : 'Agent will guide you to set email and password' },
              { icon: <BookOpen size={18} />, label: zh ? '创建知识空间' : 'Create knowledge space', desc: zh ? '为你的 Agent 创建专属知识库' : 'Create a dedicated knowledge base for your Agent' },
              { icon: <Bot size={18} />, label: zh ? '注册 Agent 身份' : 'Register Agent identity', desc: zh ? '在 AgentWiki 上创建 Agent 并获取凭据' : 'Create an Agent on AgentWiki and obtain credentials' },
              { icon: <Key size={18} />, label: zh ? '生成 API Key' : 'Generate API Key', desc: zh ? 'Agent 获得独立的 API 密钥（agk_...）' : 'Agent gets an independent API key (agk_...)' },
              { icon: <Send size={18} />, label: zh ? '验证并开始使用' : 'Verify and start using', desc: zh ? 'Agent 创建第一个页面，确认一切正常' : 'Agent creates the first page to confirm everything works' },
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">{step.icon}</div>
                <div>
                  <div className="text-sm font-medium">{i + 1}. {step.label}</div>
                  <div className="text-xs text-gray-400">{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">{zh ? '两种 MCP 接入方式' : 'Two MCP modes'}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-blue-600 font-medium"><Server size={18} /> {zh ? '方式 A：直接远程 MCP' : 'Mode A: Direct remote MCP'}</div>
              <p className="text-xs text-gray-500">{zh ? '由 AgentWiki 服务端直接暴露。适合直接查询/创建页面、图谱、来源、审核。' : 'Exposed by the AgentWiki server. Use for directly querying/creating pages, graph, sources, and reviews.'}</p>
              <p className="text-xs text-gray-400">{zh ? '工具：list_spaces, list_pages, get_page, search_pages, propose_page, list_graph, propose_relation, list_sources, get_knowledge_sync_state, start_source_run, recall_memory, list_reviews, approve_change_set' : 'Tools: list_spaces, list_pages, get_page, search_pages, propose_page, list_graph, propose_relation, list_sources, get_knowledge_sync_state, start_source_run, recall_memory, list_reviews, approve_change_set'}</p>
            </div>
            <div className="border rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-green-600 font-medium"><Terminal size={18} /> {zh ? '方式 B：本地同步 MCP' : 'Mode B: Local sync MCP'}</div>
              <p className="text-xs text-gray-500">{zh ? '由本地 @neomei/agentwiki-local-sync 包暴露。适合扫描本地代码/文档，整理成知识库后同步到 AgentWiki。' : 'Exposed by the local @neomei/agentwiki-local-sync package. Use for scanning local code/documents, organizing, and syncing to AgentWiki.'}</p>
              <p className="text-xs text-gray-400">{zh ? '工具：start_knowledge_job, get_next_work_item, read_artifacts, submit_organized_item, validate_knowledge_job, preview_knowledge_job, confirm_and_push, pull_space, resolve_conflict' : 'Tools: start_knowledge_job, get_next_work_item, read_artifacts, submit_organized_item, validate_knowledge_job, preview_knowledge_job, confirm_and_push, pull_space, resolve_conflict'}</p>
            </div>
          </div>
          <div className="text-xs text-gray-500 bg-yellow-50 border border-yellow-100 rounded-lg p-3">
            {zh ? '注意：不要把两套工具混用。直接远程 MCP 不能执行本地扫描/整理工作流；本地同步 MCP 不能替代 AgentWiki 服务端 MCP。' : 'Note: do not mix the two tool sets. The direct remote MCP cannot run local scan/organize workflows; the local sync MCP cannot replace the AgentWiki server MCP.'}
          </div>
        </div>

        <div className="text-center text-sm text-gray-400">
          {zh ? '支持两种 MCP 接入方式：直接远程 AgentWiki MCP 或本地 agentwiki-local-sync MCP' : 'Supports two MCP modes: direct remote AgentWiki MCP or local agentwiki-local-sync MCP'}
        </div>
      </div>
    </div>
  );
};
