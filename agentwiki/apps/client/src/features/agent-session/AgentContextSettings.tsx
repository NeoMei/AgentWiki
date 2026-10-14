import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';
import { focusBesidePortalTrigger } from '../../components/portalTabNavigation';
import { referencePopoverPlacement } from './AgentReferencePicker';

/** Keep settings out of the chat's scrolling and clipping containers. */
export function AgentContextSettings({ label, scopeLabel, visible, children }: { label: string; scopeLabel?: string; visible: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  const root = useRef<HTMLDetailsElement>(null), trigger = useRef<HTMLElement>(null), popup = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!visible) setOpen(false); }, [visible]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !popup.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  const positioned = placement !== null;
  useEffect(() => {
    if (open && visible && positioned) popup.current?.querySelector<HTMLElement>('select, button, input, [tabindex]')?.focus({ preventScroll: true });
  }, [open, visible, positioned]);
  useLayoutEffect(() => {
    if (!open || !visible) { setPlacement(null); return; }
    const anchor = trigger.current;
    if (!anchor) return;
    const panel = anchor.closest<HTMLElement>('.agent-session-panel');
    const position = () => {
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const rect = panel?.getBoundingClientRect();
      setPlacement(referencePopoverPlacement(anchor.getBoundingClientRect(), rect?.width && rect.height ? rect : null,
        { left, top, right: left + (viewport?.width ?? window.innerWidth), bottom: top + (viewport?.height ?? window.innerHeight) }, window.innerHeight));
    };
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) position(); };
    position(); window.addEventListener('resize', position); window.addEventListener('scroll', scroll, true);
    window.visualViewport?.addEventListener('resize', position); window.visualViewport?.addEventListener('scroll', position);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    observer?.observe(anchor); if (panel) observer?.observe(panel);
    return () => {
      window.removeEventListener('resize', position); window.removeEventListener('scroll', scroll, true);
      window.visualViewport?.removeEventListener('resize', position); window.visualViewport?.removeEventListener('scroll', position); observer?.disconnect();
    };
  }, [open, visible]);
  return <details ref={root} open={open && visible} className="agent-composer-settings" onKeyDown={(event) => {
    if (event.key === 'Tab' && open) { event.preventDefault(); setOpen(false); focusBesidePortalTrigger(trigger.current, event.shiftKey, popup.current); }
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true }); }
  }} onBlur={(event) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !root.current?.contains(next) && !popup.current?.contains(next)) setOpen(false);
  }}>
    <summary ref={trigger} aria-label={label} title={label} aria-expanded={open && visible} onClick={(event) => { event.preventDefault(); setOpen((value) => !value); }}><SlidersHorizontal aria-hidden="true" size={15} />{scopeLabel ? <span>{scopeLabel}</span> : null}</summary>
    {open && visible && placement ? createPortal(<div ref={popup} role="dialog" aria-label={label} className="agent-settings-popover" style={placement}>{children}</div>, document.body) : null}
  </details>;
}
