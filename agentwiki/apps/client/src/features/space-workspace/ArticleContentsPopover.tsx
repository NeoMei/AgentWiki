import React, { useCallback, useEffect, useRef, useState } from 'react';
import { List, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

export interface OutlineItem {
  id: string;
  level: number;
  label: string;
  element: HTMLHeadingElement;
}

export interface ArticleContentsPopoverProps {
  articleRootRef: React.RefObject<HTMLElement>;
  pageKey: string;
}

interface PopoverPosition {
  left: number;
  top: number;
  width: number;
}

const STICKY_OFFSET = 88;

const currentStickyOffset = (wrapper: HTMLElement | null): number => {
  const toolbar = wrapper?.closest<HTMLElement>('[data-reading-toolbar]');
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

export const ArticleContentsPopover: React.FC<ArticleContentsPopoverProps> = ({ articleRootRef, pageKey }) => {
  const { t } = useLanguage();
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [position, setPosition] = useState<PopoverPosition>({ left: 16, top: 88, width: 280 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const bounds = trigger.getBoundingClientRect();
    const width = Math.min(280, Math.max(0, window.innerWidth - 32));
    const rightmostLeft = Math.max(16, window.innerWidth - width - 16);
    setPosition({
      left: Math.min(Math.max(16, bounds.right - width), rightmostLeft),
      top: Math.min(bounds.bottom + 8, Math.max(16, window.innerHeight - 16)),
      width,
    });
  }, []);

  useEffect(() => {
    const root = articleRootRef.current;
    setOpen(false);
    setItems([]);
    setActiveId(null);
    if (!root) return;

    const refresh = () => {
      const next = readOutline(root);
      setItems(next);
      setActiveId((current) => next.some((item) => item.id === current) ? current : next[0]?.id ?? null);
      if (next.length === 0) setOpen(false);
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['id'] });
    return () => observer.disconnect();
  }, [articleRootRef, pageKey]);

  useEffect(() => {
    const root = articleRootRef.current;
    if (!root || items.length === 0) return;
    const scrollingElement = scrollParent(root);
    const updateActive = () => {
      let current = items[0];
      for (const item of items) {
        if (item.element.getBoundingClientRect().top <= currentStickyOffset(wrapperRef.current)) current = item;
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
  }, [articleRootRef, items, pageKey]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const closeFromOutside = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromEscape);
    document.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromEscape);
      document.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  if (items.length === 0) return null;

  const closeAndRestoreFocus = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const navigateTo = (item: OutlineItem) => {
    item.element.scrollIntoView({ block: 'start' });
    const scrollingElement = scrollParent(item.element);
    scrollingElement.scrollBy({ top: -currentStickyOffset(wrapperRef.current), left: 0, behavior: 'instant' });
    setActiveId(item.id);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          if (!open) updatePosition();
          setOpen((current) => !current);
        }}
        className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:border-blue-300 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <List size={17} aria-hidden="true" />
        {t('page.contents')}
      </button>
      {open ? (
        <nav
          aria-label={t('page.contents')}
          className="fixed z-30 max-h-[calc(100vh-2rem)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
          style={{ left: position.left, top: position.top, width: position.width }}
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
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
          <div className="max-h-[min(60vh,32rem)] overflow-y-auto p-2">
            {items.map((item) => (
              <button
                key={`${item.id}:${item.level}`}
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
      ) : null}
    </div>
  );
};
