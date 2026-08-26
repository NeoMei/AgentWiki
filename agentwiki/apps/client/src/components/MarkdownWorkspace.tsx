import { forwardRef, useImperativeHandle } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import { Range } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { syntaxTree } from '@codemirror/language';
import { useLanguage } from '../context/LanguageContext';
import { Markdown } from './Markdown';
import { toggleMarkdownTask } from './markdown/tasks';
import { PageLinkTarget, resolveWikiHref } from './markdownLinks';

export type MarkdownMode = 'edit' | 'preview';

interface MarkdownWorkspaceProps {
  value: string;
  mode: MarkdownMode;
  onChange: (next: string) => void;
  onModeChange?: (mode: MarkdownMode) => void;
  pages?: PageLinkTarget[];
}

export interface MarkdownWorkspaceHandle {
  /** Test hook: drive a content change as if the user typed it. */
  simulateChange: (next: string) => void;
  currentValue: () => string;
}

// Live-preview formatting: render markdown structure (headings, emphasis,
// quotes, code) while editing, like Obsidian. Cursor line still shows source.
const livePreviewStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '30px', fontWeight: '700', lineHeight: '1.3' },
  { tag: tags.heading2, fontSize: '24px', fontWeight: '700', lineHeight: '1.35' },
  { tag: tags.heading3, fontSize: '20px', fontWeight: '700', lineHeight: '1.4' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.quote, color: '#6b7280', fontStyle: 'italic' },
  { tag: tags.monospace, fontFamily: 'ui-monospace, monospace', backgroundColor: '#f3f4f6', borderRadius: '3px', padding: '0 3px' },
  { tag: tags.link, color: '#2563eb', textDecoration: 'underline' },
  { tag: tags.url, color: '#2563eb' },
  { tag: tags.processingInstruction, color: '#9ca3af', class: 'cm-md-marker' },
  { tag: tags.meta, color: '#9ca3af', class: 'cm-md-marker' },
]);

// Obsidian-style live preview: a single CodeMirror document where the line the
// cursor is on shows raw markdown and every other line is rendered with
// formatting (headings, bold, lists…). Preview mode is fully read-only render.

// Hide markdown markers (and the single space after a heading's `#` run) on
// every line except the one the cursor/selection is on, so non-active lines
// align flush with body text — like Obsidian. Active line keeps full source.
class WikiLinkWidget extends WidgetType {
  constructor(readonly name: string, readonly href: string | null) { super(); }
  eq(other: WikiLinkWidget) { return other.name === this.name && other.href === this.href; }
  toDOM() {
    const a = document.createElement('a');
    a.textContent = this.name;
    if (this.href) {
      a.href = this.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'text-blue-600 underline cursor-pointer';
    } else {
      a.className = 'text-gray-400';
    }
    return a;
  }
  ignoreEvent() { return false; }
}

const WIKILINK_RE = /\[\[([^\][]+)\]\]/g;

const buildHiddenMarksPlugin = (pages: PageLinkTarget[]) => ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = this.compute(view);
  }
  update(update: ViewUpdate) {
    this.decorations = this.compute(update.view);
  }
  compute(view: EditorView): DecorationSet {
    const ranges: Range<Decoration>[] = [];
    const activeLines = new Set<number>();
    for (const range of view.state.selection.ranges) {
      const from = view.state.doc.lineAt(range.from).number;
      const to = view.state.doc.lineAt(range.to).number;
      for (let n = from; n <= to; n += 1) activeLines.add(n);
    }
    syntaxTree(view.state).iterate({
      enter: (node) => {
        const line = view.state.doc.lineAt(node.from).number;
        if (activeLines.has(line)) return;
        const name = node.name;
        // HeaderMark / EmphasisMark / QuoteMark / CodeMark etc. carry the
        // literal marker characters (##, **, >, `).
        if (name === 'HeaderMark') {
          // include the single following space so "## 标题" -> "标题" flush left
          const after = view.state.doc.sliceString(node.to, node.to + 1);
          const end = after === ' ' ? node.to + 1 : node.to;
          ranges.push(Decoration.replace({}).range(node.from, end));
          return false;
        }
        if (name === 'EmphasisMark' || name === 'CodeMark' || name === 'QuoteMark' || name === 'LinkMark' || name === 'URL') {
          ranges.push(Decoration.replace({}).range(node.from, node.to));
          return false;
        }
        return undefined;
      },
    });
    // Wiki-links: replace [[Name]] with a resolved link on non-active lines.
    const doc = view.state.doc;
    for (let n = 1; n <= doc.lines; n += 1) {
      if (activeLines.has(n)) continue;
      const text = doc.line(n).text;
      WIKILINK_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = WIKILINK_RE.exec(text))) {
        const pageName = match[1];
        const href = resolveWikiHref(pageName, pages);
        if (!href) continue;
        const lineFrom = doc.line(n).from;
        ranges.push(
          Decoration.replace({ widget: new WikiLinkWidget(pageName, href) })
            .range(lineFrom + match.index, lineFrom + match.index + match[0].length),
        );
      }
    }
    return Decoration.set(ranges, true);
  }
}, { decorations: (value) => value.decorations });

export const MarkdownWorkspace = forwardRef<MarkdownWorkspaceHandle, MarkdownWorkspaceProps>(({ value, mode, onChange, pages = [] }, ref) => {
  const { t } = useLanguage();
  const isEdit = mode === 'edit';

  useImperativeHandle(ref, () => ({
    simulateChange: (next: string) => onChange(next),
    currentValue: () => value,
  }), [onChange, value]);

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" aria-label={t('editor.mode')}>
      <div
        data-testid="md-editor-surface"
        className="h-[calc(100vh-245px)] min-h-[480px] overflow-auto bg-white"
        aria-label={isEdit ? t('editor.editMode') : t('editor.previewMode')}
      >
        {isEdit ? (
          <CodeMirror
            value={value}
            onChange={(next) => onChange(next)}
            extensions={[markdown({ base: markdownLanguage, codeLanguages: languages }), syntaxHighlighting(livePreviewStyle), buildHiddenMarksPlugin(pages), EditorView.lineWrapping]}
            placeholder={t('editor.placeholder')}
            aria-label={t('editor.editMode')}
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: true,
              highlightActiveLineGutter: false,
            }}
            className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:leading-7 [&_.cm-scroller]:text-[15px] [&_.cm-scroller]:text-gray-800 [&_.cm-content]:mx-auto [&_.cm-content]:max-w-4xl [&_.cm-content]:px-6 [&_.cm-content]:py-6 [&_.cm-content]:md:px-10 [&_.cm-content]:md:py-8"
          />
        ) : (
          <div className="px-6 py-6 md:px-10 md:py-8" data-testid="md-preview">
            <div className="mx-auto max-w-4xl">
              {value ? (
                <Markdown
                  mode="editor-preview"
                  canEdit
                  onTaskToggle={({ task, nextChecked }) => {
                    const next = toggleMarkdownTask(value, task, nextChecked);
                    if (next !== null) onChange(next);
                  }}
                  pages={pages}
                >
                  {value}
                </Markdown>
              ) : (
                <p className="py-12 text-center text-sm text-gray-400">{t('editor.emptyPreview')}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
});
MarkdownWorkspace.displayName = 'MarkdownWorkspace';
