import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { codeFolding, foldEffect, foldedRanges } from '@codemirror/language';
import { StateEffect } from '@codemirror/state';
import { MarkdownWorkspace } from '../../src/components/MarkdownWorkspace';
import { LanguageProvider } from '../../src/context/LanguageContext';
import { outlineFor, type MarkdownOutlineItem } from '../../src/components/markdown-tools/outline';
import '../../src/index.css';

export interface OutlineMetrics {
  source: string;
  selection: number;
  folds: number;
  toolbarBottom: number;
  headings: Array<MarkdownOutlineItem & { top: number | null }>;
  scrollTop: number;
}

declare global {
  interface Window {
    outlineFixture: { short: () => void; fold: () => void; metrics: () => OutlineMetrics };
  }
}

const longSource = Array.from({ length: 25 }, (_, i) =>
  `# ${i === 5 || i === 6 ? 'Repeated heading' : `Chapter ${i}`}\n\n${`Paragraph ${i}: 中文软折行正文 with **strong** formatting. `.repeat(80)}\n\n`,
).join('') + '# Final chapter\n\n## Final child\nEnd.';
const shortSource = '# Short start\n\nA short document.\n\n## Short end\nEnd.';

function Fixture() {
  const [source, setSource] = useState(longSource);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const getView = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
    Object.assign(window, { outlineFixture: {
      short: () => setSource(shortSource),
      fold: () => {
        const view = getView(), text = view.state.doc.toString();
        const from = text.indexOf('\n', text.indexOf('# Final chapter'));
        view.dispatch({ effects: [StateEffect.appendConfig.of(codeFolding()), foldEffect.of({ from, to: text.length })] });
      },
      metrics: () => {
        const view = getView();
        return {
          source: view.state.doc.toString(), selection: view.state.selection.main.head,
          folds: foldedRanges(view.state).size,
          toolbarBottom: document.querySelector('[data-testid="editor-toolbar"]')!.getBoundingClientRect().bottom,
          headings: outlineFor(view.state.doc.toString()).map((heading) => ({
            ...heading, top: view.coordsAtPos(heading.from)?.top ?? null,
          })),
          scrollTop: document.querySelector('[data-testid="outline-scroll"]')!.scrollTop,
        };
      },
    } });
  }, []);
  return <>
    <div data-testid="editor-toolbar" style={{ position: 'fixed', inset: '0 0 auto', height: 98, background: 'white', zIndex: 30 }}>Editor toolbar</div>
    <div data-testid="outline-scroll" style={{ position: 'fixed', inset: '98px min(220px, 34vw) 0 0', overflow: 'auto', padding: 24 }}>
      <MarkdownWorkspace value={source} mode="edit" onChange={setSource} externalOutline outlineContainer={host} />
    </div>
    <div ref={setHost} style={{ position: 'fixed', inset: '98px 0 0 auto', width: 'min(220px, 34vw)', display: 'flex', flexDirection: 'column' }} />
  </>;
}

localStorage.setItem('agentwiki.language.v1', 'en');
createRoot(document.getElementById('root')!).render(<LanguageProvider><Fixture /></LanguageProvider>);
