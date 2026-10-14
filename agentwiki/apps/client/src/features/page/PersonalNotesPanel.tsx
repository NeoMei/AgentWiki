import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { resolveAssistTarget } from './assistTargets';
import { notesForDispatch, type PersonalNote } from './reviewComments';
import { PersonalNoteAuthor } from './PersonalNoteAuthor';
interface Props {
  stageForSession?: boolean; source: string; notes: PersonalNote[]; disabled?: boolean; storageUnavailable?: boolean;
  syncing?: boolean;
  identityKey?: string;
  onRetrySync?: () => void;
  onDispatch: (ids: string[]) => void;
  onReopen: (id: string) => void;
  activeNoteId?: string | null;
  onLocate?: (id: string) => boolean | void;
  onClearActive?: () => void;
}
type NoteFilter = 'all' | 'open' | 'resolved';
/** Controlled queue: parent persists notes and transitions only after task responses / explicit acceptance. */
export function PersonalNotesPanel({ stageForSession = false, source, notes, disabled, storageUnavailable, syncing, identityKey, onRetrySync, onDispatch, onReopen, activeNoteId, onLocate, onClearActive }: Props) {
  const { language } = useLanguage(); const zh = language === 'zh-CN';
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<NoteFilter>('open');
  const [locationUnavailableId, setLocationUnavailableId] = useState<string | null>(null);
  const identityRef = useRef(identityKey);
  if (identityRef.current !== identityKey) { identityRef.current = identityKey; setSelected([]); }
  const cardRefs = useRef(new Map<string, HTMLLIElement>());
  useEffect(() => {
    const active = notes.find((note) => note.id === activeNoteId);
    if (!active) return;
    if (filter !== 'all' && (filter === 'resolved') !== (active.status === 'resolved')) {
      setSelected([]); setFilter('all');
    }
  }, [activeNoteId, notes]);
  const visible = useMemo(() => notes.filter((note) => filter === 'all' || (filter === 'resolved' ? note.status === 'resolved' : note.status !== 'resolved'))
    .map((note) => ({ note, found: resolveAssistTarget(source, note.target).status === 'found' })), [notes, source, filter]);
  const eligibleIds = useMemo(() => visible.filter(({ note, found }) => note.status === 'pending' && note.syncState !== 'unsynced' && found).map(({ note }) => note.id), [visible]);
  useEffect(() => {
    if (activeNoteId) cardRefs.current.get(activeNoteId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeNoteId, visible]);
  // Forget ineligible ids, rather than merely hiding their checked state: a later reopen must stay explicit.
  useEffect(() => {
    setSelected((ids) => {
      const next = ids.filter((id) => eligibleIds.includes(id));
      return next.length === ids.length ? ids : next;
    });
  }, [eligibleIds]);
  const selectedEligible = selected.filter((id) => eligibleIds.includes(id));
  const labels = { pending: zh ? '待处理' : 'Pending', dispatched: zh ? '已发送' : 'Dispatched', 'awaiting-review': zh ? '等待审阅' : 'Awaiting review', resolved: zh ? '已解决' : 'Resolved' };
  const filters: { id: NoteFilter; label: string; count: number }[] = [
    { id: 'all', label: zh ? '全部' : 'All', count: notes.length },
    { id: 'open', label: zh ? '未解决' : 'Open', count: notes.filter((note) => note.status !== 'resolved').length },
    { id: 'resolved', label: zh ? '已解决' : 'Resolved', count: notes.filter((note) => note.status === 'resolved').length },
  ];
  const dispatch = notesForDispatch(notes, selectedEligible, source);
  const empty = filter === 'resolved' ? (zh ? '暂无已解决笔记。' : 'No resolved notes yet.') : filter === 'open'
    ? (zh ? '暂无未解决笔记，可在“已解决”筛选中查看已解决笔记。' : 'No open notes. Resolved notes are available in the Resolved filter.')
    : (zh ? '暂无页面笔记，选择一段原文开始添加。' : 'No page notes yet. Select a passage to add one.');
  return <section aria-label={zh ? '页面笔记' : 'Page notes'} className="min-w-0 space-y-3 bg-white p-1 text-sm">
    <header className="space-y-1.5">
      <div className="flex items-center justify-between gap-2"><h3 className="font-semibold tracking-wide text-gray-700">{zh ? '页面笔记' : 'Page notes'}</h3><span className="rounded-lg bg-gray-100 px-2 py-1 text-xs tabular-nums text-gray-500">{notes.length}</span></div>
      <p className="text-xs text-gray-500">{zh ? '保存在服务器 · 有权限成员可见' : 'Saved on the server · Visible to page members'}</p>
      <p className="text-[11px] leading-relaxed text-gray-400">{zh ? '有页面访问权限的用户和 Agent 均可查看。笔记按作者区分，仅作者可修改。' : 'Users and Agents with page access can read these notes. Each note identifies its author; only the author can change it.'}</p>
    </header>
    {storageUnavailable ? <div role="status" className="space-y-1 text-xs text-amber-800"><p>{zh ? '部分笔记尚未同步到服务器，草稿已保留。' : 'Some notes have not synced to the server. Drafts are retained.'}</p>{onRetrySync ? <button type="button" disabled={syncing} onClick={onRetrySync} className="underline">{zh ? '重试同步' : 'Retry sync'}</button> : null}</div> : null}
    <div role="group" aria-label={zh ? '筛选笔记' : 'Filter notes'} className="flex rounded-lg bg-gray-100 p-1">
      {filters.map(({ id, label, count }) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => { if (filter !== id) { setSelected([]); setFilter(id); onClearActive?.(); } }} className={`min-h-8 min-w-0 flex-1 rounded-md px-2 text-xs ${filter === id ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>{`${label} (${count})`}</button>)}
    </div>
    <div className="space-y-1 border-b border-gray-100 pb-3">
      <div className="flex flex-wrap items-center gap-x-2 text-xs"><p role="status" className="mr-auto text-gray-500">{zh ? `已选 ${selectedEligible.length} 条可发送笔记` : `${selectedEligible.length} eligible ${selectedEligible.length === 1 ? 'note' : 'notes'} selected`}</p>
        <button type="button" disabled={disabled || eligibleIds.length === 0} onClick={() => { if (!disabled) setSelected(eligibleIds); }} className="min-h-8 rounded px-1 text-gray-500 hover:bg-gray-100 disabled:opacity-40">{zh ? '全选可发送笔记' : 'Select all eligible'}</button>
        <button type="button" disabled={disabled || selectedEligible.length === 0} onClick={() => { if (!disabled) setSelected([]); }} className="min-h-8 rounded px-1 text-gray-500 hover:bg-gray-100 disabled:opacity-40">{zh ? '清除选择' : 'Clear selection'}</button>
      </div>
      <button type="button" disabled={disabled || dispatch.status !== 'ready'} onClick={() => { if (!disabled && dispatch.status === 'ready') onDispatch(dispatch.notes.map((n) => n.id)); }} className="min-h-8 rounded-lg bg-gray-900 px-3 py-1 text-xs text-white disabled:opacity-40">{stageForSession ? (zh ? '加入 Agent 待发送' : 'Stage selected for Agent') : (zh ? '发送所选笔记给 Agent' : 'Send selected to Agent')}</button>
    </div>
    {visible.length === 0 ? <p className="rounded-lg border border-dashed border-gray-200 p-3 text-gray-500">{empty}</p> : null}
    <ul className="space-y-3">{visible.map(({ note, found }) => {
      return <li key={note.id} ref={(element) => { if (element) cardRefs.current.set(note.id, element); else cardRefs.current.delete(note.id); }} data-active-note={note.id === activeNoteId ? 'true' : undefined} className={`space-y-2 rounded-xl border p-3 transition-colors ${note.id === activeNoteId ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-200' : 'border-gray-200 bg-white'}`}>
        <div className="flex min-w-0 items-center gap-2"><input type="checkbox" aria-label={note.body} checked={selectedEligible.includes(note.id)} disabled={disabled || note.status !== 'pending' || note.syncState === 'unsynced' || !found} onChange={(e) => { if (!disabled && eligibleIds.includes(note.id)) setSelected((ids) => e.target.checked ? [...ids.filter((id) => eligibleIds.includes(id) && id !== note.id), note.id] : ids.filter((id) => id !== note.id)); }} className="shrink-0 accent-blue-500" />
          <span className="mr-auto rounded-md bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">{labels[note.status]}</span>
          {onLocate ? <button type="button" disabled={!found} onClick={() => { if (found) setLocationUnavailableId(onLocate(note.id) === false ? note.id : null); }} className="min-h-7 shrink-0 rounded px-1 text-xs text-gray-500 hover:bg-amber-100 hover:text-amber-800 disabled:opacity-40">{zh ? '定位原文' : 'Locate passage'}</button> : null}
        </div>
        <PersonalNoteAuthor userId={note.userId} author={note.author} language={language} />
        <blockquote className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs leading-relaxed text-gray-500 [overflow-wrap:anywhere]">{note.target.quote}</blockquote>
        <p className="max-h-40 min-w-0 overflow-y-auto whitespace-pre-wrap leading-relaxed text-gray-800 [overflow-wrap:anywhere]">{note.body}</p>
        {!found ? <p className="text-amber-800">{zh ? '原文已变动或定位不唯一' : 'Original passage changed or anchor is ambiguous'}</p> : null}
        {locationUnavailableId === note.id ? <p role="status" className="text-xs text-amber-800">{zh ? '此片段无法在当前视图定位，请查看原始 Markdown。' : 'This passage cannot be located in this view. Check the original Markdown.'}</p> : null}
        {note.syncState === 'unsynced' ? <p className="text-xs text-amber-700">{zh ? '尚未同步' : 'Not synced'}</p> : null}
        {note.status !== 'pending' && note.canEdit !== false ? <button type="button" disabled={disabled} onClick={() => onReopen(note.id)} className="h-8 rounded-lg border border-gray-200 px-3">{zh ? '重新打开' : 'Reopen'}</button> : null}
      </li>;
    })}</ul>
  </section>;
}
