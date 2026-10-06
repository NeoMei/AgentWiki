import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { useLanguage } from '../../context/LanguageContext';
import type { PageLinkTarget } from '../markdownLinks';
import type { RequestPageLinks } from './useAuthorizedPageLinks';
import { TableEditingTools } from './TableEditor';
import { formatTransaction, pageLinkTransaction, type FormatCommand } from './commands';
export interface MarkdownSelection { from: number; to: number; text: string }
interface Props {
  view: () => EditorView | null;
  selection: MarkdownSelection;
  source?: string;
  tableEditingEnabled?: boolean;
  tableEditingIdentity?: string;
  pages: PageLinkTarget[];
  spaceId?: string;
  onRequestPageLinks?: RequestPageLinks;
  onRequestAssist?: (selection: MarkdownSelection) => void;
  onRequestImage?: () => void;
}
export const DocumentTools = ({ view, selection, source, tableEditingEnabled = true, tableEditingIdentity = '', pages, spaceId, onRequestPageLinks, onRequestAssist, onRequestImage }: Props) => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState<PageLinkTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<'request' | 'selection' | null>(null);
  const [retry, setRetry] = useState(0);
  const anchorRef = useRef<(MarkdownSelection & { source: string }) | null>(null);
  const [toolbarPosition, setToolbarPosition] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const update = () => {
      const current = view();
      if (!current || selection.from === selection.to) { setToolbarPosition(null); return; }
      try {
        const coords = current.coordsAtPos(selection.from);
        setToolbarPosition(coords && coords.top > 100 ? { left: Math.min(Math.max(12, coords.left), Math.max(12, window.innerWidth - 400)), top: coords.top - 40 } : null);
      } catch { setToolbarPosition(null); }
    };
    update(); document.addEventListener('scroll', update, true);
    return () => document.removeEventListener('scroll', update, true);
  }, [selection.from, selection.to, view]);
  const pickerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const cancelRequest = useCallback(() => {
    requestRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);
  const close = useCallback(() => {
    cancelRequest(); anchorRef.current = null;
    setPicker(false); setLoaded([]); setLoading(false); setFailed(null);
    viewRef.current()?.focus();
  }, [cancelRequest]);
  useEffect(() => {
    if (!picker || !onRequestPageLinks) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++requestRef.current;
    const normalizedQuery = query.trim();
    setLoaded([]); setLoading(true); setFailed(null);
    const run = async () => {
      try {
        const results = await onRequestPageLinks(normalizedQuery, controller.signal);
        if (!controller.signal.aborted && request === requestRef.current) setLoaded(results);
      } catch {
        if (!controller.signal.aborted && request === requestRef.current) setFailed('request');
      } finally {
        if (!controller.signal.aborted && request === requestRef.current) setLoading(false);
      }
    };
    const timer = normalizedQuery ? setTimeout(() => void run(), 300) : null;
    if (!normalizedQuery) void run();
    return () => {
      if (timer !== null) clearTimeout(timer);
      controller.abort();
      if (request === requestRef.current) cancelRequest();
    };
  }, [picker, query, retry, onRequestPageLinks, cancelRequest]);
  useEffect(() => () => { cancelRequest(); anchorRef.current = null; }, [cancelRequest]);
  useEffect(() => {
    if (!picker) return;
    pickerRef.current?.querySelector('input')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const buttons = pickerRef.current?.querySelectorAll<HTMLElement>('input,button');
        if (!buttons?.length) return;
        const first = buttons[0]; const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [picker, close]);
  const open = () => {
    const current = view();
    if (!current) return;
    const range = current.state.selection.main;
    anchorRef.current = { from: range.from, to: range.to, text: current.state.sliceDoc(range.from, range.to), source: current.state.doc.toString() };
    cancelRequest();
    setPicker(true); setQuery(''); setFailed(null); setLoaded([]); setLoading(!!onRequestPageLinks);
  };
  const changeQuery = (next: string) => {
    cancelRequest(); setQuery(next); setFailed(null); setLoaded([]); setLoading(!!onRequestPageLinks);
  };
  const retryQuery = () => {
    cancelRequest(); setFailed(null); setLoaded([]); setLoading(true); setRetry((value) => value + 1);
  };
  const format = (command: FormatCommand) => {
    const current = view(); if (!current) return;
    current.dispatch(formatTransaction(current.state, command)); current.focus();
  };
  const results = onRequestPageLinks ? (loading || failed ? [] : loaded) : pages.filter((page) => `${page.title ?? ''} ${page.id} ${page.slug ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <>
    <div role="toolbar" aria-label={zh ? 'Markdown 格式' : 'Markdown formatting'} className={`document-tools${toolbarPosition ? ' document-tools-floating' : ''}`} style={toolbarPosition ? { position: 'fixed', ...toolbarPosition } : undefined}>
      {(['bold', 'italic', 'link', 'code'] as const).map((command) => <button key={command} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => format(command)} aria-label={zh ? { bold: '加粗', italic: '斜体', link: '链接', code: '行内代码' }[command] : { bold: 'Bold', italic: 'Italic', link: 'Link', code: 'Inline code' }[command]}>
        {({ bold: 'B', italic: 'I', link: '↗', code: '</>' })[command]}
      </button>)}
      <button type="button" onClick={open}>{zh ? '页面链接' : 'Page link'}</button>
      {onRequestImage ? <button type="button" onClick={onRequestImage}>{zh ? '图片' : 'Image'}</button> : null}
      {selection.from !== selection.to && onRequestAssist ? <button type="button" onClick={() => onRequestAssist(selection)}>{zh ? '让 Agent 修改' : 'Ask Agent'}</button> : null}
      {source !== undefined ? <TableEditingTools source={source} selection={selection} view={view} enabled={tableEditingEnabled} identity={tableEditingIdentity} /> : null}
      <span className="document-source-hint">{zh ? 'Markdown 源码 · / 插入' : 'Markdown source · / to insert'}</span>
    </div>
    {picker ? createPortal(<div className="document-picker-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={pickerRef} role="dialog" aria-modal="true" aria-label={zh ? '页面链接' : 'Page link'} className="document-picker">
        <div className="flex items-center justify-between"><h2 className="font-semibold">{zh ? '页面链接' : 'Page link'}</h2><button type="button" onClick={close}>{zh ? '关闭' : 'Close'}</button></div>
        <p className="my-2 text-xs text-gray-500">{zh ? '当前空间' : 'Current Space'}{spaceId ? ` · ${spaceId}` : ''} · {onRequestPageLinks ? (query.trim() ? (zh ? '搜索当前空间，最多显示 50 个已授权结果' : 'Search this Space; up to 50 authorized results') : (zh ? '最多 100 个最近的已授权页面；输入关键词搜索当前空间' : 'Up to 100 recent authorized pages; type to search this Space')) : (zh ? '筛选传入的已授权页面' : 'Filter provided authorized pages')}</p>
        <input type="search" value={query} onChange={(event) => changeQuery(event.target.value)} aria-label={zh ? '查找页面' : 'Find page'} className="w-full rounded border border-gray-300 p-2" />
        {loading ? <p role="status">{query.trim() ? (zh ? '正在搜索当前空间…' : 'Searching this Space…') : (zh ? '正在加载页面…' : 'Loading pages…')}</p> : null}
        {failed ? <div role="alert"><p>{failed === 'selection' ? (zh ? '原文或选区已变化，请关闭后重新选择插入位置。' : 'The source or selection changed. Close and choose the insertion position again.') : (zh ? '页面加载失败，请重试。' : 'Could not load pages. Please retry.')}</p>{failed === 'request' ? <button type="button" onClick={retryQuery}>{zh ? '重试' : 'Retry'}</button> : null}</div> : null}
        <div className="mt-3 max-h-72 overflow-auto">
          {!loading && !failed && !results.length ? <p className="text-sm text-gray-500">{zh ? '没有匹配的已授权页面' : 'No matching authorized pages'}</p> : null}
          {results.map((page) => <button key={page.id} type="button" className="block w-full rounded p-2 text-left hover:bg-gray-100" onClick={() => {
            const current = view(); const anchor = anchorRef.current;
            if (!current || !anchor || current.state.doc.toString() !== anchor.source || anchor.to > current.state.doc.length || current.state.sliceDoc(anchor.from, anchor.to) !== anchor.text) { setFailed('selection'); return; }
            current.dispatch({ selection: EditorSelection.single(anchor.from, anchor.to) });
            current.dispatch(pageLinkTransaction(current.state, page)); close();
          }}><span>{page.title || page.id}</span> <small className="text-gray-500">{page.id}</small></button>)}
        </div>
      </div>
    </div>, document.body) : null}
  </>;
};
