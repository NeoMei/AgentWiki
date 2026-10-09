import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Markdown } from '../../components/Markdown';
import { captureReadingSelection } from './readingSelection';
vi.mock('../../context/LanguageContext', () => ({ useLanguage: () => ({ language: 'en', t: (key: string) => key }) }));
const version = '2026-10-06T01:00:00Z';
afterEach(cleanup);
const setup = (source: string) => {
  const rendered = render(<MemoryRouter><Markdown selectionSourceVersion={version}>{source}</Markdown></MemoryRouter>);
  return rendered.container.firstElementChild as HTMLElement;
};
function text(root: HTMLElement, value: string, occurrence = 0): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes: Text[] = [];
  while (walker.nextNode()) if (walker.currentNode.textContent === value) nodes.push(walker.currentNode as Text);
  return nodes[occurrence];
}
function range(a: Node, start: number, b = a, end = a.textContent!.length) { const r = document.createRange(); r.setStart(a, start); r.setEnd(b, end); return r; }
describe('source-bound reading selection', () => {
  it('uses actual offsets for repeated text and keeps UTF16 quotes', () => {
    const source = 'repeat\n\nrepeat 😀 tail', root = setup(source);
    const result = captureReadingSelection(root, range(text(root, 'repeat 😀 tail'), 0, text(root, 'repeat 😀 tail'), 9), source, version, version);
    expect(result).toMatchObject({ from: 8, to: 17, quote: 'repeat 😀' });
  });
  it('includes raw inline markup between accurately mapped endpoints', () => {
    const source = 'hello **bold** and [link](https://example.test) end', root = setup(source);
    expect(captureReadingSelection(root, range(text(root, 'hello '), 0, text(root, ' end'), 4), source, version, version)?.quote).toBe(source);
  });
  it('maps table cell text without guessing repeated values', () => {
    const source = '| A | B |\n|---|---|\n| same | same |', root = setup(source);
    const second = text(root, 'same', 1);
    expect(captureReadingSelection(root, range(second, 0), source, version, version)?.from).toBe(source.lastIndexOf('same'));
  });
  it('rejects unknown generated text, nested render instances, and stale versions', () => {
    const source = 'first\n\nlast', root = setup(source);
    const first = text(root, 'first'), last = text(root, 'last');
    const extra = document.createElement('span'); extra.textContent = 'generated'; root.insertBefore(extra, root.lastElementChild);
    expect(captureReadingSelection(root, range(first, 0, last, 4), source, version, version)).toBeNull(); extra.remove();
    const nested = document.createElement('span'); nested.dataset.markdownSelectionRoot = 'embedded'; first.parentElement!.before(nested); nested.appendChild(first.parentElement!);
    expect(captureReadingSelection(root, range(first, 0), source, version, version)).toBeNull();
    expect(captureReadingSelection(root, range(last, 0), source, '2026-10-07T01:00:00Z', version)).toBeNull();
  });
});
