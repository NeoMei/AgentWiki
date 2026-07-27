import { forwardRef, useImperativeHandle } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { useLanguage } from '../context/LanguageContext';
import { Markdown } from './Markdown';
import { PageLinkTarget } from './markdownLinks';
import { ModeToggleButton } from './ModeToggleButton';

export type MarkdownMode = 'edit' | 'preview';

interface MarkdownWorkspaceProps {
  value: string;
  mode: MarkdownMode;
  onChange: (next: string) => void;
  onModeChange: (mode: MarkdownMode) => void;
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
  { tag: tags.heading1, fontSize: '1.875em', fontWeight: '700', lineHeight: '1.3' },
  { tag: tags.heading2, fontSize: '1.5em', fontWeight: '700', lineHeight: '1.35' },
  { tag: tags.heading3, fontSize: '1.25em', fontWeight: '700', lineHeight: '1.4' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.quote, color: '#6b7280', fontStyle: 'italic' },
  { tag: tags.monospace, fontFamily: 'ui-monospace, monospace', backgroundColor: '#f3f4f6', borderRadius: '3px', padding: '0 3px' },
  { tag: tags.link, color: '#2563eb', textDecoration: 'underline' },
  { tag: tags.url, color: '#2563eb' },
  { tag: tags.processingInstruction, color: '#9ca3af' },
  { tag: tags.meta, color: '#9ca3af' },
]);

// Obsidian-style live preview: a single CodeMirror document where the line the
// cursor is on shows raw markdown and every other line is rendered with
// formatting (headings, bold, lists…). Preview mode is fully read-only render.
export const MarkdownWorkspace = forwardRef<MarkdownWorkspaceHandle, MarkdownWorkspaceProps>(({ value, mode, onChange, onModeChange, pages = [] }, ref) => {
  const { t } = useLanguage();
  const isEdit = mode === 'edit';

  useImperativeHandle(ref, () => ({
    simulateChange: (next: string) => onChange(next),
    currentValue: () => value,
  }), [onChange, value]);

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" aria-label={t('editor.mode')}>
      <div className="flex items-center justify-end gap-2 border-b border-gray-200 bg-gray-50/80 px-2 py-1.5">
        <ModeToggleButton mode={mode} onToggle={() => onModeChange(isEdit ? 'preview' : 'edit')} />
      </div>

      <div
        data-testid="md-editor-surface"
        className="h-[calc(100vh-245px)] min-h-[480px] overflow-auto bg-white"
        aria-label={isEdit ? t('editor.editMode') : t('editor.previewMode')}
      >
        {isEdit ? (
          <CodeMirror
            value={value}
            onChange={(next) => onChange(next)}
            extensions={[markdown({ base: markdownLanguage, codeLanguages: languages }), syntaxHighlighting(livePreviewStyle)]}
            placeholder={t('editor.placeholder')}
            aria-label={t('editor.editMode')}
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: true,
              highlightActiveLineGutter: false,
            }}
            className="h-full [&_.cm-content]:px-6 [&_.cm-content]:py-6 [&_.cm-content]:md:px-10 [&_.cm-editor]:h-full [&_.cm-scroller]:leading-7 [&_.cm-scroller]:text-[15px] [&_.cm-scroller]:text-gray-800"
          />
        ) : (
          <div className="px-6 py-6 md:px-10 md:py-8" data-testid="md-preview">
            <div className="mx-auto max-w-4xl">
              {value ? (
                <Markdown pages={pages}>{value}</Markdown>
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
