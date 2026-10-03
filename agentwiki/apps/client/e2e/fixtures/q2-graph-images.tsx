import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '../../src/context/LanguageContext';
import { KnowledgeGraph } from '../../src/features/knowledge/KnowledgeGraph';
import { Markdown } from '../../src/components/Markdown';
import { MarkdownWorkspace } from '../../src/components/MarkdownWorkspace';
import '../../src/index.css';
const source = '![External](https://images.example.test/wide.png)\n\n![Attachment](../assets/wide.png)';
function Fixture() {
  const [show, setShow] = useState(true);
  return <LanguageProvider><MemoryRouter initialEntries={['/spaces/fixture/graph']}>
    <div className="p-4"><button onClick={() => setShow(!show)}>Toggle images</button>
      <Routes><Route path="/spaces/:spaceId/graph" element={<KnowledgeGraph />} /><Route path="/pages/:pageId" element={<p>Opened page</p>} /></Routes>
      {show && <><section aria-label="Page image fixture"><Markdown mode="page" spaceId="fixture" pageId="page">{source}</Markdown></section>
        <section aria-label="Editor preview fixture"><MarkdownWorkspace mode="preview" spaceId="fixture" pageId="page" value={source} onChange={() => {}} /></section></>}
    </div>
  </MemoryRouter></LanguageProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
