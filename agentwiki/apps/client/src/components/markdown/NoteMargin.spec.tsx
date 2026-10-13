import { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { NoteMargin } from './NoteMargin';

const segments = [{ from: 0, to: 6, ids: ['note'] }];
function Fixture() {
  const root = useRef<HTMLDivElement>(null);
  return <LanguageProvider><div ref={root} data-markdown-selection-root="article">
    <details><summary>Expand</summary><span className="personal-note-highlight" data-note-ids='["note"]'>hidden</span></details>
    <NoteMargin root={root} source="hidden" segments={segments} onActivate={() => {}} />
  </div></LanguageProvider>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('personal note margin visibility', () => {
  it('omits hidden details notes and remeasures when details opens or closes without a window resize', () => {
    // JSDOM has no layout. Model the browser's empty rect list for a closed details body,
    // keeping the real component, observer setup, and native toggle event behavior.
    const original = HTMLElement.prototype.getClientRects;
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains('personal-note-highlight')) return original.call(this);
      const rects = this.closest('details')?.hasAttribute('open') ? [new DOMRect(10, 120, 80, 18)] : [];
      return Object.assign(rects, { item: (index: number) => rects[index] ?? null }) as unknown as DOMRectList;
    });
    const { container } = render(<Fixture />);
    expect(container.querySelector('[data-note-marker]')).toBeNull();
    const details = container.querySelector('details')!;
    act(() => { details.open = true; details.dispatchEvent(new Event('toggle')); });
    expect(container.querySelector<HTMLElement>('[data-note-marker]')?.style.top).toBe('118px');
    act(() => { details.open = false; details.dispatchEvent(new Event('toggle')); });
    expect(container.querySelector('[data-note-marker]')).toBeNull();
  });
});
