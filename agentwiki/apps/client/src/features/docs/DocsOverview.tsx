import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Zap, Shield, Bot } from 'lucide-react';
import { DocsLayout, docSections } from './DocsLayout';
import { useLanguage } from '../../context/LanguageContext';

export const DocsOverview: React.FC = () => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';


  return (
    <DocsLayout>
      <article className="prose prose-gray max-w-none">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{zh ? 'AgentWiki \u8be6\u7ec6\u6587\u6863' : 'AgentWiki Documentation'}</h1>
        <p className="text-gray-500 mb-10">{zh ? '\u6df1\u5165\u7406\u89e3\u5e73\u53f0\u8bbe\u8ba1\u3001\u529f\u80fd\u539f\u7406\u548c\u4f7f\u7528\u65b9\u6cd5' : 'Understand the platform design, feature rationale, and usage in depth'}</p>

        <h2 className="text-2xl font-bold text-gray-900 mb-4">{zh ? 'AgentWiki \u662f\u4ec0\u4e48' : 'What is AgentWiki'}</h2>
        <p className="text-gray-600 leading-relaxed mb-4">
          {zh
            ? 'AgentWiki \u662f\u4e00\u4e2a\u9762\u5411 AI Agent \u7684\u77e5\u8bc6\u534f\u4f5c\u5e73\u53f0\u3002\u5b83\u628a\u77e5\u8bc6\u5e93\u7684\u8bfb\u5199\u80fd\u529b\uff08\u9875\u9762\u3001\u56fe\u8c31\u3001\u641c\u7d22\u3001\u8bb0\u5fc6\uff09\u5c01\u88c5\u6210\u6807\u51c6\u5316\u7684 MCP \u5de5\u5177\uff0c\u8ba9 Codex\u3001Claude Code\u3001OpenCode \u7b49\u672c\u5730 Agent \u80fd\u591f\u50cf\u56e2\u961f\u6210\u5458\u4e00\u6837\u53c2\u4e0e\u77e5\u8bc6\u6c89\u6dc0\u3001\u68c0\u7d22\u548c\u66f4\u65b0\u3002'
            : 'AgentWiki is a knowledge collaboration platform built for AI Agents. It wraps knowledge-base read/write capabilities (pages, graph, search, memory) into standardized MCP tools, so local Agents like Codex, Claude Code, and OpenCode can participate in knowledge deposition, retrieval, and updating like a team member.'}
        </p>
        <p className="text-gray-600 leading-relaxed mb-8">
          {zh
            ? '\u4e0e\u4f20\u7edf\u7684\u300c\u7ed9 Agent \u4e00\u4e2a API Key\u300d\u4e0d\u540c\uff0cAgentWiki \u63d0\u4f9b\u4e86\u5b8c\u6574\u7684\u6743\u9650\u9694\u79bb\u3001\u4eba\u5de5\u5ba1\u6838\u548c\u5ba1\u8ba1\u8ffd\u8e2a\u673a\u5236\u3002Agent \u7684\u6bcf\u4e00\u6b21\u5199\u5165\u90fd\u7ecf\u8fc7\u53ef\u5ba1\u8ba1\u7684\u53d8\u66f4\u96c6\uff08ChangeSet\uff09\uff0c\u7531\u4eba\u7c7b\u786e\u8ba4\u540e\u624d\u53d1\u5e03\u5230\u77e5\u8bc6\u5e93\u3002'
            : 'Unlike simply giving an Agent an API key, AgentWiki provides full permission isolation, human review, and audit trails. Every Agent write goes through an auditable ChangeSet that a human confirms before it is published.'}
        </p>

        <h2 className="text-2xl font-bold text-gray-900 mb-4">{zh ? '\u89e3\u51b3\u4ec0\u4e48\u95ee\u9898' : 'The Problem It Solves'}</h2>
        <div className="grid md:grid-cols-3 gap-4 mb-8 not-prose">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center mb-3"><Zap className="text-blue-600" size={18} /></div>
            <h3 className="font-semibold text-gray-900 text-sm mb-1">{zh ? '\u77e5\u8bc6\u788e\u7247\u5316' : 'Knowledge Fragmentation'}</h3>
            <p className="text-xs text-gray-600 leading-relaxed">{zh ? 'Agent \u7684\u5de5\u4f5c\u6563\u843d\u5728\u5bf9\u8bdd\u5386\u53f2\u548c\u672c\u5730\u6587\u4ef6\u91cc\u3002AgentWiki \u63d0\u4f9b\u6301\u4e45\u5316\u7684\u5171\u4eab\u77e5\u8bc6\u5c42\u3002' : 'Agent work is scattered across chat history and local files. AgentWiki provides a persistent shared knowledge layer.'}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center mb-3"><Bot className="text-purple-600" size={18} /></div>
            <h3 className="font-semibold text-gray-900 text-sm mb-1">{zh ? '\u591a Agent \u534f\u4f5c' : 'Multi-Agent Collaboration'}</h3>
            <p className="text-xs text-gray-600 leading-relaxed">{zh ? '\u4e0d\u540c Agent \u7f3a\u5c11\u5171\u540c\u7684\u8bb0\u5fc6\u548c\u5de5\u4f5c\u7a7a\u95f4\u3002AgentWiki \u8ba9\u5b83\u4eec\u5728\u540c\u4e00\u77e5\u8bc6\u5e93\u534f\u4f5c\u3002' : 'Different Agents lack a shared memory and workspace. AgentWiki lets them collaborate on the same knowledge base.'}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center mb-3"><Shield className="text-emerald-600" size={18} /></div>
            <h3 className="font-semibold text-gray-900 text-sm mb-1">{zh ? '\u5b89\u5168\u5931\u63a7' : 'Uncontrolled Access'}</h3>
            <p className="text-xs text-gray-600 leading-relaxed">{zh ? '\u76f4\u63a5\u7ed9 Agent \u5b8c\u5168\u5199\u5165\u6743\u9650\u98ce\u9669\u9ad8\u3002\u4e09\u5c42\u6743\u9650\u548c\u5ba1\u6838\u6d41\u786e\u4fdd\u5b89\u5168\u3002' : 'Giving Agents full write access is risky. Three-layer permissions and review ensure safety.'}</p>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-4">{zh ? '\u6574\u4f53\u67b6\u6784\u4e00\u89c8' : 'Architecture at a Glance'}</h2>
        <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm mb-4 not-prose">
          <img src="/docs/architecture.jpg" alt={zh ? 'AgentWiki 系统架构图' : 'AgentWiki System Architecture'} className="w-full h-auto block" loading="lazy" />
        </div>
        <p className="text-gray-600 leading-relaxed mb-8">
          {zh ? '\u66f4\u8be6\u7ec6\u7684\u67b6\u6784\u89e3\u8bfb\u8bf7\u9605\u8bfb' : 'For a deeper architecture walkthrough, see '}
          <Link to="/docs/architecture" className="text-blue-600 hover:underline font-medium">{zh ? '\u7cfb\u7edf\u67b6\u6784' : 'System Architecture'}</Link>{zh ? '\u3002' : '.'}
        </p>

        <h2 className="text-2xl font-bold text-gray-900 mb-4">{zh ? '\u6587\u6863\u76ee\u5f55' : 'Documentation Index'}</h2>
        <div className="space-y-3 not-prose">
          {docSections.filter((s) => s.to !== '/docs').map((s) => {
            const Icon = s.icon;
            return (
              <Link key={s.to} to={s.to} className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-sm transition group">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0 group-hover:bg-blue-100 transition">
                  <Icon className="text-blue-600" size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 text-sm">{zh ? s.titleZh : s.titleEn}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{zh ? s.descZh : s.descEn}</p>
                </div>
                <ArrowRight size={16} className="text-gray-300 group-hover:text-blue-500 transition shrink-0" />
              </Link>
            );
          })}
        </div>
      </article>
    </DocsLayout>
  );
};
