import { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import type { LocalDraft } from './localDrafts';

export const LocalDraftNotice = ({ offer, status, canRestore, busy, onRecover, onDiscard }: {
  offer: LocalDraft | null; status: string; canRestore: boolean; busy: boolean;
  onRecover: () => void; onDiscard: () => void;
}) => {
  const { language } = useLanguage();
  const [preview, setPreview] = useState(false);
  const zh = language === 'zh-CN';
  const statuses: Record<string, string> = {
    pending: zh ? '正在保存本机草稿…' : 'Saving draft on this device…',
    saved: zh ? '草稿已保存在本机，尚未保存到页面。' : 'Saved on this device. Page Save is still required.',
    'quota-exceeded': zh ? '本机存储已满，草稿未保存。请保存页面。' : 'Device storage is full. Draft was not saved; Save the page.',
    unavailable: zh ? '本机草稿存储不可用，请保存页面。' : 'Device draft storage is unavailable. Save the page.',
  };
  return <>
    {statuses[status] ? <p data-testid="local-draft-status" aria-live="polite" className="mb-3 text-sm text-gray-600">{statuses[status]}</p> : null}
    {offer ? <section aria-label={zh ? '本机草稿' : 'Local draft'} className="mb-3 rounded-lg border border-gray-200 p-3 text-sm">
      <p>{canRestore ? (zh ? '发现本机草稿，是否恢复到编辑区？' : 'A draft on this device is available to recover.') : (zh ? '此草稿基于旧版本或当前存在冲突，只可预览或导出。' : 'This draft has an older base or a current conflict. Preview or export it.')}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {canRestore ? <button type="button" disabled={busy} onClick={onRecover}>{zh ? '恢复本机草稿' : 'Recover local draft'}</button> : null}
        <button type="button" onClick={() => setPreview(!preview)}>{zh ? '预览本机草稿' : 'Preview local draft'}</button>
        <a href={`data:text/markdown;charset=utf-8,${encodeURIComponent(offer.content)}`} download={`${offer.title.replace(/[\\/:*?"<>|]/g, '_') || 'draft'}.md`}>{zh ? '导出本机草稿' : 'Export local draft'}</a>
        <button type="button" disabled={busy} onClick={onDiscard}>{zh ? '丢弃本机草稿' : 'Discard local draft'}</button>
      </div>
      {preview ? <div className="mt-3"><p className="font-medium">{offer.title}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{offer.content}</pre></div> : null}
    </section> : null}
  </>;
};
