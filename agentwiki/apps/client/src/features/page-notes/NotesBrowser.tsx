import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { NativeSelect } from '../../components/NativeSelect';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useNotesDiscovery } from './useNotesDiscovery';
import { defaultNotesFilters, noteSourcePath, notesFiltersParams, parseNotesFilters, type NotesFilters } from './notesSearchState';

export interface NotesBrowserProps { spaceId: string; currentPage?: { id: string; title: string; openCount: number }; onReturnToCurrent?: () => void; embedded?: boolean }
export function NotesBrowser(props: NotesBrowserProps) {
  const { user, token } = useAuth();
  return <AuthenticatedNotesBrowser key={`${user?.id ?? ''}:${token ?? ''}:${props.spaceId}:${!!props.embedded}`} {...props} userId={user?.id ?? ''} token={token ?? ''} />;
}
function readEmbeddedFilters(key: string): NotesFilters {
  try { return parseNotesFilters(new URLSearchParams(sessionStorage.getItem(key) ?? '')); } catch { return defaultNotesFilters(); }
}
interface NotesResume { pages: number; noteId: string; expiresAt: number; truncated?: boolean }
function readResume(key: string): NotesResume | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    return value && Number.isInteger(value.pages) && value.pages >= 1 && value.pages <= 5 && typeof value.noteId === 'string' && value.noteId.length <= 200 && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now() ? value : null;
  } catch { return null; }
}
function AuthenticatedNotesBrowser({ spaceId, currentPage, onReturnToCurrent, embedded = false, userId, token }: NotesBrowserProps & { userId: string; token: string }) {
  const { language } = useLanguage(), zh = language === 'zh-CN';
  const [params, setParams] = useSearchParams();
  const storageKey = `agentwiki.notes-discovery.v1:${encodeURIComponent(userId)}:${encodeURIComponent(spaceId)}`;
  const [embeddedFilters, setEmbeddedFilters] = useState(() => readEmbeddedFilters(storageKey));
  const filters = embedded ? embeddedFilters : parseNotesFilters(params);
  const [draftQuery, setDraftQuery] = useState(filters.query);
  useEffect(() => { setDraftQuery(filters.query); }, [filters.query]);
  const changeFilters = (change: Partial<NotesFilters>) => {
    const next = { ...filters, ...change };
    if (embedded) {
      setEmbeddedFilters(next);
      try { sessionStorage.setItem(storageKey, notesFiltersParams(next).toString()); } catch { /* The current view still works without browser storage. */ }
    } else setParams(notesFiltersParams(next), { replace: true });
  };
  const data = useNotesDiscovery(`${userId}:${token}`, { spaceId: filters.scope === 'space' ? spaceId : undefined, author: filters.author, status: filters.status, query: filters.query || undefined }, !!userId && !!token);
  const returnPath = `/spaces/${encodeURIComponent(spaceId)}/notes?${notesFiltersParams(filters)}`;
  const resumeKey = `agentwiki.notes-discovery.resume.v1:${encodeURIComponent(userId)}:${returnPath}`;
  const resume = useMemo(() => readResume(resumeKey), [resumeKey]);
  const [restoreLimited, setRestoreLimited] = useState(false);
  const restoration = useRef({ key: resumeKey, done: false, attempts: 0 }), cards = useRef(new Map<string, HTMLLIElement>());
  if (restoration.current.key !== resumeKey) { restoration.current = { key: resumeKey, done: false, attempts: 0 }; setRestoreLimited(false); }
  useEffect(() => {
    if (!resume || data.error || data.loading || !data.loaded || restoration.current.done) return;
    if (data.pagesLoaded < resume.pages && data.nextCursor) {
      if (restoration.current.attempts < 4) { restoration.current.attempts++; void data.loadMore(); return; }
      restoration.current.done = true; setRestoreLimited(true); return;
    }
    restoration.current.done = true;
    cards.current.get(resume.noteId)?.scrollIntoView?.({ block: 'center' });
  }, [resume, resumeKey, data]);
  const rememberPosition = (noteId: string) => {
    try { sessionStorage.setItem(resumeKey, JSON.stringify({ pages: Math.min(5, data.pagesLoaded), truncated: data.pagesLoaded > 5, noteId, expiresAt: Date.now() + 10 * 60_000 })); } catch { /* Search remains usable without restoration storage. */ }
  };
  const statusLabels = zh ? { pending: '待处理', dispatched: '已发送', 'awaiting-review': '等待审阅', resolved: '已解决' } : { pending: 'Pending', dispatched: 'Dispatched', 'awaiting-review': 'Awaiting review', resolved: 'Resolved' };
  const dateLabel = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? (zh ? '更新时间未知' : 'Update time unavailable') : new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  };
  return <section aria-label={zh ? '全部笔记' : 'All notes'} className={`min-w-0 space-y-4 ${embedded ? 'p-3' : 'mx-auto w-full max-w-5xl p-4 sm:p-6'}`}>
    <header className="space-y-1">
      <h2 className="text-lg font-semibold text-gray-900">{zh ? '全部笔记' : 'All notes'}</h2>
      <p className="text-xs leading-relaxed text-gray-500">{zh ? '查找有访问权限页面中的共享笔记。仅原作者可修改笔记。' : 'Find shared notes on pages you can access. Only their author can change them.'}</p>
    </header>
    {currentPage ? <aside className="space-y-1 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm">
      <p className="break-words font-medium text-gray-800">{currentPage.title}</p>
      <p className="text-xs text-gray-600">{zh ? `当前页面 ${currentPage.openCount} 条未解决笔记` : `${currentPage.openCount} open notes on this page`}</p>
      {onReturnToCurrent ? <button type="button" onClick={onReturnToCurrent} className="min-h-8 text-xs font-medium text-blue-700 hover:underline">{zh ? '回到本页' : 'Return to this page'}</button> : null}
    </aside> : null}
    <form role="search" className="flex min-w-0 gap-2" onSubmit={event => { event.preventDefault(); changeFilters({ query: draftQuery.trim().slice(0, 200) }); }}>
      <input type="search" aria-label={zh ? '搜索笔记、引用或页面名称' : 'Search notes, quotes or page titles'} maxLength={200} value={draftQuery} onChange={event => setDraftQuery(event.target.value)} placeholder={zh ? '搜索笔记、引用、页面名称' : 'Search notes, quotes, page titles'} className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      <button type="submit" className="min-h-10 shrink-0 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700">{zh ? '搜索' : 'Search'}</button>
    </form>
    <div className="grid min-w-0 grid-cols-3 gap-2">
      <label className="min-w-0 space-y-1 text-xs text-gray-600"><span>{zh ? '范围' : 'Scope'}</span><NativeSelect aria-label={zh ? '笔记范围' : 'Note scope'} value={filters.scope} onChange={event => changeFilters({ scope: event.target.value as NotesFilters['scope'] })} className="w-full"><option value="space">{zh ? '当前空间' : 'This space'}</option><option value="all">{zh ? '全部空间' : 'All spaces'}</option></NativeSelect></label>
      <label className="min-w-0 space-y-1 text-xs text-gray-600"><span>{zh ? '作者' : 'Author'}</span><NativeSelect aria-label={zh ? '笔记作者' : 'Note author'} value={filters.author} onChange={event => changeFilters({ author: event.target.value as NotesFilters['author'] })} className="w-full"><option value="all">{zh ? '全部作者' : 'All authors'}</option><option value="me">{zh ? '我写的' : 'Written by me'}</option><option value="mentioned">{zh ? '@我' : 'Mentioning me'}</option></NativeSelect></label>
      <label className="min-w-0 space-y-1 text-xs text-gray-600"><span>{zh ? '状态' : 'Status'}</span><NativeSelect aria-label={zh ? '笔记状态' : 'Note status'} value={filters.status} onChange={event => changeFilters({ status: event.target.value as NotesFilters['status'] })} className="w-full"><option value="all">{zh ? '全部状态' : 'All statuses'}</option><option value="open">{zh ? '未解决' : 'Open'}</option><option value="resolved">{zh ? '已解决' : 'Resolved'}</option></NativeSelect></label>
    </div>
    {!userId || !token ? <p role="status" className="text-sm text-gray-500">{zh ? '请登录后查看笔记。' : 'Sign in to view notes.'}</p> : <>
      <p role="status" className="text-xs text-gray-500">{data.loading ? (zh ? '正在加载笔记…' : 'Loading notes…') : data.loaded && !data.error ? (zh ? `找到 ${data.total} 条笔记` : `${data.total} notes found`) : ''}</p>
      {data.error ? <div role="alert" className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>{zh ? '无法加载笔记，请重试。' : 'Could not load notes. Please try again.'}</p><button type="button" disabled={data.loading} onClick={data.retry} className="min-h-8 underline">{zh ? '重试' : 'Retry'}</button></div> : null}
      {data.loaded && !data.loading && !data.error && data.notes.length === 0 ? <div className="space-y-2 rounded-lg border border-dashed border-gray-300 p-5 text-sm text-gray-500"><p>{zh ? '没有符合筛选条件的笔记。' : 'No notes match these filters.'}</p><button type="button" onClick={() => changeFilters(defaultNotesFilters())} className="min-h-8 text-blue-700 hover:underline">{zh ? '清除筛选' : 'Clear filters'}</button></div> : null}
      {restoreLimited ? <p role="status" className="text-xs text-gray-500">{zh ? '恢复期间结果发生变化，请搜索以定位笔记。' : 'Results changed during restoration. Search to locate the note.'}</p> : null}
      {resume?.truncated && data.loaded && !data.loading && data.pagesLoaded >= resume.pages ? <p role="status" className="text-xs text-gray-500">{zh ? '已恢复前 5 页结果。请搜索以定位更早记录。' : 'Restored the first 5 pages. Search to find older notes.'}</p> : null}
      <ul className="space-y-3">{data.notes.map(note => <li key={note.id} ref={element => { if (element) cards.current.set(note.id, element); else cards.current.delete(note.id); }} className="min-w-0 space-y-2 rounded-xl border border-gray-200 bg-white p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 break-words text-xs font-medium text-gray-600">{note.space.name}</p><span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{statusLabels[note.status]}</span></div>
        <Link onClick={() => rememberPosition(note.id)} to={noteSourcePath(note.pageId, note.id, spaceId, filters)} aria-label={`${zh ? '打开来源页面' : 'Open source page'}: ${note.page.title}`} className="block break-words text-sm font-semibold text-blue-700 hover:underline">{note.page.title}</Link>
        {note.pageId === currentPage?.id ? <span className="inline-block rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{zh ? '当前页' : 'Current page'}</span> : null}
        {note.page.folderPath.length ? <p className="break-words text-xs text-gray-500">{note.page.folderPath.join(' / ')}</p> : null}
        <p className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-gray-500"><span>{note.author.name || (zh ? '未命名作者' : 'Unnamed author')}</span>{note.author.type === 'agent' ? <span>Agent</span> : null}<time dateTime={note.updatedAt}>{dateLabel(note.updatedAt)}</time></p>
        <blockquote className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md border-l-2 border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500 [overflow-wrap:anywhere]">{note.target.quote}</blockquote>
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-gray-800 [overflow-wrap:anywhere]">{note.body}</p>
      </li>)}</ul>
      {data.nextCursor ? <button type="button" disabled={data.loading} onClick={data.loadMore} className="min-h-10 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">{zh ? '加载更多' : 'Load more'}</button> : data.notes.length > 0 && !data.error ? <p className="text-center text-xs text-gray-400">{zh ? '已显示全部结果' : 'All results shown'}</p> : null}
    </>}
  </section>;
}
