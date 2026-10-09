import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { resolveAssistTarget, type AssistTarget } from './assistTargets';
import { notesForDispatch, type PersonalNote } from './reviewComments';
interface Props {
  stageForSession?: boolean; source: string; target?: AssistTarget | null; notes: PersonalNote[]; disabled?: boolean; storageUnavailable?: boolean;
  onAdd: (target: AssistTarget, body: string) => boolean | void;
  onDispatch: (ids: string[]) => void;
  onReopen: (id: string) => void;
}
type NoteFilter = 'all' | 'open' | 'resolved';
/** Controlled queue: parent persists notes and transitions only after task responses / explicit acceptance. */
export function PersonalNotesPanel({ stageForSession = false, source, target, notes, disabled, storageUnavailable, onAdd, onDispatch, onReopen }: Props) {
  const { language } = useLanguage(); const zh = language === 'zh-CN';
  const [body, setBody] = useState(''); const [addFailed, setAddFailed] = useState(false); const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<NoteFilter>('open');
  const visible = useMemo(() => notes.filter((note) => filter === 'all' || (filter === 'resolved' ? note.status === 'resolved' : note.status !== 'resolved'))
    .map((note) => ({ note, found: resolveAssistTarget(source, note.target).status === 'found' })), [notes, source, filter]);
  const eligibleIds = useMemo(() => visible.filter(({ note, found }) => note.status === 'pending' && found).map(({ note }) => note.id), [visible]);
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
  const anchorUnavailable = !!target && resolveAssistTarget(source, target).status !== 'found';
  const canAdd = !disabled && !!target && target.quote.length > 0 && !anchorUnavailable && !!body.trim();
  const dispatch = notesForDispatch(notes, selectedEligible, source);
  const showComposer = !!target || body.length > 0;
  const empty = filter === 'resolved' ? (zh ? '暂无已解决笔记。' : 'No resolved notes yet.') : filter === 'open'
    ? (zh ? '暂无未解决笔记，可在“已解决”筛选中查看已解决笔记。' : 'No open notes. Resolved notes are available in the Resolved filter.')
    : (zh ? '暂无个人笔记，选择一段原文开始添加。' : 'No personal notes yet. Select a passage to add one.');
  return <section aria-label={zh ? '个人笔记' : 'Personal notes'} className="min-w-0 space-y-3 rounded-[14px] border border-gray-200 bg-white p-4 text-sm">
    <h3 className="font-semibold">{zh ? '个人笔记' : 'Personal notes'}</h3>
    <p className="text-gray-500">{zh ? '私人笔记，仅保存在此浏览器，按账号、Space 和页面隔离。发送所选笔记后 Agent 可见其内容。' : 'Private notes, stored only in this browser per account, Space and page. The Agent can see selected notes after you send them.'}</p>
    {storageUnavailable ? <p role="status" className="text-amber-800">{zh ? '无法保存个人笔记，请保留副本。' : 'Personal notes could not be saved. Keep a copy.'}</p> : null}
    {target ? <blockquote className="max-h-24 overflow-y-auto whitespace-pre-wrap border-l-2 pl-3 text-gray-600 [overflow-wrap:anywhere]">{target.quote}</blockquote> : <p className="text-gray-500">{zh ? '选择一段原文添加笔记。' : 'Select a passage to add a note.'}</p>}
    {addFailed || anchorUnavailable ? <p role="alert" className="text-amber-800">{zh ? '原文定位不唯一或版本已变化。请选择更长或当前的原文片段后重试，笔记文字已保留。' : 'The source anchor is ambiguous or changed. Select a longer or current excerpt and retry; your note text is preserved.'}</p> : null}
    {showComposer ? <div className="space-y-2">
      <label className="block">{zh ? '笔记' : 'Note'}<textarea rows={3} value={body} onChange={(e) => { setBody(e.target.value); setAddFailed(false); }} disabled={disabled} className="mt-1 max-h-48 w-full rounded-lg border border-gray-200 p-3 [overflow-wrap:anywhere]" /></label>
      <button type="button" disabled={!canAdd} onClick={() => { if (canAdd && target) { if (onAdd(target, body.trim()) === false) setAddFailed(true); else { setBody(''); setAddFailed(false); } } }} className="min-h-8 rounded-lg border border-gray-200 px-3 disabled:opacity-50">{zh ? '添加笔记' : 'Add note'}</button>
    </div> : null}
    <div role="group" aria-label={zh ? '筛选笔记' : 'Filter notes'} className="flex flex-wrap gap-2">
      {filters.map(({ id, label, count }) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => { if (filter !== id) { setSelected([]); setFilter(id); } }} className={`min-h-8 rounded-lg border border-gray-200 px-3 ${filter === id ? 'border-gray-900 bg-gray-100 font-medium text-gray-900' : 'border-gray-200 text-gray-600'}`}>{`${label} (${count})`}</button>)}
    </div>
    <div className="space-y-2 rounded-lg bg-gray-50 p-3">
      <p role="status" className="text-gray-600">{zh ? `已选 ${selectedEligible.length} 条可发送笔记` : `${selectedEligible.length} eligible ${selectedEligible.length === 1 ? 'note' : 'notes'} selected`}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled || eligibleIds.length === 0} onClick={() => { if (!disabled) setSelected(eligibleIds); }} className="min-h-8 rounded-lg border border-gray-200 px-3 disabled:opacity-50">{zh ? '全选可发送笔记' : 'Select all eligible'}</button>
        <button type="button" disabled={disabled || selectedEligible.length === 0} onClick={() => { if (!disabled) setSelected([]); }} className="min-h-8 rounded-lg border border-gray-200 px-3 disabled:opacity-50">{zh ? '清除选择' : 'Clear selection'}</button>
        <button type="button" disabled={disabled || dispatch.status !== 'ready'} onClick={() => { if (!disabled && dispatch.status === 'ready') onDispatch(dispatch.notes.map((n) => n.id)); }} className="min-h-8 rounded-lg bg-gray-900 px-3 py-1 text-white disabled:opacity-50">{stageForSession ? (zh ? '加入 Agent 待发送' : 'Stage selected for Agent') : (zh ? '发送所选笔记给 Agent' : 'Send selected to Agent')}</button>
      </div>
    </div>
    {visible.length === 0 ? <p className="rounded-lg border border-dashed border-gray-200 p-3 text-gray-500">{empty}</p> : null}
    <ul className="space-y-3">{visible.map(({ note, found }) => {
      return <li key={note.id} className="space-y-1 border-t pt-3">
        <label className="flex min-w-0 items-start gap-2"><input type="checkbox" aria-label={note.body} checked={selectedEligible.includes(note.id)} disabled={disabled || note.status !== 'pending' || !found} onChange={(e) => { if (!disabled && eligibleIds.includes(note.id)) setSelected((ids) => e.target.checked ? [...ids.filter((id) => eligibleIds.includes(id) && id !== note.id), note.id] : ids.filter((id) => id !== note.id)); }} className="mt-1 shrink-0" /><span className="max-h-40 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]">{note.body}</span></label>
        <blockquote className="max-h-24 overflow-y-auto whitespace-pre-wrap border-l-2 pl-3 text-gray-500 [overflow-wrap:anywhere]">{note.target.quote}</blockquote>
        <p className="w-fit rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{labels[note.status]}</p>
        {!found ? <p className="text-amber-800">{zh ? '原文已变动或定位不唯一' : 'Original passage changed or anchor is ambiguous'}</p> : null}
        {note.status !== 'pending' ? <button type="button" disabled={disabled} onClick={() => onReopen(note.id)} className="h-8 rounded-lg border border-gray-200 px-3">{zh ? '重新打开' : 'Reopen'}</button> : null}
      </li>;
    })}</ul>
  </section>;
}
