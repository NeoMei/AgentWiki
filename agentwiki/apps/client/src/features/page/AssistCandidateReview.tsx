import { useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { MarkdownDiff, MarkdownDiffPreviewWarning } from '../../components/markdown-diff/MarkdownDiff';
import { diffLines } from '../../components/markdown-diff/lineDiff';
import type { AssistCandidate } from './assistCandidate';

export function AssistCandidateReview({ candidate, canEdit, onAccept, onDiscard, supportsScopedApply = false }: {
  candidate: AssistCandidate; canEdit: boolean; supportsScopedApply?: boolean; onAccept: (editId?: string) => void; onDiscard: () => void;
}) {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const independent = supportsScopedApply && candidate.editPlan && !candidate.editPlan.indivisible && candidate.editPlan.edits.length > 0;
  const truncated = useMemo(() => independent ? diffLines(candidate.baseContent, candidate.content).truncated : false, [independent, candidate.baseContent, candidate.content]);
  const accepted = candidate.editPlan?.edits.filter((edit) => candidate.acceptedEditIds?.includes(edit.id)).length ?? 0;
  const messages = {
    generating: zh ? '正在生成候选，正文不会自动改动。' : 'Generating a candidate. Your draft stays unchanged.',
    ready: zh ? '候选待审阅，接受后仍需保存页面。' : 'Review this candidate. Accepting to draft still requires Save.',
    accepted: zh ? '已接受到草稿' : 'Accepted to draft',
    discarded: zh ? '已丢弃' : 'Discarded',
    conflict: zh ? '页面、权限、版本或草稿已变化，请重新生成。候选仍可查看。' : 'Page, permissions, version or draft changed. Please regenerate. You can still review the candidate.',
    failed: zh ? '生成失败，正文未改动。' : 'Generation failed. Your draft is unchanged.',
    empty: zh ? '助手没有返回有效内容，正文未改动。' : 'Assistant returned no usable content. Your draft is unchanged.',
  };
  const active = candidate.status === 'ready' || candidate.status === 'conflict' || candidate.status === 'generating';
  const editButton = (id: string, index: number) => <button key={id} type="button" aria-label={zh ? `接受变更 ${index + 1}` : `Accept change ${index + 1}`} disabled={!canEdit || candidate.status !== 'ready' || candidate.acceptedEditIds?.includes(id)} onClick={() => onAccept(id)} className="mt-2 rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">{candidate.acceptedEditIds?.includes(id) ? (zh ? '已接受' : 'Accepted') : (zh ? `接受变更 ${index + 1}` : `Accept change ${index + 1}`)}</button>;
  const download = (text: string, name: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
  };
  return <section className="mt-2 space-y-2" aria-label={zh ? '候选审阅' : 'Candidate review'}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-medium text-gray-800">{zh ? '候选审阅' : 'Candidate review'}</h3>
      {independent ? <p className="text-xs text-gray-600">{zh ? `已接受 ${accepted} / ${candidate.editPlan!.edits.length} 项变更` : `${accepted} of ${candidate.editPlan!.edits.length} changes accepted`}</p> : null}
    </div>
    <p role={candidate.status === 'conflict' || candidate.status === 'empty' || candidate.status === 'failed' ? 'alert' : 'status'} className="text-xs text-gray-700">{messages[candidate.status]}</p>
    {candidate.summary ? <p className="text-xs text-gray-600">{candidate.summary}</p> : null}
    {independent ? <div className="space-y-2">
      <p className="text-xs text-gray-500">{zh ? '可逐项接受独立变更，每次都会核对当前草稿。' : 'Accept independent changes one at a time; each acceptance checks the current draft.'}</p>
      {candidate.editPlan!.edits.map((edit, index) => <div key={edit.id} className="space-y-2 rounded-lg border border-gray-200 p-2">
        <h4 className="text-xs font-medium text-gray-800">{zh ? `变更 ${index + 1}` : `Change ${index + 1}`}</h4>
        <MarkdownDiff before={edit.before} after={edit.after} />
        {editButton(edit.id, index)}
      </div>)}
    </div> : candidate.content ? <>
      {candidate.editPlan?.indivisible && supportsScopedApply ? <p className="text-xs text-gray-500">{zh ? '此候选作为一项整体变更接受。' : 'This candidate is accepted as one indivisible change.'}</p> : null}
      <MarkdownDiff before={candidate.baseContent} after={candidate.content} />
      {candidate.editPlan?.indivisible && supportsScopedApply ? <div className="flex flex-wrap gap-2">{candidate.editPlan.edits.map((edit, index) => editButton(edit.id, index))}</div> : null}
    </> : null}
    {independent ? <>
      <MarkdownDiffPreviewWarning truncated={truncated} />
      <details className="rounded-lg border border-gray-200 p-2">
        <summary className="cursor-pointer text-xs text-gray-600">{zh ? '整篇文档对比' : 'Full-document comparison'}</summary>
        <div className="mt-2"><MarkdownDiff before={candidate.baseContent} after={candidate.content} showWarning={false} /></div>
      </details>
    </> : null}
    {candidate.content ? <div className="flex flex-wrap gap-2 text-xs">
      <button type="button" onClick={() => download(candidate.baseContent, 'assist-original.md')}>{zh ? '下载原文' : 'Download original'}</button>
      <button type="button" onClick={() => download(candidate.content, 'assist-candidate.md')}>{zh ? '下载候选' : 'Download candidate'}</button>
    </div> : null}
    {active ? <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!canEdit || candidate.status !== 'ready'} onClick={() => onAccept()} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-40">{zh ? '接受到草稿' : 'Accept to draft'}</button>
      <button type="button" onClick={onDiscard} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs">{zh ? '丢弃' : 'Discard'}</button>
    </div> : null}
  </section>;
}
