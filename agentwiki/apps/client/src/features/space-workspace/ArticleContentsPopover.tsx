import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { List, X } from 'lucide-react';
import { outlineFor, type MarkdownOutlineItem } from '../../components/markdown-tools/outline';
import { useLanguage } from '../../context/LanguageContext';
import { useOptionalSpaceWorkspace } from './SpaceWorkspaceContext';
import { clampOutlineWidth } from './workspacePreferences';
import { PanelResizeHandle } from './PanelResizeHandle';

export interface OutlineItem {
  id: string;
  level: number;
  label: string;
  element: HTMLHeadingElement;
}

export interface ArticleContentsPopoverProps {
  articleRootRef: React.RefObject<HTMLElement>;
  pageKey: string;
  source?: string;
  activeHeadingId?: string;
  onNavigate?: (item: MarkdownOutlineItem) => void;
  suppressed?: boolean;
  spaceId?: string;
}

interface PopoverPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  resizeMax: number;
}

const STICKY_OFFSET = 88;

const owningToolbar = (wrapper: HTMLElement | null): HTMLElement | null => {
  // Edit outline is in the body; reading outline lives inside its toolbar.
  const inside = wrapper?.closest<HTMLElement>('[data-reading-toolbar], [data-testid="editor-toolbar"]');
  if (inside) return inside;
  let ancestor = wrapper?.parentElement ?? null;
  while (ancestor) {
    const toolbar = ancestor.querySelector<HTMLElement>('[data-reading-toolbar], [data-testid="editor-toolbar"]');
    if (toolbar) return toolbar;
    ancestor = ancestor.parentElement;
  }
  return null;
};
const currentStickyOffset = (wrapper: HTMLElement | null): number => {
  const toolbar = owningToolbar(wrapper);
  return toolbar ? Math.max(STICKY_OFFSET, Math.ceil(toolbar.getBoundingClientRect().bottom) + 12) : STICKY_OFFSET;
};

const headingLabel = (heading: HTMLHeadingElement): string => {
  const copy = heading.cloneNode(true) as HTMLHeadingElement;
  copy.querySelectorAll('[aria-hidden="true"], .heading-anchor').forEach((node) => node.remove());
  return copy.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
};

const readOutline = (root: HTMLElement): OutlineItem[] => (
  Array.from(root.querySelectorAll<HTMLHeadingElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'))
    .filter((heading) => !heading.closest('.markdown-page-embed'))
    .map((element) => ({
      id: element.id,
      level: Number(element.tagName.slice(1)),
      label: headingLabel(element),
      element,
    }))
    .filter((item) => item.label.length > 0)
);

const scrollParent = (element: HTMLElement): HTMLElement | Window => {
  let parent = element.parentElement;
  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (/auto|scroll|overlay/u.test(overflowY)) return parent;
    parent = parent.parentElement;
  }
  return window;
};

export const ArticleContentsPopover: React.FC<ArticleContentsPopoverProps> = ({ articleRootRef, pageKey, source, activeHeadingId, onNavigate, suppressed = false, spaceId }) => {
  const { t, language } = useLanguage();
  const workspace = useOptionalSpaceWorkspace();
  const scoped = workspace?.spaceId && (!spaceId || workspace.spaceId === spaceId) ? workspace : null;
  const scopeKey = `${workspace?.userId ?? ''}:${spaceId ?? workspace?.spaceId ?? ''}`;
  const viewKey = `${scopeKey}:${pageKey}`;
  const [local, setLocal] = useState<{ key: string; open?: boolean; width?: number }>({ key: scopeKey });
  const [mobileOpenFor, setMobileOpenFor] = useState<string | null>(null);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const preferredOpen = scoped ? scoped.outlineOpen : local.key === scopeKey ? local.open : undefined;
  const preferredWidth = clampOutlineWidth(scoped ? scoped.outlineWidth : local.key === scopeKey ? local.width : undefined);
  const outline = useMemo(() => source === undefined ? null : outlineFor(source), [source]);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const wide = viewportWidth >= 1600;
  const mobile = viewportWidth < 1024;
  const [items, setItems] = useState<Array<Omit<OutlineItem, 'element'> & { element?: HTMLHeadingElement; from?: number; to?: number }>>([]);
  const open = !suppressed && (mobile ? mobileOpenFor === viewKey : (preferredOpen ?? wide) && dismissedFor !== viewKey);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [position, setPosition] = useState<PopoverPosition>({ left: 16, top: 88, width: 280, maxHeight: 0, resizeMax: 360 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => { setMobileOpenFor(null); setDismissedFor(null); }, [mobile]);
  useEffect(() => { if (suppressed) setDismissedFor(null); }, [suppressed]);
  const chooseOpen = useCallback((next: boolean) => {
    setDismissedFor(null);
    if (mobile) setMobileOpenFor(next ? viewKey : null);
    else if (scoped) scoped.setPanelPreferences({ outlineOpen: next });
    else setLocal((current) => ({ ...(current.key === scopeKey ? current : {}), key: scopeKey, open: next }));
  }, [mobile, viewKey, scoped, scopeKey]);
  const resizeOutline = (width: number) => {
    if (scoped) scoped.setPanelPreferences({ outlineWidth: width });
    else setLocal((current) => ({ ...(current.key === scopeKey ? current : {}), key: scopeKey, width }));
  };

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const bounds = trigger.getBoundingClientRect();
    const canvas = wrapperRef.current?.closest<HTMLElement>('.document-canvas');
    const available = window.innerWidth - Math.max(0, canvas?.getBoundingClientRect().left ?? 0) - 380;
    const resizeMax = Math.min(360, available);
    const width = Math.min(preferredWidth, resizeMax >= 200 && !mobile ? resizeMax : 360, Math.max(0, window.innerWidth - 32));
    const rightmostLeft = Math.max(16, window.innerWidth - width - 16);
    const top = Math.min(wide ? Math.max(140, currentStickyOffset(wrapperRef.current)) : bounds.bottom + 8, Math.max(16, window.innerHeight - 16));
    setPosition({
      left: wide ? rightmostLeft : Math.min(Math.max(16, bounds.right - width), rightmostLeft),
      top,
      width,
      maxHeight: Math.max(0, window.innerHeight - top - 16),
      resizeMax,
    });
  }, [wide, mobile, preferredWidth]);

  useEffect(() => {
    const root = articleRootRef.current;
    setItems([]);
    setActiveId(null);
    if (!root && outline === null) return;

    const refresh = () => {
      const rendered = root ? readOutline(root) : [];
      const next = outline === null ? rendered : outline.map((item) => {
        const element = rendered.find((heading) => Number(heading.element.dataset.markdownSourceStart) === item.from)?.element
          ?? rendered.find((heading) => heading.id === item.id)?.element;
        return { ...item, element };
      });
      setItems(next);
      setActiveId((current) => next.some((item) => item.id === current) ? current : next[0]?.id ?? null);
    };
    refresh();
    if (!root) return;
    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['id'] });
    return () => observer.disconnect();
  }, [articleRootRef, pageKey, outline, wide]);

  useEffect(() => {
    const root = articleRootRef.current;
    if (activeHeadingId) { setActiveId(activeHeadingId); return; }
    if (!root || items.length === 0) return;
    const scrollingElement = scrollParent(root);
    const updateActive = () => {
      if (activeHeadingId) { setActiveId(activeHeadingId); return; }
      let current = items[0];
      for (const item of items) {
        if (item.element && item.element.getBoundingClientRect().top <= currentStickyOffset(wrapperRef.current)) current = item;
        else break;
      }
      setActiveId(current?.id ?? null);
    };
    updateActive();
    scrollingElement.addEventListener('scroll', updateActive, { passive: true });
    window.addEventListener('resize', updateActive);
    return () => {
      scrollingElement.removeEventListener('scroll', updateActive);
      window.removeEventListener('resize', updateActive);
    };
  }, [activeHeadingId, articleRootRef, items, pageKey]);

  useEffect(() => {
    if (!open || items.length === 0) return;
    updatePosition();
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!wrapperRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        if (mobile) setMobileOpenFor(null);
        else if (!wide) setDismissedFor(viewKey);
      }
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      chooseOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromEscape);
    document.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    const toolbarObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
    const toolbar = owningToolbar(wrapperRef.current);
    if (toolbar) toolbarObserver?.observe(toolbar);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromEscape);
      document.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
      toolbarObserver?.disconnect();
    };
  }, [open, updatePosition, mobile, wide, viewKey, chooseOpen, items.length]);

  if (items.length === 0) return null;

  const closeAndRestoreFocus = () => {
    chooseOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const navigateTo = (item: typeof items[number]) => {
    if (onNavigate && item.from !== undefined && item.to !== undefined) {
      onNavigate({ id: item.id, label: item.label, level: item.level, from: item.from, to: item.to });
      setActiveId(item.id); if (mobile) setMobileOpenFor(null); else if (!wide) setDismissedFor(viewKey); return;
    }
    if (!item.element) return;
    item.element.scrollIntoView({ block: 'start' });
    const scrollingElement = scrollParent(item.element);
    scrollingElement.scrollBy({ top: -currentStickyOffset(wrapperRef.current), left: 0, behavior: 'instant' });
    setActiveId(item.id);
    if (mobile) setMobileOpenFor(null); else if (!wide) setDismissedFor(viewKey);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        disabled={suppressed}
        title={suppressed ? (language === 'zh-CN' ? '关闭协作面板以查看目录' : 'Close the collaboration panel to show contents') : undefined}
        onClick={() => {
          if (!open) updatePosition();
          chooseOpen(!open);
        }}
        className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:border-blue-300 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      >
        <List size={17} aria-hidden="true" />
        {t('page.contents')}
      </button>
      {open ? createPortal((
        <nav
          ref={popoverRef}
          aria-label={t('page.contents')}
          className="fixed z-30 flex flex-col rounded-lg border border-gray-200 bg-white shadow-lg"
          style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
        >
          {!mobile && position.resizeMax >= 200 ? <PanelResizeHandle key={scopeKey} label={language === 'zh-CN' ? '调整文章目录宽度' : 'Resize article contents'} width={position.width} min={200} max={position.resizeMax} onChange={resizeOutline} /> : null}
          <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
            <h2 className="text-base font-semibold text-gray-900">{t('page.contents')}</h2>
            <button
              type="button"
              onClick={closeAndRestoreFocus}
              aria-label={t('common.close')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={activeId === item.id ? 'location' : undefined}
                onClick={() => navigateTo(item)}
                title={item.label}
                className={`block w-full truncate rounded-md py-2 pr-3 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${activeId === item.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-700 hover:bg-gray-50'}`}
                style={{ paddingLeft: `${12 + Math.max(0, item.level - 1) * 14}px` }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </nav>
      ), document.body) : null}
    </div>
  );
};
