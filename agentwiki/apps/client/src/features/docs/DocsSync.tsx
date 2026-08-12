import React from 'react';
import { Link } from 'react-router-dom';
import { Zap, ArrowRight } from 'lucide-react';
import { DocsLayout } from './DocsLayout';
import { useLanguage } from '../../context/LanguageContext';

export const DocsSync: React.FC = () => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';

  const steps = [
    {
      n: 1, tool: 'knowledge_prepare',
      title: zh ? '扫描（prepare）' : 'Scan (prepare)',
      desc: zh ? '在本地扫描源代码目录和文档文件，采集工件，组织成确定性的知识束（bundle）。识别新增、修改和删除的页面。全部在本地完成，零网络调用，不上传任何内容。' : 'Scan source directories and document files locally, collect artifacts, and organize them into a deterministic knowledge bundle. Identify added, modified, and deleted pages. Fully local with zero network calls; nothing is uploaded.',
      points: zh ? ['扫描前先排除含凭据特征的敏感文件', '生成内容哈希用于变更检测', '与本地基线比对计算 added/modified/deleted'] : ['Sensitive files with credential-like patterns are excluded before scanning', 'Content hashes are generated for change detection', 'Compared against the local baseline to compute added/modified/deleted'],
    },
    {
      n: 2, tool: 'knowledge_confirm_and_sync',
      title: zh ? '预览确认（confirm）' : 'Preview & Confirm',
      desc: zh ? '向用户展示完整的变更预览：added / modified / deleted / uploadBytes 统计和变更清单。用户明确确认后才开始上传。预览与确认之间绑定哈希，任何变化都会被发现。' : 'Present the full change preview to the user: added / modified / deleted / uploadBytes stats and a change list. Upload begins only after explicit confirmation. The preview is hash-bound; any change between preview and confirm is detected.',
      points: zh ? ['预览哈希防止确认前偷换内容', '必须有明确的 confirmed: true 才会执行', '未确认的预览有有效期，过期自动失效'] : ['Preview hash prevents bait-and-switch before confirmation', 'Requires explicit confirmed: true to proceed', 'Unconfirmed previews expire automatically'],
    },
    {
      n: 3, tool: 'knowledge_confirm_and_sync',
      title: zh ? '同步（sync）' : 'Sync',
      desc: zh ? 'Push 前先 Pull 服务端最新 Revision，执行三方合并检测。如果服务端版本在预览后发生了变化，或检测到真正的冲突，同步被拒绝并要求用户重新 prepare。绝不静默覆盖。' : 'Pull the latest server Revision before pushing and perform a three-way merge check. If the server version changed after the preview, or a real conflict is detected, the sync is rejected and the user must re-prepare. Never silently overwrites.',
      points: zh ? ['Push 前先 Pull，确保不基于过期版本', '真正的合并冲突必须人工解决', '成功后生成带来源 commit 和证据链的新版本'] : ['Pull before push to avoid working on a stale base', 'Real merge conflicts must be resolved by a human', 'Success produces a new version with source commit and evidence chain'],
    },
    {
      n: 4, tool: 'knowledge_pull',
      title: zh ? '拉取（pull）' : 'Pull',
      desc: zh ? '从服务端权威 Revision 刷新本地工作区，保持本地知识库与生产一致。支持多 Agent 协作场景下的增量更新——其他 Agent 发布的变更可以通过 pull 同步到本地。' : 'Refresh the local workspace from the authoritative server Revision, keeping the local knowledge base in sync with production. Supports incremental updates in multi-Agent scenarios—changes published by other Agents can be pulled locally.',
      points: zh ? ['以服务端 Revision 为权威版本', '本地工作区向其对齐', '支持增量更新，不需要全量重新扫描'] : ['The server Revision is authoritative', 'The local workspace aligns to it', 'Supports incremental updates without a full rescan'],
    },
  ];

  return (
    <DocsLayout>
      <article className="prose prose-gray max-w-none">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{zh ? '知识同步工作流' : 'Knowledge Sync Workflow'}</h1>
        <p className="text-gray-500 mb-10">{zh ? '扫描、预览、同步、拉取的确定性流程与冲突处理机制' : 'The deterministic scan, preview, sync, pull flow and conflict handling'}</p>

        <p className="text-gray-600 leading-relaxed mb-8">
          {zh ? '知识同步是 AgentWiki 连接本地代码与远程知识库的核心流程。它采用「先本地、后确认、再上传」的确定性设计，确保每一步都可预览、可回退、可审计，绝不静默覆盖他人或自己的工作。' : 'Knowledge sync is the core flow connecting local code to the remote knowledge base. It uses a "local first, confirm, then upload" deterministic design—every step is previewable, reversible, and auditable, never silently overwriting work.'}
        </p>

        <div className="space-y-6">
          {steps.map((s) => (
            <section key={s.n} className="bg-white border border-gray-200 rounded-xl p-6 not-prose">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0"><Zap className="text-amber-600" size={18} /></div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{s.title}</h2>
                  <code className="text-xs text-gray-400 font-mono">{s.tool}</code>
                </div>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed mb-4">{s.desc}</p>
              <ul className="space-y-1.5">
                {s.points.map((p, j) => (<li key={j} className="text-sm text-gray-600 flex items-start gap-2"><span className="text-amber-500 shrink-0 mt-0.5">&bull;</span><span>{p}</span></li>))}
              </ul>
            </section>
          ))}
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mt-8 mb-8">
          <p className="text-sm text-blue-700 leading-relaxed">
            <strong>{zh ? '设计原则：' : 'Design principle: '}</strong>
            {zh ? '服务端 Revision 始终是权威版本。本地工作区必须向其对齐，而不是反过来。这保证了多 Agent、多用户协作时不会出现「谁覆盖了谁」的问题——冲突总是在同步前被发现并要求人工解决。' : 'The server Revision is always authoritative. The local workspace aligns to it, not the other way around. This prevents "who overwrote whom" in multi-Agent, multi-user collaboration—conflicts are always detected before sync and require human resolution.'}
          </p>
        </div>

        <div className="flex justify-between items-center pt-8 border-t border-gray-200">
          <Link to="/docs/security" className="text-sm text-gray-500 hover:text-gray-700">&larr; {zh ? '安全模型' : 'Security'}</Link>
          <Link to="/guide" className="text-sm text-blue-600 hover:underline font-medium flex items-center gap-1">{zh ? '使用指南' : 'Guide'} <ArrowRight size={14} /></Link>
        </div>
      </article>
    </DocsLayout>
  );
};
