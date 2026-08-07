import React, { useState } from 'react';
import { Copy, Check, ExternalLink, Bot, UserPlus, Key, BookOpen, Send } from 'lucide-react';
import { GlobalNavigation } from '../../components/GlobalNavigation';
import { useLanguage } from '../../context/LanguageContext';

const ONBOARD_URL = 'https://agentwiki.quukk.com/onboard';
const PROMPT = `请访问 ${ONBOARD_URL} 并一步一步引导我完成 AgentWiki 的注册和 Agent 接入。`;

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
          <h2 className="text-lg font-semibold flex items-center gap-2"><Send size={20} className="text-blue-600" /> {zh ? '方式一：复制提示词' : 'Method 1: Copy prompt'}</h2>
          <p className="text-sm text-gray-500">{zh ? '把下面这段话直接粘贴给你的本地 Agent：' : 'Paste the following message directly to your local Agent:'}</p>
          <div className="bg-gray-900 text-green-400 rounded-lg p-4 text-sm font-mono break-all relative">
            {PROMPT}
            <button onClick={() => copy(PROMPT, setCopiedPrompt)} className="absolute top-2 right-2 p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300" title={zh ? '复制' : 'Copy'}>
              {copiedPrompt ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
            </button>
          </div>
        </div>

        <div className="bg-white border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2"><ExternalLink size={20} className="text-blue-600" /> {zh ? '方式二：复制链接' : 'Method 2: Copy link'}</h2>
          <p className="text-sm text-gray-500">{zh ? '复制链接，告诉你的 Agent "请访问这个链接并引导我完成接入"：' : 'Copy the link and tell your Agent "Please visit this link and guide me through connecting.":'}</p>
          <div className="flex items-center gap-2 bg-gray-50 border rounded-lg px-4 py-3">
            <code className="flex-1 text-sm text-blue-600 break-all">{ONBOARD_URL}</code>
            <button onClick={() => copy(ONBOARD_URL, setCopiedUrl)} className="p-2 rounded hover:bg-gray-200 shrink-0">
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

        <div className="text-center text-sm text-gray-400">
          {zh ? '支持 Codex、Claude Code、OpenCode 及任何 MCP 兼容 Agent' : 'Supports Codex, Claude Code, OpenCode and any MCP-compatible Agent'}
        </div>
      </div>
    </div>
  );
};
