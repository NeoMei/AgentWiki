import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../context/LanguageContext';
import { UsageGuide } from '../features/about/UsageGuide';
import { DocsFeatures } from '../features/docs/DocsFeatures';

const copy = {
  'zh-CN': {
    title: 'Markdown 编辑与共享预览',
    syntax: '支持 CommonMark 与 GFM 标题、强调、链接、列表、引用、删除线、表格、任务清单、围栏代码与代码高亮，以及 Wiki 链接、别名、标题链接、块链接、==高亮== 和 Callout。数学公式使用 $...$ 和 $$...$$；Mermaid 使用围栏语法：```mermaid ... ```。',
    safety: '原始 HTML 已禁用；Mermaid 点击与 HTML 标签已禁用；格式错误的公式或图表会在当前内容块显示可读回退；每份根文档最多渲染 20 个 Mermaid 图表。',
    checklist: '清单模式：编辑器预览中勾选只更新未保存草稿，保存页面后持久化；已发布页面中，所有者、管理员和编辑者勾选会立即保存并生成新版本；查看者与历史版本预览只读。',
    forbidden: [/实时预览/u, /所见即所得/u, /图片附件/u],
  },
  en: {
    title: 'Markdown editing and shared preview',
    syntax: 'Supports CommonMark and GFM headings, emphasis, links, lists, blockquotes, strikethrough, tables, task lists, fenced code and syntax highlighting, plus wiki links, aliases, heading links, block links, ==highlights==, and Callouts. Use $...$ and $$...$$ for math; use fenced Mermaid syntax: ```mermaid ... ```.',
    safety: 'Raw HTML is disabled. Mermaid clicks and HTML labels are disabled. Malformed formulas or diagrams show a readable fallback in place. Each root document renders at most 20 Mermaid diagrams.',
    checklist: 'Checklist modes: toggling in editor preview updates only the unsaved draft and persists when the page is saved; on a published page, owner, admin, and editor toggles save immediately and create a new version; viewer and version-history previews are read-only.',
    forbidden: [/live WYSIWYG preview/iu, /image attachments/iu],
  },
} as const;

const renderSurface = (surface: React.ReactNode, language: keyof typeof copy) => {
  localStorage.setItem('agentwiki.language.v1', language);
  return render(
    <LanguageProvider>
      <MemoryRouter>{surface}</MemoryRouter>
    </LanguageProvider>,
  );
};

describe('Markdown support documentation', () => {
  afterEach(cleanup);

  it.each(['zh-CN', 'en'] as const)('renders truthful %s support and checklist modes on both guide surfaces', (language) => {
    for (const surface of [<UsageGuide key="usage" />, <DocsFeatures key="features" />]) {
      const view = renderSurface(surface, language);

      expect(screen.getByText(copy[language].title)).toBeInTheDocument();
      expect(screen.getByText(copy[language].syntax)).toBeInTheDocument();
      expect(screen.getByText(copy[language].safety)).toBeInTheDocument();
      expect(screen.getByText(copy[language].checklist)).toBeInTheDocument();
      for (const forbidden of copy[language].forbidden) {
        expect(view.container.textContent).not.toMatch(forbidden);
      }

      view.unmount();
    }
  });
});
