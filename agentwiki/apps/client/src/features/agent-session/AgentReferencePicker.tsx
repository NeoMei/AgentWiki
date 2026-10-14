import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { FileText, LoaderCircle, Plus, Search, X } from 'lucide-react';
import api from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import type { AgentReference } from './agentSessionTypes';

type AgentReferencePickerProps = {
  userId: string;
  spaceId: string;
  selected: AgentReference[];
  onChange: (items: AgentReference[]) => void;
  disabled?: boolean;
  openRequest?: number;
  onClose?: () => void;
  onOpen?: () => void;
  onSelected?: (items: AgentReference[]) => void;
};

type Bounds = { left: number; right: number; top: number; bottom: number };

/** Clamp to both the visible viewport and the chat panel, independently of the trigger's position. */
export function referencePopoverPlacement(anchor: Bounds, panel: Bounds | null, viewport: Bounds, layoutHeight: number): CSSProperties {
  const leftEdge = Math.max(viewport.left + 8, (panel?.left ?? viewport.left) + 8);
  const rightEdge = Math.max(leftEdge, Math.min(viewport.right - 8, (panel?.right ?? viewport.right) - 8));
  const topEdge = Math.max(viewport.top + 8, (panel?.top ?? viewport.top) + 8);
  const bottomEdge = Math.max(topEdge, Math.min(viewport.bottom - 8, (panel?.bottom ?? viewport.bottom) - 8));
  const width = Math.min(352, rightEdge - leftEdge);
  const aboveAnchor = Math.min(bottomEdge, Math.max(topEdge, anchor.top - 8));
  const belowAnchor = Math.max(topEdge, Math.min(bottomEdge, anchor.bottom + 8));
  const above = aboveAnchor - topEdge, below = bottomEdge - belowAnchor;
  const upwards = above >= Math.min(240, bottomEdge - topEdge) || above >= below;
  return {
    left: Math.max(leftEdge, Math.min(anchor.right - width, rightEdge - width)),
    width,
    maxHeight: Math.min(352, upwards ? above : below),
    ...(upwards ? { bottom: layoutHeight - aboveAnchor } : { top: belowAnchor }),
  };
}

/** A new identity gets an empty picker; references are always resolved in the current Space. */
export function AgentReferencePicker(props: AgentReferencePickerProps) {
  const token = localStorage.getItem('token');
  return <ReferencePopover key={`${props.userId}\u0000${props.spaceId}\u0000${token ?? ''}`} {...props} token={token} />;
}

function ReferencePopover({ userId, spaceId, selected, onChange, disabled, openRequest, onClose, onOpen, onSelected, token }: AgentReferencePickerProps & { token: string | null }) {
  const { language } = useLanguage(), zh = language === 'zh-CN';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AgentReference[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const handledRequest = useRef(openRequest);
  const popupId = useId(), resultsId = useId();
  const unavailable = disabled || !userId || !spaceId || selected.length >= 5;
  const visibleResults = results.filter((result) => !selected.some((reference) => reference.pageId === result.pageId));
  const isVisible = () => {
    if (rootRef.current?.closest('[hidden], [aria-hidden="true"]')) return false;
    for (let node: HTMLElement | null = rootRef.current; node; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };
  const contains = (node: Node) => rootRef.current?.contains(node) || popupRef.current?.contains(node);
  const close = (restoreFocus = false) => {
    setOpen(false); setQuery(''); setResults([]); setError(false); setLoading(false);
    if (restoreFocus && isVisible()) {
      if (onClose) onClose(); else triggerRef.current?.focus({ preventScroll: true });
    }
  };

  useEffect(() => {
    if (unavailable) { setOpen(false); setQuery(''); setResults([]); setError(false); setLoading(false); }
  }, [unavailable]);
  useEffect(() => {
    if (openRequest === handledRequest.current) return;
    handledRequest.current = openRequest;
    if (openRequest !== undefined && !unavailable && isVisible()) setOpen(true);
  }, [openRequest, unavailable]);
  const positioned = placement !== null;
  useEffect(() => {
    if (open && positioned && !unavailable && isVisible()) inputRef.current?.focus({ preventScroll: true });
  }, [open, positioned, unavailable]);
  useLayoutEffect(() => {
    if (!open || unavailable) { setPlacement(null); return; }
    const trigger = triggerRef.current;
    if (!trigger) return;
    const panel = trigger.closest<HTMLElement>('.agent-session-panel');
    const reposition = () => {
      if (!isVisible()) { setOpen(false); setQuery(''); setResults([]); setPlacement(null); return; }
      const rect = panel?.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const bounds = { left, top, right: left + (viewport?.width ?? window.innerWidth), bottom: top + (viewport?.height ?? window.innerHeight) };
      setPlacement(referencePopoverPlacement(trigger.getBoundingClientRect(), rect?.width && rect.height ? rect : null, bounds, window.innerHeight));
    };
    const onScroll = (event: Event) => { if (!(event.target instanceof Node) || !popupRef.current?.contains(event.target)) reposition(); };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', onScroll, true);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reposition);
    resize?.observe(trigger); if (panel) resize?.observe(panel);
    const visibility = new MutationObserver(reposition);
    for (let node = rootRef.current?.parentElement; node; node = node.parentElement) visibility.observe(node, { attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'class', 'style'] });
    return () => {
      window.removeEventListener('resize', reposition); window.removeEventListener('scroll', onScroll, true);
      window.visualViewport?.removeEventListener('resize', reposition); window.visualViewport?.removeEventListener('scroll', reposition);
      resize?.disconnect(); visibility.disconnect();
    };
  }, [open, unavailable]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !contains(event.target)) {
        setOpen(false); setQuery(''); setResults([]); setError(false); setLoading(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  useEffect(() => {
    setResults([]); setError(false); setLoading(false);
    if (!open || unavailable || !query.trim()) return;
    const abort = new AbortController();
    const current = () => {
      if (abort.signal.aborted) return false;
      if (localStorage.getItem('token') === token) return true;
      setOpen(false); setQuery(''); setResults([]); setError(false); setLoading(false);
      return false;
    };
    setLoading(true);
    const timer = setTimeout(() => {
      if (!current()) return;
      void api.get('/search', { params: { q: query.trim(), spaceId, limit: 20 }, signal: abort.signal, transformRequest: [(data) => {
        // Axios adds the live token in an interceptor; do not send an old search under a new account.
        if (localStorage.getItem('token') !== token) throw new Error('Reference search session changed');
        return data;
      }] }).then(({ data }) => {
        if (!current()) return;
        const rows = Array.isArray(data?.results) ? data.results : [];
        const unique = new Map<string, AgentReference>();
        for (const row of rows) {
          const page = row.page;
          if (page?.spaceId === spaceId && typeof page.id === 'string' && typeof page.title === 'string') unique.set(page.id, { pageId: page.id, title: page.title, ...(typeof page.path === 'string' && page.path ? { path: page.path } : {}) });
        }
        setResults([...unique.values()]); setLoading(false);
      }).catch((failure: unknown) => {
        if (!current()) return;
        const status = (failure as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403 || status === 404) {
          setOpen(false); setQuery(''); setResults([]); setError(false);
        } else setError(true);
        setLoading(false);
      });
    }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, userId, spaceId, token, open, unavailable]);

  const choose = (reference: AgentReference) => {
    if (unavailable || localStorage.getItem('token') !== token) return;
    if (onSelected) onSelected([...selected, reference]); else onChange([...selected, reference]); close(true);
  };
  return <div ref={rootRef} className="relative flex min-w-0 flex-wrap items-center gap-1.5" onKeyDown={(event) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
  }} onBlur={(event) => {
    if (open && event.relatedTarget instanceof Node && !contains(event.relatedTarget)) close();
  }}>
    {selected.map((reference) => <button type="button" key={reference.pageId} disabled={disabled} className="inline-flex max-w-full items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-50" aria-label={`${zh ? '移除' : 'Remove'} ${reference.title}`} onClick={() => onChange(selected.filter((item) => item.pageId !== reference.pageId))}>
      <FileText size={12} className="shrink-0" aria-hidden="true" /><span className="truncate">{reference.title}</span><X size={11} className="shrink-0" aria-hidden="true" />
    </button>)}
    <button ref={triggerRef} type="button" disabled={unavailable} aria-label={zh ? '引用文档' : 'Reference pages'} title={selected.length >= 5 ? (zh ? '最多引用 5 篇文档' : 'Up to 5 reference pages') : (zh ? '引用文档（@）' : 'Reference pages (@)')} aria-haspopup="dialog" aria-expanded={open && !unavailable} aria-controls={open && !unavailable ? popupId : undefined} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40" onClick={() => { onOpen?.(); if (open) close(true); else setOpen(true); }}>
      <Plus size={16} aria-hidden="true" />
    </button>
    {open && !unavailable && placement ? createPortal(<div ref={popupRef} id={popupId} role="dialog" aria-label={zh ? '引用文档' : 'Reference pages'} style={placement} className="fixed z-[80] flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-3 py-2.5">
        <Search size={15} className="shrink-0 text-gray-400" aria-hidden="true" />
        <input ref={inputRef} aria-label={zh ? '查找引用文档' : 'Find reference pages'} aria-controls={resultsId} placeholder={zh ? '请输入需要引用的文档名称' : 'Enter the name of the document to reference'} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (!visibleResults.length || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
          event.preventDefault(); resultRefs.current[event.key === 'ArrowDown' ? 0 : visibleResults.length - 1]?.focus();
        }} className="min-h-6 min-w-0 flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400" />
        {query ? <button type="button" aria-label={zh ? '清除搜索' : 'Clear search'} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline focus-visible:outline-blue-300" onClick={() => { setQuery(''); inputRef.current?.focus({ preventScroll: true }); }}><X size={13} aria-hidden="true" /></button> : null}
      </div>
      <div className="min-h-0 overflow-y-auto p-1.5">
        {error ? <p role="alert" className="px-2 py-3 text-xs text-red-700">{zh ? '无法查找引用，请重新输入重试。' : 'Could not find references. Edit the search to retry.'}</p> : loading ? <p role="status" className="flex items-center gap-2 px-2 py-3 text-xs text-gray-500"><LoaderCircle size={13} className="animate-spin" aria-hidden="true" />{zh ? '正在查找…' : 'Searching…'}</p> : !visibleResults.length ? <p className="px-2 py-3 text-xs text-gray-500">{query.trim() ? (zh ? '未找到可引用的文档' : 'No matching pages') : (zh ? '搜索当前空间的文档' : 'Search pages in this Space')}</p> : null}
        <ul id={resultsId}>{visibleResults.map((reference, index) => <li key={reference.pageId}>
          <button ref={(node) => { resultRefs.current[index] = node; }} type="button" className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 focus:bg-gray-100 focus:outline-none [overflow-wrap:anywhere]" aria-label={`${zh ? '添加' : 'Add'} ${reference.title}`} onClick={() => choose(reference)} onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter') { event.preventDefault(); choose(reference); }
            else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const next = index + (event.key === 'ArrowDown' ? 1 : -1);
              if (next < 0 || next >= visibleResults.length) inputRef.current?.focus(); else resultRefs.current[next]?.focus();
            }
          }}>
            <FileText size={17} className="shrink-0 text-gray-400" aria-hidden="true" /><span className="min-w-0"><span className="block">{reference.title}</span>{reference.path ? <span className="mt-0.5 block break-all text-xs text-gray-500">{reference.path}</span> : null}</span>
          </button>
        </li>)}</ul>
      </div>
    </div>, document.body) : null}
  </div>;
}
