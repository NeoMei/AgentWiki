import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquarePlus } from 'lucide-react';
import { validateAssistTarget, type AssistTarget } from './assistTargets';
import { useAuth } from '../../context/AuthContext';
import { PersonalNoteAuthor } from './PersonalNoteAuthor';

interface Props {
  rootRef: RefObject<HTMLElement | null>;
  identity: string;
  source: string;
  updatedAt: string;
  language: string;
  disabled?: boolean;
  storageUnavailable?: boolean;
  captureTarget: () => AssistTarget | null;
  onAdd: (target: AssistTarget, body: string) => boolean;
}
interface SelectionSnapshot {
  identity: string;
  source: string;
  target: AssistTarget;
  range: Range;
  rect: { left: number; top: number; bottom: number };
}

/** Selection is only an entry point. The immutable source/target proof owns the draft after focus moves. */
export function SelectionNoteComposer(props: Props) {
  const { user } = useAuth();
  const latest = useRef(props); latest.current = props;
  const [snapshot, setSnapshot] = useState<SelectionSnapshot | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState('');
  const [failed, setFailed] = useState(false);
  const [reselectIdentity, setReselectIdentity] = useState<string | null>(null);
  const [geometry, setGeometry] = useState({ left: 12, top: 12, width: 360, maxHeight: 480 });
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stateRef = useRef({ snapshot, expanded }); stateRef.current = { snapshot, expanded };
  const zh = props.language === 'zh-CN';
  // Never expose the previous user's/page's draft for even one render.
  const visible = snapshot?.identity === props.identity ? snapshot : null;
  const stale = !!visible && (props.source !== visible.source || props.updatedAt !== visible.target.baseUpdatedAt);
  const close = () => { setSnapshot(null); setExpanded(false); setBody(''); setFailed(false); setReselectIdentity(null); };

  useEffect(() => { close(); }, [props.identity]);
  useEffect(() => {
    const root = props.rootRef.current;
    if (!root) return;
    let pending = 0;
    const capture = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        if (stateRef.current.expanded) return;
        const current = latest.current, selection = window.getSelection();
        if (current.disabled || !selection?.rangeCount || selection.isCollapsed) { setSnapshot(null); return; }
        const range = selection.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) { setSnapshot(null); return; }
        const target = current.captureTarget();
        if (!target || target.kind !== 'selection' || target.baseUpdatedAt !== current.updatedAt || !validateAssistTarget(current.source, target)) { setSnapshot(null); return; }
        const rect = range.getBoundingClientRect();
        if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return;
        setSnapshot({ identity: current.identity, source: current.source, target, range: range.cloneRange(), rect: { left: rect.left, top: rect.top, bottom: rect.bottom } });
        setFailed(false);
      });
    };
    const outside = (event: PointerEvent) => {
      if (!stateRef.current.expanded && !panelRef.current?.contains(event.target as Node) && !root.contains(event.target as Node)) setSnapshot(null);
    };
    document.addEventListener('selectionchange', capture);
    root.addEventListener('mouseup', capture);
    root.addEventListener('keyup', capture);
    root.addEventListener('touchend', capture);
    document.addEventListener('pointerdown', outside);
    return () => {
      cancelAnimationFrame(pending);
      document.removeEventListener('selectionchange', capture);
      root.removeEventListener('mouseup', capture);
      root.removeEventListener('keyup', capture);
      root.removeEventListener('touchend', capture);
      document.removeEventListener('pointerdown', outside);
    };
  }, [props.rootRef, props.identity]);

  useLayoutEffect(() => {
    if (!visible) return;
    const position = () => {
      const current = latest.current;
      let rect = visible.rect;
      if (visible.source === current.source && visible.range.startContainer.isConnected && current.rootRef.current?.contains(visible.range.commonAncestorContainer)) {
        const measured = visible.range.getBoundingClientRect();
        if (measured.width || measured.height) rect = measured;
      }
      const viewport = window.visualViewport;
      const viewportWidth = viewport?.width ?? window.innerWidth, viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportLeft = viewport?.offsetLeft ?? 0, viewportTop = viewport?.offsetTop ?? 0;
      const margin = 12, gap = 8;
      const width = Math.min(expanded ? 360 : 174, Math.max(0, viewportWidth - margin * 2));
      const maxHeight = Math.max(0, viewportHeight - margin * 2);
      const height = Math.min(panelRef.current?.offsetHeight || (expanded ? 272 : 40), maxHeight);
      const below = rect.bottom + gap;
      const preferredTop = below + height <= viewportTop + viewportHeight - margin ? below : rect.top - gap - height;
      setGeometry({ left: Math.min(Math.max(viewportLeft + margin, rect.left), Math.max(viewportLeft + margin, viewportLeft + viewportWidth - width - margin)), top: Math.min(Math.max(viewportTop + margin, preferredTop), Math.max(viewportTop + margin, viewportTop + viewportHeight - height - margin)), width, maxHeight });
    };
    const scroll = (event: Event) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      if (!stateRef.current.expanded) setSnapshot(null); else position();
    };
    position();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    if (panelRef.current) observer?.observe(panelRef.current);
    window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    document.addEventListener('scroll', scroll, true);
    return () => { observer?.disconnect(); window.removeEventListener('resize', position); window.visualViewport?.removeEventListener('resize', position); window.visualViewport?.removeEventListener('scroll', position); document.removeEventListener('scroll', scroll, true); };
  }, [visible, expanded, stale]);

  useEffect(() => { if (expanded && visible) textareaRef.current?.focus(); }, [expanded, visible]);
  useEffect(() => {
    if (!visible && reselectIdentity !== props.identity) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [visible, reselectIdentity, props.identity]);
  if (!visible) return reselectIdentity === props.identity ? createPortal(<div role="status" className="fixed bottom-5 left-1/2 z-[100] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm shadow-md">
    <span>{zh ? '草稿已保留，请重新选择原文。' : 'Draft retained. Select the passage again.'}</span><button type="button" onClick={close} className="shrink-0 text-gray-500">{zh ? '取消' : 'Cancel'}</button>
  </div>, document.body) : null;
  if (!expanded && (props.disabled || stale)) return null;
  const submit = () => {
    const current = latest.current;
    if (current.disabled || current.identity !== visible.identity || current.source !== visible.source || current.updatedAt !== visible.target.baseUpdatedAt || !validateAssistTarget(current.source, visible.target) || !body.trim()) return;
    if (current.onAdd(visible.target, body.trim())) close(); else setFailed(true);
  };
  return createPortal(<div ref={panelRef}
    role={expanded ? 'dialog' : undefined}
    aria-label={expanded ? (zh ? '添加个人笔记' : 'Add personal note') : undefined}
    className="fixed z-[100] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-md"
    style={{ left: geometry.left, top: geometry.top, width: geometry.width, maxHeight: geometry.maxHeight }}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}
  >
    {!expanded ? <button type="button" aria-label={zh ? '为选中文字添加笔记' : 'Add note to selection'}
      className="flex min-h-10 w-full items-center justify-center gap-2 px-3 text-sm font-medium text-gray-700 hover:bg-amber-50"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => { setExpanded(true); setReselectIdentity(null); setFailed(false); }}>
      <MessageSquarePlus size={16} className="text-amber-500" aria-hidden="true" />{zh ? '添加笔记' : 'Add note'}
    </button> : <div className="space-y-3 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-800"><MessageSquarePlus size={16} className="text-amber-500" aria-hidden="true" />{zh ? '个人笔记' : 'Personal note'}<span className="ml-auto text-xs font-normal text-gray-400">{zh ? '仅自己可见' : 'Only you'}</span></div>
      <PersonalNoteAuthor userId={user?.id} language={props.language} />
      <blockquote className="max-h-20 overflow-y-auto border-l-2 border-amber-300 bg-amber-50/60 px-2 py-1 text-xs leading-5 text-gray-600 whitespace-pre-wrap">{visible.target.quote}</blockquote>
      <textarea ref={textareaRef} aria-label={zh ? '笔记内容' : 'Note'} value={body} maxLength={10_000} rows={3}
        placeholder={zh ? '记下你的想法…' : 'Write your thoughts…'}
        className="block w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        onChange={(event) => { setBody(event.target.value); setFailed(false); }} />
      {stale || failed || props.disabled ? <p role="alert" className="text-xs leading-5 text-amber-800">{failed && props.storageUnavailable ? (zh ? '浏览器存储暂时不可用，笔记尚未保存。输入已保留，请释放存储空间后重试。' : 'Browser storage is unavailable; the note has not been saved. Your draft is retained. Free up storage and retry.') : stale ? (zh ? '原文或版本已变动。输入已保留，请重新选择原文后添加笔记。' : 'The source or version changed. Your draft is retained; reselect the passage before adding a note.') : (zh ? '暂时无法添加笔记，输入已保留，请检查原文后重试。' : 'The note could not be added. Your draft is retained; check the passage and retry.')}</p> : null}
      {stale || failed ? <button type="button" className="text-xs font-medium text-blue-600 hover:underline" onClick={() => { setExpanded(false); setSnapshot(null); setFailed(false); setReselectIdentity(props.identity); }}>{zh ? '重新选择原文' : 'Reselect passage'}</button> : null}
      <div className="flex items-center justify-end gap-2"><button type="button" className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100" onClick={close}>{zh ? '取消' : 'Cancel'}</button><button type="button" disabled={!body.trim() || stale || props.disabled} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40" onClick={submit}>{zh ? '添加笔记' : 'Add note'}</button></div>
    </div>}
  </div>, document.body);
}
