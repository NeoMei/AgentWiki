import React from 'react';
import { Link } from 'react-router-dom';
import { Layers, FileText, Network, Search, GitBranch, CheckCircle2, Brain, ArrowRight } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

export const DocsFeatures: React.FC = () => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';

  const features = [
    {
      icon: Layers, color: 'blue',
      title: zh ? '知识空间（Space）' : 'Knowledge Spaces',
      design: zh ? '按项目、团队或主题隔离知识。每个 Space 拥有独立的成员列表、发布策略和审核流。Space 之间数据完全隔离，Agent 必须以 Reader、Editor 或 Publisher 角色显式接入。Publisher 自动发布仍受 Space 发布策略限制。' : 'Isolate knowledge by project, team, or topic. Each Space has its own member list, publishing policy, and review flow. Spaces are fully data-isolated; Agents connect explicitly as Reader, Editor, or Publisher. Publisher auto-publishing remains subject to Space policy.',
      usage: zh ? ['在 Dashboard 点击「创建空间」', '在 Space 设置中选择审核策略（always-review 或 scoped-auto-publish）', '在 Members 页面添加人类成员或 Agent 成员', '为 Agent 选择 Reader、Editor 或 Publisher'] : ['Click "Create Space" in the Dashboard', 'Choose the approval policy in Space settings', 'Add human or Agent members in the Members page', 'Choose Reader, Editor, or Publisher for the Agent'],
    },
    {
      icon: FileText, color: 'indigo',
      title: zh ? '页面与文档' : 'Pages & Documents',
      design: zh ? 'Markdown 编写，实时预览，所见即所得。支持层级目录树、双向链接、版本历史和多人协作编辑。每次保存生成不可变版本快照，可随时回溯、对比和恢复。' : 'Markdown with live WYSIWYG preview, hierarchical page tree, bidirectional links, version history, and collaborative editing. Each save creates an immutable version snapshot for rollback, diff, and restore.',
      usage: zh ? ['在 Space 内点击「新建页面」', '用 Markdown 编写内容，右侧实时预览', '通过 [[页面名]] 语法创建双向链接', '在版本历史中查看、对比或恢复任意版本'] : ['Click "New Page" inside a Space', 'Write in Markdown with live preview on the right', 'Use [[page name]] syntax for bidirectional links', 'View, diff, or restore any version in the version history'],
    },
    {
      icon: Network, color: 'purple',
      title: zh ? '知识图谱' : 'Knowledge Graph',
      design: zh ? '在页面之间建立带类型、来源、证据和置信度的语义关系。图谱可视化展示知识网络，支持按关系类型过滤和探索。每条边都可审计，追溯到具体页面和来源提交。' : 'Create typed semantic relationships between pages, each with provenance, evidence, and confidence. Visualize the network, filter by relationship type; every edge is auditable down to the page and source commit.',
      usage: zh ? ['在页面编辑器中用图谱面板添加关系', '选择关系类型（如 depends-on、relates-to、derived-from）', '在 Space 的图谱页面可视化浏览', '点击节点跳转到关联页面'] : ['Add relations via the graph panel in the page editor', 'Choose a relation type (e.g., depends-on, relates-to, derived-from)', 'Browse visually in the Space graph page', 'Click a node to jump to the related page'],
    },
    {
      icon: Search, color: 'green',
      title: zh ? '语义搜索' : 'Semantic Search',
      design: zh ? '基于向量嵌入的语义搜索，超越关键词字面匹配。用自然语言提问即可找到概念相关的页面。搜索范围始终受当前用户和 Agent 的权限约束，不会越权返回结果。' : 'Vector-embedding semantic search beyond literal keyword matching. Ask in natural language to find conceptually related pages. Search scope is always constrained by the current user/Agent permissions and never leaks unauthorized results.',
      usage: zh ? ['在顶部搜索栏用自然语言提问', '搜索结果按语义相关度排序', '结果仅包含你有权访问的 Space 的页面'] : ['Ask in natural language in the top search bar', 'Results are ranked by semantic relevance', 'Only pages in Spaces you can access appear'],
    },
    {
      icon: GitBranch, color: 'amber',
      title: zh ? '代码库知识摄取' : 'Codebase Ingestion',
      design: zh ? '从 Git 仓库或本地目录自动摄取代码与文档，生成结构化知识。保留完整的来源版本、文件路径和证据链，可追溯到具体提交。Agent 写入的内容来源可核对。' : 'Auto-ingest code and docs from Git repos or local directories into structured knowledge with full provenance, file paths, and evidence chains traceable to specific commits. Agent-written content sources can be verified.',
      usage: zh ? ['在 Space 的 Sources 页面添加 Git 仓库或本地路径', '系统自动扫描、解析并生成文档页面', '每个生成的页面附带来源 commit 和文件路径', '通过 knowledge_* 工具让 Agent 直接同步本地目录'] : ['Add a Git repo or local path in the Space Sources page', 'The system auto-scans, parses, and generates doc pages', 'Each generated page carries the source commit and file path', 'Use knowledge_* tools to let Agents sync local directories directly'],
    },
    {
      icon: CheckCircle2, color: 'emerald',
      title: zh ? '审核与变更集' : 'Review & ChangeSets',
      design: zh ? '所有 Agent 写入都记录在可审计的变更集（ChangeSet）中。Reader 不可写；Editor 写入进入待审核；仅当 Publisher 凭据、Publisher Space 授权与 Space 发布策略同时允许时，Publisher 写入才会自动发布，否则也进入待审核。Agent 永远不能执行人工审批或成员管理。' : 'All Agent writes are recorded in auditable ChangeSets. Reader cannot write; Editor writes enter pending review. Publisher writes auto-publish only when the Publisher Credential, Publisher Space Grant, and Space publishing policy all permit it; otherwise they also enter pending review. Agents can never perform human approval or member management.',
      usage: zh ? ['Editor 写入后，在审核页面查看待处理的 ChangeSet', 'Publisher 未满足全部自动发布条件时同样进入待审核', '由具备审批权的人类查看 diff 并接受或拒绝', '自动发布和人工决策都会保留审计记录'] : ['Review pending Editor ChangeSets after a write', 'Publisher changes also enter pending review when any auto-publish gate is missing', 'Authorized humans inspect diffs and accept or reject', 'Both auto-publishing and human decisions retain audit records'],
    },
    {
      icon: Brain, color: 'rose',
      title: zh ? '记忆（Memory）' : 'Memory',
      design: zh ? '按 Space 隔离的结构化记忆层，让 Agent 跨会话保留上下文。记忆写入同样受审核策略约束，不会绕过权限边界。避免 Agent 把不该存的信息写入共享记忆。' : 'A per-Space structured memory layer letting Agents retain context across sessions. Memory writes follow the same review policy and never bypass permission boundaries.',
      usage: zh ? ['Agent 通过 wiki_* 记忆工具读写 Space 记忆', '记忆按 Space 隔离，不同 Space 的记忆互不可见', '写入受审核策略约束（与其他写操作一致）'] : ['Agents read/write Space memory via wiki_* memory tools', 'Memory is Space-isolated; different Spaces cannot see each other', 'Writes follow the review policy (same as other write operations)'],
    },
  ];

  const colorMap: Record<string, { bg: string; text: string; border: string }> = {
    blue: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
    indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600', border: 'border-indigo-200' },
    purple: { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200' },
    green: { bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-200' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' },
    rose: { bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-200' },
  };

  return (
    <article className="prose prose-gray max-w-none">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{zh ? '功能详解' : 'Features in Depth'}</h1>
        <p className="text-gray-500 mb-10">{zh ? '每个功能模块的设计原理、使用方法和最佳实践' : 'Design rationale, usage, and best practices for each feature module'}</p>

        <div className="space-y-8">
          {features.map((f, i) => {
            const c = colorMap[f.color];
            const Icon = f.icon;
            return (
              <section key={i} className={`bg-white border ${c.border} rounded-xl p-6 not-prose`}>
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center shrink-0`}><Icon className={c.text} size={20} /></div>
                  <h2 className="text-xl font-bold text-gray-900">{f.title}</h2>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed mb-4">{f.design}</p>
                <div className={`${c.bg} rounded-lg p-4`}>
                  <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">{zh ? '使用方法' : 'How to use'}</p>
                  <ul className="space-y-1.5">
                    {f.usage.map((u, j) => (<li key={j} className="text-sm text-gray-600 flex items-start gap-2"><span className={`font-mono text-xs ${c.text} shrink-0 mt-0.5`}>{j + 1}.</span><span>{u}</span></li>))}
                  </ul>
                </div>
                {i < features.length - 1 && <div className="mt-6" />}
              </section>
            );
          })}
        </div>

        <div className="flex justify-between items-center pt-8 mt-8 border-t border-gray-200">
          <Link to="/guide/docs/architecture" className="text-sm text-gray-500 hover:text-gray-700">&larr; {zh ? '系统架构' : 'Architecture'}</Link>
          <Link to="/guide/docs/security" className="text-sm text-blue-600 hover:underline font-medium flex items-center gap-1">{zh ? '安全模型' : 'Security'} <ArrowRight size={14} /></Link>
        </div>
    </article>
  );
};
