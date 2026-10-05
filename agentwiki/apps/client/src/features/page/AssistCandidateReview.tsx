import { useLanguage } from '../../context/LanguageContext';
import { MarkdownDiff } from '../../components/markdown-diff/MarkdownDiff';
import type { AssistCandidate } from './assistCandidate';

export function AssistCandidateReview({ candidate, canEdit, onAccept, onDiscard }: {
  candidate: AssistCandidate; canEdit: boolean; onAccept: () => void; onDiscard: () => void;
}) {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
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
  const download = (text: string, name: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
  };
  return <section className="mt-2 space-y-2" aria-label={zh ? '候选审阅' : 'Candidate review'}>
    <p role={candidate.status === 'conflict' || candidate.status === 'empty' || candidate.status === 'failed' ? 'alert' : 'status'} className="text-xs text-gray-700">{messages[candidate.status]}</p>
    {candidate.summary ? <p className="text-xs text-gray-600">{candidate.summary}</p> : null}
    {candidate.content ? <MarkdownDiff before={candidate.baseContent} after={candidate.content} /> : null}
    {candidate.content ? <div className="flex flex-wrap gap-2 text-xs">
      <button type="button" onClick={() => download(candidate.baseContent, 'assist-original.md')}>{zh ? '下载原文' : 'Download original'}</button>
      <button type="button" onClick={() => download(candidate.content, 'assist-candidate.md')}>{zh ? '下载候选' : 'Download candidate'}</button>
    </div> : null}
    {active ? <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!canEdit || candidate.status !== 'ready'} onClick={onAccept} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-40">{zh ? '接受到草稿' : 'Accept to draft'}</button>
      <button type="button" onClick={onDiscard} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs">{zh ? '丢弃' : 'Discard'}</button>
    </div> : null}
  </section>;
}
