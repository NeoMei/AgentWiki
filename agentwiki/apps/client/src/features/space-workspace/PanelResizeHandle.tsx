import React, { useRef } from 'react';

/** Left-edge grip for right-side document panels. Width grows toward the left. */
export const PanelResizeHandle: React.FC<{
  label: string;
  width: number;
  min: number;
  max: number;
  onChange: (width: number) => void;
}> = ({ label, width, min, max, onChange }) => {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const change = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  return <div role="separator" aria-label={label} aria-orientation="vertical"
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} tabIndex={0}
    className="document-panel-resizer"
    onKeyDown={(event) => {
      const next = event.key === 'ArrowLeft' ? width + 10 : event.key === 'ArrowRight' ? width - 10
        : event.key === 'Home' ? min : event.key === 'End' ? max : null;
      if (next !== null) { event.preventDefault(); change(next); }
    }}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      drag.current = { pointerId: event.pointerId, x: event.clientX, width };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    }}
    onPointerMove={(event) => {
      const start = drag.current;
      if (start?.pointerId === event.pointerId) change(start.width + start.x - event.clientX);
    }}
    onPointerUp={(event) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      drag.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={(event) => { if (drag.current?.pointerId === event.pointerId) drag.current = null; }}
    onLostPointerCapture={(event) => { if (drag.current?.pointerId === event.pointerId) drag.current = null; }}
  />;
};
