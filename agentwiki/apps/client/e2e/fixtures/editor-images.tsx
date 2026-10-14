import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { MarkdownWorkspace, type MarkdownMode } from '../../src/components/MarkdownWorkspace';
import { LanguageProvider } from '../../src/context/LanguageContext';
import '../../src/index.css';

const INITIAL_SOURCE = [
  '![首行图片](/e2e/fixtures/editor-image.svg "原始标题")',
  '',
  '上方图片应在进入编辑模式时显示。点击图片可以修改链接，离开图片行后恢复预览。',
  '',
  '![第二张图片](/e2e/fixtures/editor-image.svg?second=1)',
  '',
  '文末正文：可在这里输入文字或拖动选择。',
  '',
  '![加载失败的图片](/e2e/fixtures/missing-editor-image.png)',
  '',
  '`![代码中的图片](/e2e/fixtures/editor-image.svg)`',
].join('\n');

function Fixture() {
  const [source, setSource] = useState(INITIAL_SOURCE);
  const [mode, setMode] = useState<MarkdownMode>('edit');
  const [generation, setGeneration] = useState(0);
  const [attachments, setAttachments] = useState(false);
  return <main style={{ maxWidth: 900, margin: 'auto', padding: 32 }}>
    <h1 style={{ fontSize: 24, fontWeight: 600 }}>编辑态图片 · 真实编辑器回归</h1>
    <p style={{ marginTop: 8 }}>点击图片展开 Markdown 链接，点击正文恢复图片；检查键盘导航、修改地址与撤销。</p>
    <nav style={{ display: 'flex', gap: 16, marginTop: 16, marginBottom: 56 }}>
      <button onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}>{mode === 'edit' ? '预览' : '编辑'}</button>
      <button onClick={() => { setSource(INITIAL_SOURCE); setMode('edit'); setAttachments(false); setGeneration(g => g + 1); }}>重置</button>
      <button onClick={() => { setSource('附件预览示例（本地模拟 API）\n\n![[test.jpg]]\n\n![相对路径附件](assets/test.jpg)\n\n文末正文'); setMode('edit'); setAttachments(true); setGeneration(g => g + 1); }}>附件加载样例</button>
    </nav>
    <MarkdownWorkspace key={generation} value={source} mode={mode} onChange={setSource} spaceId={attachments ? 'editor-image-fixture' : undefined} pageId={attachments ? 'image-fixture-page' : undefined} />
    <details style={{ marginTop: 24 }}>
      <summary>当前 Markdown 原文</summary>
      <pre aria-label="当前 Markdown 原文" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 12 }}>{source}</pre>
    </details>
  </main>;
}

createRoot(document.getElementById('root')!).render(<MemoryRouter><LanguageProvider><Fixture /></LanguageProvider></MemoryRouter>);
