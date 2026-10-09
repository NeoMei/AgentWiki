import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelResizeHandle } from './PanelResizeHandle';

const Harness = () => {
  const [width, setWidth] = useState(280);
  return <PanelResizeHandle label="Panel width" width={width} min={200} max={360} onChange={setWidth} />;
};
const pointer = (element: HTMLElement, type: string, values: Record<string, number>) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.entries(values).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
  fireEvent(element, event);
};
afterEach(cleanup);
describe('right panel resize handle', () => {
  it('exposes keyboard sizing and bounds with the right-panel expansion direction', () => {
    render(<Harness />);
    const grip = screen.getByRole('separator', { name: 'Panel width' });
    expect(grip).toHaveAttribute('aria-orientation', 'vertical');
    fireEvent.keyDown(grip, { key: 'ArrowLeft' }); expect(grip).toHaveAttribute('aria-valuenow', '290');
    fireEvent.keyDown(grip, { key: 'ArrowRight' }); expect(grip).toHaveAttribute('aria-valuenow', '280');
    fireEvent.keyDown(grip, { key: 'End' }); expect(grip).toHaveAttribute('aria-valuenow', '360');
    fireEvent.keyDown(grip, { key: 'ArrowLeft' }); expect(grip).toHaveAttribute('aria-valuenow', '360');
    fireEvent.keyDown(grip, { key: 'Home' }); expect(grip).toHaveAttribute('aria-valuenow', '200');
    fireEvent.keyDown(grip, { key: 'Escape' }); expect(grip).toHaveAttribute('aria-valuenow', '200');
  });
  it('captures the primary pointer, ignores unrelated input, and stops on cancel/lost capture', () => {
    render(<Harness />);
    const grip = screen.getByRole('separator');
    const capture = vi.fn(); Object.defineProperty(grip, 'setPointerCapture', { value: capture });
    pointer(grip, 'pointerdown', { pointerId: 1, button: 2, clientX: 500 });
    pointer(grip, 'pointermove', { pointerId: 1, clientX: 400 }); expect(grip).toHaveAttribute('aria-valuenow', '280');
    pointer(grip, 'pointerdown', { pointerId: 1, button: 0, clientX: 500 }); expect(capture).toHaveBeenCalledWith(1);
    pointer(grip, 'pointermove', { pointerId: 2, clientX: 100 }); expect(grip).toHaveAttribute('aria-valuenow', '280');
    pointer(grip, 'pointercancel', { pointerId: 2 });
    pointer(grip, 'pointermove', { pointerId: 1, clientX: 460 }); expect(grip).toHaveAttribute('aria-valuenow', '320');
    pointer(grip, 'pointermove', { pointerId: 1, clientX: 0 }); expect(grip).toHaveAttribute('aria-valuenow', '360');
    pointer(grip, 'pointercancel', { pointerId: 1 });
    pointer(grip, 'pointermove', { pointerId: 1, clientX: 600 }); expect(grip).toHaveAttribute('aria-valuenow', '360');
    pointer(grip, 'pointerdown', { pointerId: 3, button: 0, clientX: 500 });
    pointer(grip, 'lostpointercapture', { pointerId: 3 });
    pointer(grip, 'pointermove', { pointerId: 3, clientX: 600 }); expect(grip).toHaveAttribute('aria-valuenow', '360');
  });
});
