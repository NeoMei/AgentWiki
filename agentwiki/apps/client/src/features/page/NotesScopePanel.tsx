import { lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import type { PersonalNote } from './reviewComments';

const NotesBrowser = lazy(() => import('../page-notes/NotesBrowser').then(module => ({ default: module.NotesBrowser })));

/** Keep single-page writes mounted and isolated while browsing other pages' notes. */
export function NotesScopePanel({ spaceId, pageId, pageTitle, notes, activeNoteId, activation, children }: {
  spaceId: string; pageId: string; pageTitle: string; notes: PersonalNote[];
  activeNoteId?: string | null; activation?: object | null; children: ReactNode;
}) {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const prefix = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => { if (activeNoteId) setScope('current'); }, [activeNoteId, activation]);
  const views = [
    { id: 'current' as const, label: `${zh ? '当前页面' : 'Current page'} (${notes.length})` },
    { id: 'all' as const, label: zh ? '全部笔记' : 'All notes' },
  ];
  return <div className="min-w-0 space-y-3">
    <div role="tablist" aria-label={zh ? '笔记范围' : 'Note scope'} className="flex rounded-lg bg-gray-100 p-1">
      {views.map(({ id, label }, index) => <button key={id} type="button" role="tab"
        ref={element => { buttons.current[index] = element; }}
        id={`${prefix}-${id}`} aria-selected={scope === id} aria-controls={`${prefix}-${id}-panel`}
        tabIndex={scope === id ? 0 : -1} onClick={() => setScope(id)}
        onKeyDown={event => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? 1 - index : null;
          if (next === null) return;
          event.preventDefault(); setScope(views[next].id); buttons.current[next]?.focus();
        }}
        className={`min-h-9 min-w-0 flex-1 rounded-md px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${scope === id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>{label}</button>)}
    </div>
    <div id={`${prefix}-current-panel`} role="tabpanel" aria-labelledby={`${prefix}-current`} hidden={scope !== 'current'}>{children}</div>
    {scope === 'all' ? <div id={`${prefix}-all-panel`} role="tabpanel" aria-labelledby={`${prefix}-all`}>
      <Suspense fallback={<p role="status" className="text-sm text-gray-500">{zh ? '正在加载笔记…' : 'Loading notes…'}</p>}>
        <NotesBrowser embedded spaceId={spaceId} currentPage={{ id: pageId, title: pageTitle, openCount: notes.filter(note => note.status !== 'resolved').length }} onReturnToCurrent={() => setScope('current')} />
      </Suspense>
    </div> : null}
  </div>;
}
