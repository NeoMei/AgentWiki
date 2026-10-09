import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

const OPEN_EVENT = 'agentwiki:tree-action-menu-open';

/** One active menu across all ContentTree surfaces in this document. */
export const TreeActionMenu: React.FC<{ label: string; title: string; children: React.ReactNode }> = ({ label, title, children }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef<'first' | 'last' | null>(null);
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const show = () => {
    document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: containerRef.current }));
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const opened = (event: Event) => {
      if ((event as CustomEvent).detail !== containerRef.current) close();
    };
    const outside = (event: Event) => {
      if (!(event.target instanceof Node) || !containerRef.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      close(Boolean(containerRef.current?.contains(document.activeElement)));
    };
    const resize = () => close();
    document.addEventListener(OPEN_EVENT, opened);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener(OPEN_EVENT, opened);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const menu = menuRef.current;
    // Respect the nearest scrolling tree, even when rendered in a modal drawer.
    let scroller = containerRef.current?.closest<HTMLElement>('[data-content-tree-scrollport]') ?? containerRef.current?.parentElement ?? null;
    while (scroller && !scroller.hasAttribute('data-content-tree-scrollport') && !/(auto|scroll)/u.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const viewport = scroller?.getBoundingClientRect();
    const top = Math.max(0, viewport?.top ?? 0);
    const bottom = Math.min(window.innerHeight, viewport?.bottom ?? window.innerHeight);
    const above = Math.max(0, trigger.top - top - 4);
    const below = Math.max(0, bottom - trigger.bottom - 4);
    menu.style.maxHeight = '';
    // Keep the row action column reachable while this menu is open. Align the
    // menu beside that column, rather than covering the following row triggers.
    const leftSpace = Math.max(0, trigger.left - 8);
    const rightSpace = Math.max(0, window.innerWidth - trigger.right - 8);
    const opensLeft = leftSpace >= 176 || leftSpace >= rightSpace;
    const horizontalSpace = opensLeft ? leftSpace : rightSpace;
    menu.style.width = `${Math.min(176, horizontalSpace)}px`;
    menu.style.minWidth = `${Math.min(176, horizontalSpace)}px`;
    menu.style.maxWidth = `${horizontalSpace}px`;
    const rect = menu.getBoundingClientRect();
    const upward = Math.max(menu.scrollHeight, rect.height) > below && above > below;
    Object.assign(menu.style, {
      position: 'fixed',
      left: `${opensLeft ? trigger.left - rect.width - 4 : trigger.right + 4}px`,
      top: upward ? 'auto' : `${trigger.bottom + 4}px`,
      bottom: upward ? `${window.innerHeight - trigger.top + 4}px` : 'auto',
      maxHeight: `${upward ? above : below}px`, overflowY: 'auto',
    });
    if (pendingFocusRef.current) {
      const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      (pendingFocusRef.current === 'last' ? buttons[buttons.length - 1] : buttons[0])?.focus({ preventScroll: true });
      pendingFocusRef.current = null;
    }
  }, [open]);
  const navigate = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!open) {
      pendingFocusRef.current = event.key === 'ArrowUp' || event.key === 'End' ? 'last' : 'first';
      show(); return;
    }
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowUp' ? (index <= 0 ? buttons.length - 1 : index - 1) : (index + 1) % buttons.length;
    buttons[next]?.focus({ preventScroll: true });
  };
  return <div ref={containerRef} className="relative shrink-0" onKeyDown={navigate}>
    <button ref={triggerRef} type="button" aria-label={label} title={title} aria-haspopup="menu" aria-expanded={open}
      className="inline-flex h-7 w-7 items-center justify-center rounded text-gray-500 hover:bg-gray-200 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      onClick={() => open ? close() : show()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (open) close();
          else show();
        }
      }}><MoreHorizontal size={16} /></button>
    <div ref={menuRef} role="menu" aria-label={title} hidden={!open}
      onClickCapture={(event) => { if ((event.target as Element).closest('button:not(:disabled)')) close(true); }}
      className="fixed z-50 min-w-44 rounded-md border border-gray-200 bg-white p-1 shadow-lg">
      <div className="flex flex-col items-stretch gap-0.5">{children}</div>
    </div>
  </div>;
};
