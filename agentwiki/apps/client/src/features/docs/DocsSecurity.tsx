import React from 'react';
import { Link } from 'react-router-dom';
import { Key, Shield, Users, Lock, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

export const DocsSecurity: React.FC = () => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  return (
    <article className="prose prose-gray max-w-none">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{zh ? '安全模型' : 'Security Model'}</h1>
        <p className="text-gray-500 mb-10">{zh ? '统一 Agent 角色、Space 治理、审核流与审计追踪' : 'Unified Agent roles, Space governance, review flow, and audit trails'}</p>

        <h2 className="text-2xl font-bold text-gray-900 mb-3">{zh ? '三层权限交集' : 'Three-Layer Permission Intersection'}</h2>
        <p className="text-gray-600 leading-relaxed mb-6">
          {zh ? 'Agent 的有效权限是三层约束的交集。任何一层的收紧都会立即生效，确保最小权限原则：' : 'Effective Agent permission is the intersection of three constraint layers. Tightening any layer takes effect immediately, enforcing least-privilege:'}
        </p>

        <div className="space-y-4 mb-8 not-prose">
          <div className="bg-white border border-blue-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-2"><Key className="text-blue-600" size={20} /><h3 className="font-semibold text-gray-900">{zh ? '凭据角色' : 'Credential Role'}</h3></div>
            <p className="text-sm text-gray-600 leading-relaxed mb-2">{zh ? '接入时从 Reader、Editor、Publisher 中选择一次角色；连接兑换会在内部生成同角色凭据，作为该连接的能力上限。产品入口不提供第二套凭据授权或逐项 scopes 配置。' : 'Choose Reader, Editor, or Publisher once when connecting. The exchange creates an internal Credential with the same role as that connection ceiling. Product entry points expose neither a second credential-authorization flow nor individual scopes.'}</p>
            <p className="text-sm text-gray-600 leading-relaxed">{zh ? '撤销操作只撤销该凭据对应的连接；现有会话、其他有效连接与 Space Grant 各自独立。暂停或撤销 Agent 才是全局停止。凭据密钥只在连接兑换时交付，之后不可读取。' : 'Revoking a credential revokes only that credential and its connection; existing sessions, other active connections, and Space Grants remain independent. Pausing or revoking the Agent is the global stop. The credential secret is delivered only during connection exchange and cannot be read again.'}</p>
          </div>
          <div className="bg-white border border-purple-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-2"><Shield className="text-purple-600" size={20} /><h3 className="font-semibold text-gray-900">{zh ? 'Space Agent 角色' : 'Space Agent Role'}</h3></div>
            <p className="text-sm text-gray-600 leading-relaxed">{zh ? 'Agent 在每个 Space 同样使用 Reader、Editor 或 Publisher。未授权的 Space 完全不可见；角色降级会立即收紧访问，一个 Agent 可在不同 Space 使用不同角色。' : 'Each Space also assigns the Agent Reader, Editor, or Publisher. Unauthorized Spaces are invisible; downgrades tighten access immediately, and one Agent can hold different roles in different Spaces.'}</p>
          </div>
          <div className="bg-white border border-green-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-2"><Users className="text-green-600" size={20} /><h3 className="font-semibold text-gray-900">{zh ? '审核策略（Approval Policy）' : 'Approval Policy'}</h3></div>
            <p className="text-sm text-gray-600 leading-relaxed mb-2">{zh ? 'Reader 不可写；Editor 写入进入待审核。Publisher 是否自动发布还取决于 Space 级发布策略：' : 'Reader cannot write, and Editor writes enter pending review. Publisher auto-publishing additionally depends on the Space publishing policy:'}</p>
            <ul className="text-sm text-gray-600 leading-relaxed list-disc pl-5 space-y-1">
              <li><code className="text-xs bg-gray-100 px-1 rounded">always-review</code> {zh ? '（默认）：Editor 与 Publisher 写入均进入审核队列，由具备审批权的人类决定。' : '(default): both Editor and Publisher writes enter the review queue for an authorized human to decide.'}</li>
              <li><code className="text-xs bg-gray-100 px-1 rounded">scoped-auto-publish</code> {zh ? '：仅当 Publisher 凭据、Publisher Space 授权与 Space 发布策略同时允许时自动发布；缺少任一条件都进入待审核。' : ': auto-publishing occurs only when the Publisher Credential, Publisher Space Grant, and Space publishing policy all permit it; a missing gate sends the change to pending review.'}</li>
            </ul>
            <p className="mt-3 text-sm text-gray-600 leading-relaxed">{zh ? 'Agent 永远不能执行人工审批或成员管理，也永远不具备 review:decide。' : 'Agents can never perform human approval or member management and never receive review:decide.'}</p>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-8">
          <div className="flex items-start gap-2"><Lock className="text-blue-600 shrink-0 mt-0.5" size={18} /><p className="text-sm text-blue-700 leading-relaxed"><strong>{zh ? '结论：' : 'Result: '}</strong>{zh ? '即使 Agent 凭据泄露，攻击面也仅限于已授权的最小范围。攻击者无法访问未授权的 Space，无法绕过审核策略，且所有操作都在审计日志中可追溯。' : 'even if a credential leaks, the attack surface is limited to the authorized minimum. An attacker cannot access unauthorized Spaces, cannot bypass review policy, and all operations are traceable in the audit log.'}</p></div>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-3">{zh ? '审核流（ChangeSet）' : 'Review Flow (ChangeSet)'}</h2>
        <p className="text-gray-600 leading-relaxed mb-4">{zh ? '每次获得授权的 Agent 写入（创建、更新、删除页面或图谱关系）都会形成可审计的变更集（ChangeSet）；它进入待审核还是自动发布，由角色与 Space 策略共同决定：' : 'Every authorized Agent write (create, update, delete pages or graph relations) creates an auditable ChangeSet. Its role and Space policy determine whether it enters pending review or auto-publishes:'}</p>
        <div className="space-y-3 mb-8 not-prose">
          {[
            zh ? 'Reader 无写入能力；Editor 写入进入待审核 ChangeSet' : 'Reader cannot write; Editor writes enter pending-review ChangeSets',
            zh ? 'Publisher 只有在凭据、Space 授权与发布策略全部允许时自动发布，否则进入待审核' : 'Publisher auto-publishes only when its Credential, Space Grant, and publishing policy all allow it; otherwise it enters pending review',
            zh ? '具备审批权的人类在审核页面查看待处理变更及完整 diff' : 'Authorized humans inspect pending changes and their complete diffs on the review page',
            zh ? '人类审批人可以逐项或整体接受、拒绝；Agent 永远没有 review:decide' : 'Human approvers can accept or reject items or the whole set; Agents never have review:decide',
            zh ? '自动发布与人工决策都记录到审计日志' : 'Both auto-publishing and human decisions are recorded in the audit log',
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
          <Link to="/guide/docs/features" className="text-sm text-gray-500 hover:text-gray-700">&larr; {zh ? '功能详解' : 'Features'}</Link>
          <Link to="/guide/docs/sync" className="text-sm text-blue-600 hover:underline font-medium flex items-center gap-1">{zh ? '同步工作流' : 'Sync Workflow'} <ArrowRight size={14} /></Link>
        </div>
    </article>
  );
};
