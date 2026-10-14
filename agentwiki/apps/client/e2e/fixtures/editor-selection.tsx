import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { MarkdownWorkspace } from '../../src/components/MarkdownWorkspace';
import type { MarkdownSelection } from '../../src/components/markdown-tools/DocumentTools';
import { LanguageProvider } from '../../src/context/LanguageContext';
import '../../src/index.css';

const INITIAL_SOURCE = [
  '第一行：请在这一行拖动选择中文文字，检查选区背景是否清晰可见。',
  '第二行：继续拖到这一行，检查跨行选区的最后一行同样可见。',
  '长行：这是一条没有换行符的长段落，用于检查自动折行后的选区。'.repeat(4),
  '格式行：这里有 **粗体文字** 和 [链接文字](https://example.test/selection)，也可以选中普通文字后点击加粗。',
].join('\n');

const EMPTY_SELECTION: MarkdownSelection = { from: 0, to: 0, text: '' };

function SelectionFixture() {
  const [source, setSource] = useState(INITIAL_SOURCE);
  const [selection, setSelection] = useState<MarkdownSelection>(EMPTY_SELECTION);
  const [generation, setGeneration] = useState(0);

  const reset = () => {
    setSource(INITIAL_SOURCE);
    setSelection(EMPTY_SELECTION);
    setGeneration((current) => current + 1);
  };

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '24px 32px 48px' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>编辑选区回归 · 真实 Markdown 编辑器</h1>
        <p style={{ marginTop: 8, color: '#525252' }}>依次检查同行正反拖选、Shift + 方向键、跨行和自动折行，再使用编辑器工具栏加粗选中文字。</p>
        <button type="button" onClick={reset} style={{ marginTop: 12, padding: '6px 12px', border: '1px solid #a3a3a3', borderRadius: 6 }}>重置测试内容</button>
      </header>

      <section aria-label="选区结果" style={{ padding: 12, marginBottom: 56, border: '1px solid #d4d4d4', borderRadius: 8 }}>
        <p>范围：<output aria-label="选区范围">{selection.from}–{selection.to}</output> · 字符数：<output aria-label="选区字符数">{selection.text.length}</output></p>
        <output aria-label="所选文字" style={{ display: 'block', height: 64, marginTop: 8, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#262626' }}>{selection.text || '（尚未选择文字）'}</output>
      </section>

      <MarkdownWorkspace
        key={generation}
        value={source}
        mode="edit"
        onChange={setSource}
        onSelectionChange={setSelection}
      />

      <details style={{ marginTop: 16 }}>
        <summary>查看当前 Markdown 原文，核对格式化范围</summary>
        <pre aria-label="当前 Markdown 原文" style={{ marginTop: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13 }}>{source}</pre>
      </details>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <MemoryRouter>
    <LanguageProvider>
      <SelectionFixture />
    </LanguageProvider>
  </MemoryRouter>,
);
