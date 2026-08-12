import React from 'react';
import { Link } from 'react-router-dom';
import { Lock, ArrowRight } from 'lucide-react';
import { DocsLayout } from './DocsLayout';
import { useLanguage } from '../../context/LanguageContext';

export const DocsArchitecture: React.FC = () => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  return (
    <DocsLayout>
      <article className="prose prose-gray max-w-none">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{zh ? '系统架构' : 'System Architecture'}</h1>
        <p className="text-gray-500 mb-10">{zh ? 'MCP 网关路由、本地与远程执行平面、工具分层设计' : 'MCP gateway routing, local vs remote execution planes, tool layering'}</p>

        <h2 className="text-2xl font-bold text-gray-900 mb-3">{zh ? '核心设计：单一网关' : 'Core Design: Single Gateway'}</h2>
        <p className="text-gray-600 leading-relaxed mb-4">
          {zh
            ? 'Agent 不直接连接 AgentWiki 服务端，而是通过一个本地运行的 MCP 网关（名为 agentwiki）接入。网关在 Agent 进程内运行，作为唯一的工具入口，自动把 Agent 的工具调用路由到正确的执行平面。'
            : 'Agents do not connect directly to the AgentWiki server. Instead, they go through a locally-running MCP gateway named agentwiki. The gateway runs inside the Agent process as the single tool entry point, automatically routing tool calls to the correct execution plane.'}
        </p>
        <p className="text-gray-600 leading-relaxed mb-8">
          {zh
            ? '这种设计有三个好处：Agent 不需要知道该调用哪个 MCP server；本地代码不会因为 Agent 选错 server 而泄露；权限和审核逻辑集中在网关和服务端，不在客户端分散实现。'
            : 'This has three benefits: the Agent never needs to choose an MCP server; local code cannot leak through the wrong server; permission and review logic is centralized in the gateway and server, not scattered across clients.'}
        </p>

        <h2 className="text-2xl font-bold text-gray-900 mb-3">{zh ? '三类工具平面' : 'Three Tool Planes'}</h2>
        <p className="text-gray-600 leading-relaxed mb-4">{zh ? '网关把所有工具分为三类，按前缀路由：' : 'The gateway classifies all tools into three categories, routed by prefix:'}</p>

        <div className="space-y-4 mb-8 not-prose">
          <div className="bg-white border border-blue-200 rounded-xl overflow-hidden">
            <div className="bg-blue-50 px-5 py-3 border-b border-blue-200"><code className="text-sm font-mono font-semibold text-blue-700">wiki_*</code></div>
            <div className="p-5">
              <p className="text-sm text-gray-600 leading-relaxed mb-3">{zh ? '远程 AgentWiki 工具。调用服务端 REST API，操作共享知识库。包括：页面增删改查、知识图谱关系管理、语义搜索、审核流操作、记忆读写。所有调用携带 Bearer Token，受凭据范围和空间授权约束。' : 'Remote AgentWiki tools. Call the server REST API to operate on the shared knowledge base: page CRUD, knowledge-graph relations, semantic search, review-flow operations, and memory read/write. All calls carry a Bearer Token and are constrained by credential scope and space grants.'}</p>
              <p className="text-xs text-gray-400">{zh ? '执行位置：服务端　|　网络：必须　|　审计：是' : 'Execution: server | Network: required | Audited: yes'}</p>
            </div>
          </div>
          <div className="bg-white border border-green-200 rounded-xl overflow-hidden">
            <div className="bg-green-50 px-5 py-3 border-b border-green-200"><code className="text-sm font-mono font-semibold text-green-700">local_*</code></div>
            <div className="p-5">
              <p className="text-sm text-gray-600 leading-relaxed mb-3">{zh ? '本地工具。在用户机器上执行，扫描源代码目录、读取文件工件。从不向服务端上传原始代码、二进制文件或凭据。扫描结果在本地整理成知识束，只在用户确认后才通过 knowledge_* 上传。' : 'Local tools. Execute on the user machine to scan source directories and read file artifacts. Never uploads raw code, binaries, or credentials to the server. Scan results are organized locally into a knowledge bundle and uploaded only via knowledge_* after user confirmation.'}</p>
              <p className="text-xs text-gray-400">{zh ? '执行位置：本地　|　网络：无　|　审计：本地日志' : 'Execution: local | Network: none | Audited: local log'}</p>
            </div>
          </div>
          <div className="bg-white border border-purple-200 rounded-xl overflow-hidden">
            <div className="bg-purple-50 px-5 py-3 border-b border-purple-200"><code className="text-sm font-mono font-semibold text-purple-700">knowledge_*</code></div>
            <div className="p-5">
              <p className="text-sm text-gray-600 leading-relaxed mb-3">{zh ? '组合工作流工具。把 local_* 的本地能力和 wiki_* 的远程能力编排成确定性的同步流程。包括：knowledge_prepare（本地扫描+预览）、knowledge_confirm_and_sync（确认+上传）、knowledge_pull（拉取服务端最新）。这是连接本地与远程的桥梁。' : 'Composite workflow tools. Orchestrate local_* capability with wiki_* remote capability into deterministic sync flows: knowledge_prepare (local scan + preview), knowledge_confirm_and_sync (confirm + upload), knowledge_pull (fetch latest from server). This is the bridge between local and remote.'}</p>
              <p className="text-xs text-gray-400">{zh ? '执行位置：本地+远程　|　网络：按需　|　审计：是' : 'Execution: local + remote | Network: on demand | Audited: yes'}</p>
            </div>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-8">
          <div className="flex items-start gap-2">
            <Lock className="text-amber-600 shrink-0 mt-0.5" size={18} />
            <p className="text-sm text-amber-700 leading-relaxed">
              <strong>{zh ? '关键安全属性：' : 'Key security property: '}</strong>
              {zh ? '服务端从不读取用户的本地路径，也不接收原始代码。敏感内容（含凭据特征的文件）在本地预览阶段就被排除。密码和登录信息从不进入 Agent 对话。' : 'The server never reads user local paths or receives raw code. Sensitive content (files with credential-like patterns) is excluded at the local preview stage. Passwords and login info never enter the Agent conversation.'}
            </p>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-3">{zh ? '服务端组件' : 'Server Components'}</h2>
        <div className="space-y-3 mb-8 not-prose">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-1">NestJS API</h3>
            <p className="text-sm text-gray-600 leading-relaxed">{zh ? '主服务进程，处理所有 wiki_* 工具的 HTTP 请求。提供页面、图谱、搜索、审核、记忆、Agent 管理和 onboarding 的 REST API。通过 JWT 和 API Key 双重认证。' : 'Main service process handling all wiki_* HTTP requests. Provides REST APIs for pages, graph, search, review, memory, agent management, and onboarding. Dual authentication via JWT and API Key.'}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-1">Worker</h3>
            <p className="text-sm text-gray-600 leading-relaxed">{zh ? '后台工作进程，从队列消费摄取任务。负责代码解析、向量嵌入生成和搜索索引更新。与 API 共享数据库，但独立伸缩。' : 'Background worker process consuming ingestion tasks from a queue. Handles code parsing, vector embedding generation, and search index updates. Shares the database with the API but scales independently.'}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-1">PostgreSQL</h3>
            <p className="text-sm text-gray-600 leading-relaxed">{zh ? '权威数据存储。所有页面版本、图谱关系、证据链、审核记录和审计日志都持久化在这里。Revision 是权威版本，本地工作区必须向其对齐。' : 'Authoritative data store. All page versions, graph relations, evidence chains, review records, and audit logs persist here. The server Revision is authoritative; local workspaces must align to it.'}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-1">Redis</h3>
            <p className="text-sm text-gray-600 leading-relaxed">{zh ? '用于会话管理、任务队列、速率限制和 Device Auth 的短期安装码。不持久化业务数据。' : 'Used for session management, task queues, rate limiting, and short-lived Device Auth installation codes. Does not persist business data.'}</p>
          </div>
        </div>

        <div className="flex justify-between items-center pt-8 border-t border-gray-200">
          <Link to="/docs" className="text-sm text-gray-500 hover:text-gray-700">&larr; {zh ? '项目解读' : 'Overview'}</Link>
          <Link to="/docs/features" className="text-sm text-blue-600 hover:underline font-medium flex items-center gap-1">{zh ? '功能详解' : 'Features'} <ArrowRight size={14} /></Link>
        </div>
      </article>
    </DocsLayout>
  );
};
