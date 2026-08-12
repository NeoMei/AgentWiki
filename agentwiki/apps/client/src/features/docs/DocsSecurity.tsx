import React from 'react';
import { Link } from 'react-router-dom';
import { Key, Shield, Users, Lock, ArrowRight, CheckCircle2 } from 'lucide-react';
import { DocsLayout } from './DocsLayout';
import { useLanguage } from '../../context/LanguageContext';

export const DocsSecurity: React.FC = () => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  return (
    <DocsLayout>
      <article className="prose prose-gray max-w-none">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{zh ? '安全模型' : 'Security Model'}</h1>
        <p className="text-gray-500 mb-10">{zh ? '三层权限交集、审核流、凭据管理与审计追踪' : 'Three-layer permission intersection, review flow, credential management, and audit trails'}</p>

        <h2 className="text-2xl font-bold text-gray-900 mb-3">{zh ? '三层权限交集' : 'Three-Layer Permission Intersection'}</h2>
        <p className="text-gray-600 leading-relaxed mb-6">
          {zh ? 'Agent 的有效权限是三层约束的交集。任何一层的收紧都会立即生效，确保最小权限原则：' : 'Effective Agent permission is the intersection of three constraint layers. Tightening any layer takes effect immediately, enforcing least-privilege:'}
        </p>

        <div className="space-y-4 mb-8 not-prose">
          <div className="bg-white border border-blue-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-2"><Key className="text-blue-600" size={20} /><h3 className="font-semibold text-gray-900">{zh ? '凭据范围（Credential Scope）' : 'Credential Scope'}</h3></div>
            <p className="text-sm text-gray-600 leading-relaxed mb-2">{zh ? 'Agent 凭据的全局能力上限。创建凭据时设定，定义该凭据最多能做哪些操作。可在 Space 内进一步收窄，但不能超出。' : 'The global capability ceiling of an Agent credential, set at creation time. Defines the maximum set of operations. Can be narrowed per Space but never exceeded.'}</p>
            <p className="text-sm text-gray-600 leading-relaxed">{zh ? '凭据可随时吊销，吊销后该 Agent 在所有 Space 的访问立即失效。凭据的 API Key 只在创建时显示一次，之后不可读取。' : 'Credentials can be revoked at any time, immediately disabling the Agent across all Spaces. The API Key is shown only once at creation and cannot be read again.'}</p>
          </div>
          <div className="bg-white border border-purple-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-2"><Shield className="text-purple-600" size={20} /><h3 className="font-semibold text-gray-900">{zh ? '空间授权（Space Grant）' : 'Space Grant'}</h3></div>
            <p className="text-sm text-gray-600 leading-relaxed">{zh ? 'Agent 在某个 Space 内被授予的具体权限范围。未被授权的 Space 对 Agent 完全不可见——不出现在列表、搜索或图谱中。一个 Agent 可以在不同 Space 拥有不同权限。' : 'The specific scopes granted to an Agent within a Space. Unauthorized Spaces are completely invisible—not in lists, search, or the graph. One Agent can have different permissions across different Spaces.'}</p>
          </div>
          <div className="bg-white border border-green-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-2"><Users className="text-green-600" size={20} /><h3 className="font-semibold text-gray-900">{zh ? '审核策略（Approval Policy）' : 'Approval Policy'}</h3></div>
            <p className="text-sm text-gray-600 leading-relaxed mb-2">{zh ? 'Space 级别的写入策略，控制 Agent 写入是否需要人工审批：' : 'Space-level write policy controlling whether Agent writes need human approval:'}</p>
            <ul className="text-sm text-gray-600 leading-relaxed list-disc pl-5 space-y-1">
              <li><code className="text-xs bg-gray-100 px-1 rounded">always-review</code> {zh ? '（默认）：所有 Agent 写入进入审核队列，需人工逐项审批后发布。' : '(default): all Agent writes enter the review queue, published only after item-by-item human approval.'}</li>
              <li><code className="text-xs bg-gray-100 px-1 rounded">scoped-auto-publish</code> {zh ? '：符合 Space 策略的写入自动发布，其余仍需审核。适合信任度高的内部 Space。' : ': writes matching Space policy auto-publish; the rest still need review. For high-trust internal Spaces.'}</li>
            </ul>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-8">
          <div className="flex items-start gap-2"><Lock className="text-blue-600 shrink-0 mt-0.5" size={18} /><p className="text-sm text-blue-700 leading-relaxed"><strong>{zh ? '结论：' : 'Result: '}</strong>{zh ? '即使 Agent 凭据泄露，攻击面也仅限于已授权的最小范围。攻击者无法访问未授权的 Space，无法绕过审核策略，且所有操作都在审计日志中可追溯。' : 'even if a credential leaks, the attack surface is limited to the authorized minimum. An attacker cannot access unauthorized Spaces, cannot bypass review policy, and all operations are traceable in the audit log.'}</p></div>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-3">{zh ? '审核流（ChangeSet）' : 'Review Flow (ChangeSet)'}</h2>
        <p className="text-gray-600 leading-relaxed mb-4">{zh ? 'Agent 的每一次写入（创建、更新、删除页面或图谱关系）都不会直接生效，而是聚合成一个变更集（ChangeSet）：' : 'Every Agent write (create, update, delete pages or graph relations) does not take effect directly. Instead, it is aggregated into a ChangeSet:'}</p>
        <div className="space-y-3 mb-8 not-prose">
          {[
            zh ? 'Agent 调用 wiki_* 写入工具，操作进入待审核的 ChangeSet' : 'Agent calls a wiki_* write tool; the operation enters a pending ChangeSet',
            zh ? '审核人在审核页面看到完整的变更清单（含 diff）' : 'Approver sees the full change list (with diffs) on the review page',
            zh ? '审核人可以逐项接受或拒绝，也可以整体处理' : 'Approver can accept or reject item by item, or handle the whole set',
            zh ? '接受的操作发布到知识库并生成新版本；拒绝的操作被丢弃' : 'Accepted operations publish to the knowledge base with a new version; rejected ones are discarded',
            zh ? '所有决策（谁、何时、接受/拒绝什么）记录到审计日志' : 'All decisions (who, when, accept/reject what) are recorded to the audit log',
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3"><CheckCircle2 className="text-emerald-500 shrink-0 mt-0.5" size={16} /><p className="text-sm text-gray-600 leading-relaxed">{step}</p></div>
          ))}
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-3">{zh ? '审计与证据链' : 'Audit & Evidence Chain'}</h2>
        <p className="text-gray-600 leading-relaxed mb-4">{zh ? 'AgentWiki 为每次知识写入保留完整的证据链：' : 'AgentWiki retains a complete evidence chain for every knowledge write:'}</p>
        <ul className="text-gray-600 leading-relaxed list-disc pl-5 space-y-2 mb-8">
          <li>{zh ? '每个页面版本记录来源（人工编辑 / 哪个 Agent / 哪次同步）、时间戳和内容哈希。' : 'Each page version records its source (human edit / which Agent / which sync), timestamp, and content hash.'}</li>
          <li>{zh ? '图谱关系记录来源页面、证据文件和置信度。' : 'Graph relations record source page, evidence file, and confidence.'}</li>
          <li>{zh ? '代码摄取记录来源仓库、提交哈希和文件路径，可追溯到具体 commit。' : 'Code ingestion records source repo, commit hash, and file path, traceable to a specific commit.'}</li>
          <li>{zh ? '审核决策和凭据操作全部进入不可篡改的审计日志。' : 'Review decisions and credential operations all go to an immutable audit log.'}</li>
        </ul>

        <div className="flex justify-between items-center pt-8 border-t border-gray-200">
          <Link to="/docs/features" className="text-sm text-gray-500 hover:text-gray-700">&larr; {zh ? '功能详解' : 'Features'}</Link>
          <Link to="/docs/sync" className="text-sm text-blue-600 hover:underline font-medium flex items-center gap-1">{zh ? '同步工作流' : 'Sync Workflow'} <ArrowRight size={14} /></Link>
        </div>
      </article>
    </DocsLayout>
  );
};
