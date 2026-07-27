import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, PenLine } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { Markdown } from './Markdown';
import { PageLinkTarget } from './markdownLinks';

export type MarkdownMode = 'edit' | 'preview';

interface MarkdownWorkspaceProps {
  value: string;
  mode: MarkdownMode;
  onChange: (next: string) => void;
  onModeChange: (mode: MarkdownMode) => void;
  pages?: PageLinkTarget[];
}

// Split markdown into block-level chunks separated by blank lines. Each block
// is rendered independently; clicking a block swaps just that block into an
// editor while the rest stay rendered.
const splitBlocks = (value: string): string[] => {
  const normalized = value.replace(/\r\n/g, '\n');
  const parts = normalized.split(/\n{2,}/);
  return parts.length === 1 && parts[0] === '' ? [] : parts;
};

interface InlineEditorProps {
  initialValue: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
  'aria-label': string;
}

// Uncontrolled editor that mirrors the preview typography exactly, so an
// element looks like it simply became editable in place. It keeps focus while
// typing (no re-mount on each keystroke) and commits only on blur or Enter.
const InlineEditor: React.FC<InlineEditorProps> = ({ initialValue, onCommit, onCancel, 'aria-label': ariaLabel }) => {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [initialValue]);

  const commit = () => {
    const el = ref.current;
    if (el && el.value !== initialValue) onCommit(el.value);
    else onCancel();
  };

  return (
    <textarea
      ref={ref}
      data-testid="md-block-editor"
      defaultValue={initialValue}
      onInput={(event) => {
        const el = event.currentTarget;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); commit(); }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); commit(); }
      }}
      rows={1}
      className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-mono text-[15px] leading-7 text-gray-800 outline-none focus:ring-0"
      aria-label={ariaLabel}
      spellCheck
    />
  );
};

export const MarkdownWorkspace: React.FC<MarkdownWorkspaceProps> = ({ value, mode, onChange, onModeChange, pages = [] }) => {
  const { t } = useLanguage();
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const blocks = useMemo(() => splitBlocks(value), [value]);

  useEffect(() => {
    if (mode === 'preview') setEditingIndex(null);
  }, [mode]);

  const commitBlock = (index: number, nextBlock: string) => {
    const next = blocks.slice();
    next[index] = nextBlock;
    onChange(next.join('\n\n'));
  };

  const renderBlock = (block: string, index: number) => {
    if (mode === 'edit' && editingIndex === index) {
      return (
        <InlineEditor
          key={index}
          initialValue={block}
          aria-label={t('editor.editMode')}
          onCommit={(next) => { commitBlock(index, next); setEditingIndex(null); }}
          onCancel={() => setEditingIndex(null)}
        />
      );
    }
    const clickable = mode === 'edit';
    return (
      <div
        key={index}
        data-testid={`md-block-${index}`}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? () => setEditingIndex(index) : undefined}
        onKeyDown={clickable ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setEditingIndex(index); } } : undefined}
        className={`-mx-1 rounded px-1 transition ${clickable ? 'cursor-text hover:bg-blue-50/50' : ''}`}
      >
        <Markdown pages={pages}>{block}</Markdown>
      </div>
    );
  };

  const isEdit = mode === 'edit';

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" aria-label={t('editor.mode')}>
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-gray-200 bg-gray-50/80 px-3 py-2">
        <button
          type="button"
          onClick={() => onModeChange(isEdit ? 'preview' : 'edit')}
          aria-pressed={isEdit}
          aria-label={isEdit ? t('common.preview') : t('common.edit')}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-200/70 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-300/70"
        >
          {isEdit ? <PenLine size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          {isEdit ? t('common.edit') : t('common.preview')}
          <span className={`ml-1 inline-flex h-4 w-7 items-center rounded-full transition ${isEdit ? 'bg-blue-600' : 'bg-gray-400'}`}>
            <span className={`h-3 w-3 rounded-full bg-white transition ${isEdit ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
          </span>
        </button>
        <div className="hidden items-center gap-3 text-xs text-gray-400 sm:flex">
          <span>{t('editor.markdown')}</span>
          <span>{isEdit ? t('editor.clickToEdit') : t('editor.readOnly')}</span>
        </div>
      </div>

      <div
        data-testid="md-editor-surface"
        onClick={isEdit ? (event) => {
          // Clicking empty space below the content starts a new trailing element.
          if (event.target === event.currentTarget || (event.target as HTMLElement).dataset.emptyArea === 'true') {
            setEditingIndex(blocks.length);
          }
        } : undefined}
        className={`h-[calc(100vh-245px)] min-h-[480px] overflow-auto bg-white px-6 py-6 md:px-10 md:py-8 ${isEdit ? 'cursor-text' : ''}`}
        aria-label={isEdit ? t('editor.editMode') : t('editor.previewMode')}
      >
        <div className="mx-auto max-w-4xl space-y-1">
          {blocks.length ? (
            blocks.map((block, index) => renderBlock(block, index))
          ) : (
            <p data-empty-area="true" className="py-12 text-center text-sm text-gray-400">{isEdit ? t('editor.placeholder') : t('editor.emptyPreview')}</p>
          )}
          {isEdit && editingIndex === null ? <div data-empty-area="true" className="min-h-[3rem]" aria-hidden="true" /> : null}
          {isEdit && editingIndex === blocks.length ? (
            <InlineEditor
              initialValue=""
              onCommit={(next) => { onChange(blocks.concat(next).join('\n\n')); setEditingIndex(null); }}
              onCancel={() => setEditingIndex(null)}
              aria-label={t('editor.editMode')}
            />
          ) : null}
          {isEdit && editingIndex === null ? <div data-empty-area="true" className="min-h-[3rem]" aria-hidden="true" /> : null}
        </div>
      </div>
    </section>
  );
};
