import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { EditorView } from '@codemirror/view';
import { EditorSelection, StateEffect } from '@codemirror/state';
import { forceParsing, language, syntaxTree } from '@codemirror/language';
import { redo, undo, undoDepth } from '@codemirror/commands';
import { MarkdownWorkspace, type MarkdownWorkspaceHandle } from '../../src/components/MarkdownWorkspace';
import { AgentSessionPanel } from '../../src/features/agent-session/AgentSessionPanel';
import { AgentSessionRegistryProvider } from '../../src/features/agent-session/AgentSessionRegistry';
import { AuthProvider } from '../../src/context/AuthContext';
import { LanguageProvider } from '../../src/context/LanguageContext';
import '../../src/index.css';

const formattedSource = Array.from({ length: 240 }, (_, i) => `## Chapter ${i}\n\nParagraph ${i} 中文正文与 **strong** and *emphasis*.\n\n[short label](https://example.test/${'long-path/'.repeat(15)}) and [[Target|short wiki]].\n\n- List item ${i}\n- Second **bold** item\n\n> Quote ${i}\n\n| Name | Value |\n| --- | --- |\n| Row ${i} | cell |\n\n\`\`\`js\nconst number = ${i};\n\`\`\`\n\n`).join('');
const plainSource = Array.from({ length: 1500 }, (_, i) => `Plain paragraph ${i} 中文 control text without Markdown marks.\n`).join('');
function Fixture() {
  const [value, setValue] = useState(formattedSource), [revision, setRevision] = useState(0), [panel, setPanel] = useState(true);
  const [pages, setPages] = useState([{ id: 'target', title: 'Target', slug: 'target' }]);
  const [spaceId, setSpaceId] = useState<string | undefined>(undefined);
  const workspace = useRef<MarkdownWorkspaceHandle>(null);
  useEffect(() => {
    let frame = 0;
    let detach = () => {};
    const initialize = () => {
    const node = document.querySelector('.cm-editor') as HTMLElement | null;
    if (!node) { frame = requestAnimationFrame(initialize); return; }
    const getView = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
    let reconfigurations = 0;
    const view = getView(), original = view.dispatchTransactions;
    view.dispatchTransactions = (transactions, editor) => {
      reconfigurations += transactions.filter((tr) => tr.effects.some((effect) => effect.is(StateEffect.reconfigure))).length;
      original(transactions, editor);
    };
    const initialLanguage = view.state.facet(language);
    const metrics = () => {
      const view = getView();
      const decorations = view.state.facet(EditorView.decorations).map((item) => typeof item === 'function' ? item(view) : item).sort((a, b) => b.size - a.size)[0];
      const rect = view.contentDOM.getBoundingClientRect();
      return { doc: view.state.doc.toString(), selection: view.state.selection.toJSON(), treeLength: syntaxTree(view.state).length,
        reconfigurations, languageStable: initialLanguage === view.state.facet(language), decorations: decorations?.size ?? 0,
        scrollY: window.scrollY, editorScroll: view.scrollDOM.scrollTop, height: rect.height, width: rect.width, undo: undoDepth(view.state) };
    };
    Object.assign(window, { editorFixture: {
      metrics, parsed: () => forceParsing(getView(), getView().state.doc.length, 2000),
      move: (offset: number) => getView().dispatch({ selection: EditorSelection.cursor(offset) }),
      replace: (text: string) => workspace.current!.replaceDocument(text), undo: () => undo(getView()), redo: () => redo(getView()),
      rerender: () => setRevision((r) => r + 1), panel: (open: boolean) => setPanel(open), plain: () => setValue(plainSource),
      pages: () => setPages([{ id: 'updated-target', title: 'Target', slug: 'updated' }]), scope: (id: string) => setSpaceId(id),
      anchor: (offset: number) => getView().coordsAtPos(offset)?.top,
      reveal: (offset: number) => { const view = getView(); view.dispatch({ effects: EditorView.scrollIntoView(offset, { y: 'center' }) }); },
    } });
    detach = () => { view.dispatchTransactions = original; };
    };
    initialize();
    return () => { cancelAnimationFrame(frame); detach(); };
  }, []);
  return <div style={{ padding: 24 }} data-revision={revision}>
    <div style={{ width: panel ? 'calc(100% - 340px)' : '100%', maxWidth: 1000 }}>
      <MarkdownWorkspace ref={workspace} value={value} mode="edit" onChange={(next) => setValue(next)} pages={pages} spaceId={spaceId} pageId="fixture-page" />
    </div>
    {panel ? <div style={{ position: 'fixed', right: 0, top: 0, width: 330, height: '100vh', borderLeft: '1px solid #ddd', display: 'flex' }}>
      <AgentSessionPanel pageId="fixture-page" spaceId="fixture-space" pageTitle="Local fixture" canEdit snapshot={() => ({ title: 'Fixture', content: value, updatedAt: '2026-10-08T00:00:00.000Z' })} />
    </div> : null}
  </div>;
}
localStorage.setItem('user', JSON.stringify({ id: 'fixture-user' }));
createRoot(document.getElementById('root')!).render(<MemoryRouter><AuthProvider><LanguageProvider><AgentSessionRegistryProvider userId="fixture-user"><Fixture /></AgentSessionRegistryProvider></LanguageProvider></AuthProvider></MemoryRouter>);
