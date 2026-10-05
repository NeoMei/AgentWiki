import { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { resolveAssistTarget, type AssistTarget } from './assistTargets';
import { notesForDispatch, type PersonalNote } from './reviewComments';
interface Props {
  source: string; target?: AssistTarget | null; notes: PersonalNote[]; disabled?: boolean; storageUnavailable?: boolean;
  onAdd: (target: AssistTarget, body: string) => void;
  onDispatch: (ids: string[]) => void;
  onReopen: (id: string) => void;
}
/** Controlled queue: parent persists notes and transitions only after task responses / explicit acceptance. */
export function PersonalNotesPanel({ source, target, notes, disabled, storageUnavailable, onAdd, onDispatch, onReopen }: Props) {
  const { language } = useLanguage(); const zh = language === 'zh-CN';
  const [body, setBody] = useState(''); const [selected, setSelected] = useState<string[]>([]);
  const labels = { pending: zh ? '待处理' : 'Pending', dispatched: zh ? '已发送' : 'Dispatched', 'awaiting-review': zh ? '等待审阅' : 'Awaiting review', resolved: zh ? '已解决' : 'Resolved' };
  const canAdd = !disabled && !!target && target.quote.length > 0 && resolveAssistTarget(source, target).status === 'found' && !!body.trim();
  const dispatch = notesForDispatch(notes, selected, source);
  return <section aria-label={zh ? '个人笔记' : 'Personal notes'} className="space-y-3 rounded-[14px] border border-gray-200 bg-white p-4 text-sm">
    <h3 className="font-semibold">{zh ? '个人笔记' : 'Personal notes'}</h3>
    <p className="text-gray-500">{zh ? '私人笔记，仅保存在此浏览器，按账号、Space 和页面隔离。发送所选笔记后 Agent 可见其内容。' : 'Private notes, stored only in this browser per account, Space and page. The Agent can see selected notes after you send them.'}</p>
    {storageUnavailable ? <p role="status" className="text-amber-800">{zh ? '无法保存个人笔记，请保留副本。' : 'Personal notes could not be saved. Keep a copy.'}</p> : null}
    {target ? <blockquote className="max-h-24 overflow-auto whitespace-pre-wrap border-l-2 pl-3 text-gray-600">{target.quote}</blockquote> : <p className="text-gray-500">{zh ? '选择一段原文添加笔记。' : 'Select a passage to add a note.'}</p>}
    <label className="block">{zh ? '笔记' : 'Note'}<textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={disabled} className="mt-1 w-full rounded-lg border border-gray-200 p-3" /></label>
    <button type="button" disabled={!canAdd} onClick={() => { if (canAdd && target) { onAdd(target, body.trim()); setBody(''); } }} className="h-8 rounded-lg border px-3 disabled:opacity-50">{zh ? '添加笔记' : 'Add note'}</button>
    <ul className="space-y-3">{notes.map((note) => {
      const found = resolveAssistTarget(source, note.target).status === 'found';
      return <li key={note.id} className="space-y-1 border-t pt-3">
        <label className="flex items-start gap-2"><input type="checkbox" aria-label={note.body} checked={selected.includes(note.id)} disabled={disabled || note.status !== 'pending' || !found} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, note.id] : ids.filter((id) => id !== note.id))} /><span>{note.body}</span></label>
        <blockquote className="max-h-24 overflow-auto whitespace-pre-wrap border-l-2 pl-3 text-gray-500">{note.target.quote}</blockquote>
        <p className="text-gray-500">{labels[note.status]}</p>
        {!found ? <p className="text-amber-800">{zh ? '原文已变动或定位不唯一' : 'Original passage changed or anchor is ambiguous'}</p> : null}
        {note.status !== 'pending' ? <button type="button" disabled={disabled} onClick={() => onReopen(note.id)} className="h-8 rounded-lg border px-3">{zh ? '重新打开' : 'Reopen'}</button> : null}
      </li>;
    })}</ul>
    <button type="button" disabled={disabled || dispatch.status !== 'ready'} onClick={() => { if (dispatch.status === 'ready') onDispatch(dispatch.notes.map((n) => n.id)); }} className="h-8 rounded-lg bg-gray-900 px-3 text-white disabled:opacity-50">{zh ? '发送所选笔记给 Agent' : 'Send selected to Agent'}</button>
  </section>;
}
