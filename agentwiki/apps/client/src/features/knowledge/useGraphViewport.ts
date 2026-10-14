import { useEffect, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

type Point = { x: number; y: number };
type GraphNode = Point & { id: string; radius: number };
type View = Point & { scale: number };
export type GraphBounds = { left: number; top: number; right: number; bottom: number };
const identity: View = { x: 0, y: 0, scale: 1 };
const boundScale = (scale: number, minimum = 0.25) => Math.max(minimum, Math.min(4, scale));

/** One CSS-pixel viewport for painting, picking, and both input lifecycles. */
export function useGraphViewport<T extends GraphNode>(
  canvasRef: RefObject<HTMLCanvasElement>, nodes: T[], setNodes: Dispatch<SetStateAction<T[]>>, enabled: boolean, bounds?: GraphBounds, minimumReadableScale = 0.25,
) {
  const [view, setView] = useState<View>(identity);
  const current = useRef({ nodes, view, bounds, minimumReadableScale });
  current.current.nodes = nodes;
  current.current.bounds = bounds;
  current.current.minimumReadableScale = minimumReadableScale;
  const suppressClick = useRef(false);
  const suppressDoubleClick = useRef(false);
  const cancelGesture = useRef<() => void>(() => {});
  const update = (next: View) => {
    current.current.view = next;
    setView(next);
  };
  const point = (event: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const hit = (event: { clientX: number; clientY: number }) => {
    const p = point(event);
    const v = current.current.view;
    const x = (p.x - v.x) / v.scale;
    const y = (p.y - v.y) / v.scale;
    // Last painted node wins when nodes overlap. The extra pick margin is in CSS pixels.
    return [...current.current.nodes].reverse().find(n => Math.hypot(x - n.x, y - n.y) < n.radius + 5 / v.scale);
  };
  const fit = (readable = false) => {
    cancelGesture.current();
    const rect = canvasRef.current?.getBoundingClientRect();
    const items = current.current.nodes;
    const box = current.current.bounds;
    if (!rect?.width || !rect.height || (!items.length && !box)) return;
    // Include labels in the bounds without changing the server's layout.
    const left = Math.min(box?.left ?? Infinity, ...items.map(n => n.x - Math.max(n.radius, 80)));
    const right = Math.max(box?.right ?? -Infinity, ...items.map(n => n.x + Math.max(n.radius, 80)));
    const top = Math.min(box?.top ?? Infinity, ...items.map(n => n.y - n.radius));
    const bottom = Math.max(box?.bottom ?? -Infinity, ...items.map(n => n.y + n.radius + 38));
    const overviewScale = boundScale(Math.min((rect.width - 48) / (right - left), (rect.height - 48) / (bottom - top), 1), box ? 0.05 : 0.25);
    const scale = readable ? Math.max(overviewScale, current.current.minimumReadableScale) : overviewScale;
    if (scale > overviewScale) { update({ scale, x: 24 - left * scale, y: 24 - top * scale }); return; }
    update({ scale, x: rect.width / 2 - (left + right) * scale / 2, y: rect.height / 2 - (top + bottom) * scale / 2 });
  };
  const zoom = (factor: number, anchor?: Point) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = anchor ?? { x: rect.width / 2, y: rect.height / 2 };
    const v = current.current.view;
    const scale = boundScale(v.scale * factor, current.current.bounds ? 0.05 : 0.25);
    update({ scale, x: p.x - (p.x - v.x) * scale / v.scale, y: p.y - (p.y - v.y) * scale / v.scale });
  };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !enabled) return;
    // Pointer Events include real mouse input. Registering both families lets delayed
    // compatibility mousedown events after touch pointerup erase drag suppression.
    const pointerInput = typeof window.PointerEvent !== 'undefined';
    const downEvent = pointerInput ? 'pointerdown' : 'mousedown';
    const moveEvent = pointerInput ? 'pointermove' : 'mousemove';
    const upEvent = pointerInput ? 'pointerup' : 'mouseup';
    let gesture: { kind: 'mouse' | 'pointer'; id?: number; start: Point; view: View; node?: T; moved: boolean } | undefined;
    const end = () => {
      const previous = gesture;
      gesture = undefined;
      canvas.style.cursor = 'grab';
      if (previous?.moved) suppressClick.current = true;
      if (previous?.id !== undefined && canvas.hasPointerCapture?.(previous.id)) canvas.releasePointerCapture(previous.id);
    };
    cancelGesture.current = end;
    const down = (event: MouseEvent | PointerEvent) => {
      if (event.button !== 0 || gesture || ('isPrimary' in event && !event.isPrimary)) return;
      // A later click in the same multi-click sequence must not open after a drag.
      if (event.detail <= 1) suppressClick.current = false;
      const isPointer = event.type === 'pointerdown';
      gesture = { kind: isPointer ? 'pointer' : 'mouse', id: isPointer ? (event as PointerEvent).pointerId : undefined,
        start: point(event), view: { ...current.current.view }, node: hit(event), moved: false };
      canvas.style.cursor = 'grabbing';
      if (gesture.id !== undefined) canvas.setPointerCapture?.(gesture.id);
    };
    const move = (event: MouseEvent | PointerEvent) => {
      if (!gesture || (event.type === 'pointermove') !== (gesture.kind === 'pointer')) return;
      if ('pointerId' in event && gesture.id !== event.pointerId) return;
      const p = point(event);
      const dx = p.x - gesture.start.x;
      const dy = p.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
      gesture.moved = true;
      suppressClick.current = true;
      suppressDoubleClick.current = true;
      event.preventDefault();
      if (gesture.node) {
        const { node, view: startView } = gesture;
        setNodes(items => items.map(n => n.id === node.id ? { ...n, x: node.x + dx / startView.scale, y: node.y + dy / startView.scale } : n));
      } else {
        update({ ...gesture.view, x: gesture.view.x + dx, y: gesture.view.y + dy });
      }
    };
    const up = (event: MouseEvent | PointerEvent) => {
      if (!gesture || event.type.startsWith('pointer') !== (gesture.kind === 'pointer')) return;
      if ('pointerId' in event && gesture.id !== event.pointerId) return;
      end();
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (gesture) return;
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.getBoundingClientRect().height : 1;
      zoom(Math.exp(-event.deltaY * units * 0.001), point(event));
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener(downEvent, down);
    window.addEventListener(moveEvent, move);
    window.addEventListener(upEvent, up);
    if (pointerInput) {
      canvas.addEventListener('lostpointercapture', end);
      window.addEventListener('pointercancel', up);
    }
    window.addEventListener('blur', end);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => fit(true));
    observer?.observe(canvas);
    const resize = () => fit(true);
    window.addEventListener('resize', resize);
    fit(true);
    return () => {
      end();
      observer?.disconnect();
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener(downEvent, down);
      window.removeEventListener(moveEvent, move);
      window.removeEventListener(upEvent, up);
      if (pointerInput) {
        canvas.removeEventListener('lostpointercapture', end);
        window.removeEventListener('pointercancel', up);
      }
      window.removeEventListener('blur', end);
      window.removeEventListener('resize', resize);
      cancelGesture.current = () => {};
    };
    // Handlers read current nodes/view through refs; do not restart a gesture on each frame.
  }, [enabled, canvasRef, setNodes]);
  const reveal = (id: string) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const node = current.current.nodes.find(item => item.id === id);
    const v = current.current.view;
    if (!rect || !node) return;
    if (v.scale < current.current.minimumReadableScale) {
      const scale = current.current.minimumReadableScale;
      update({ scale, x: rect.width / 2 - node.x * scale, y: rect.height / 2 - node.y * scale });
      return;
    }
    const x = node.x * v.scale + v.x; const y = node.y * v.scale + v.y;
    if (x < 20 || x > rect.width - 20 || y < 35 || y > rect.height - 70) update({ ...v, x: rect.width / 2 - node.x * v.scale, y: rect.height / 2 - node.y * v.scale });
  };
  return { view, hit, fit: () => fit(), fitReadable: () => fit(true), reveal, zoom, suppressClick, suppressDoubleClick, reset: () => { cancelGesture.current(); update({ ...identity }); } };
}
