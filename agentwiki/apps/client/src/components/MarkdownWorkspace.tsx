import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { Eye, PenLine } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export type MarkdownMode = 'edit' | 'preview';

interface MarkdownWorkspaceProps {
  value: string;
  mode: MarkdownMode;
  onChange: (next: string) => void;
  onModeChange: (mode: MarkdownMode) => void;
}

const markdownClass = `prose prose-sm max-w-none
  [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:mt-6
  [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mb-3 [&_h2]:mt-5
  [&_h3]:text-xl [&_h3]:font-bold [&_h3]:mb-2 [&_h3]:mt-4
  [&_p]:mb-3 [&_p]:leading-7
  [&_ul]:ml-6 [&_ul]:list-disc [&_ul]:mb-3
  [&_ol]:ml-6 [&_ol]:list-decimal [&_ol]:mb-3
  [&_li]:mb-1 [&_a]:text-blue-600 [&_a]:hover:underline
  [&_strong]:font-bold [&_em]:italic
  [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-4 [&_blockquote]:text-gray-600 [&_blockquote]:italic [&_blockquote]:my-4
  [&_pre]:bg-gray-50 [&_pre]:p-4 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:mb-4
  [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-mono
  [&_pre_code]:bg-transparent [&_pre_code]:p-0
  [&_table]:w-full [&_table]:border-collapse [&_table]:mb-4
  [&_th]:border [&_th]:border-gray-300 [&_th]:px-3 [&_th]:py-2 [&_th]:bg-gray-50 [&_th]:font-semibold [&_th]:text-left
  [&_td]:border [&_td]:border-gray-300 [&_td]:px-3 [&_td]:py-2
  [&_hr]:border-gray-300 [&_hr]:my-6 [&_del]:line-through
  [&_input[type=checkbox]]:mr-2`;

// Split markdown into block-level chunks separated by blank lines. Each block
// is rendered independently; clicking a block swaps just that block into an
// editor while the rest stay rendered.
const splitBlocks = (value: string): string[] => {
  const normalized = value.replace(/\r\n/g, '\n');
  const parts = normalized.split(/\n{2,}/);
  return parts.length === 1 && parts[0] === '' ? [] : parts;
};

export const MarkdownWorkspace: React.FC<MarkdownWorkspaceProps> = ({ value, mode, onChange, onModeChange }) => {
  const { t } = useLanguage();
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const blocks = useMemo(() => splitBlocks(value), [value]);

  useEffect(() => {
    if (mode === 'preview') setEditingIndex(null);
  }, [mode]);

  useEffect(() => {
    if (editingIndex !== null && editorRef.current) {
      editorRef.current.focus();
      const length = editorRef.current.value.length;
      editorRef.current.setSelectionRange(length, length);
    }
  }, [editingIndex]);

  const commitBlock = (index: number, nextBlock: string) => {
    const next = blocks.slice();
    next[index] = nextBlock;
    onChange(next.join('\n\n'));
  };

  const renderBlock = (block: string, index: number) => {
    if (mode === 'edit' && editingIndex === index) {
      return (
        <textarea
          key={index}
          ref={editorRef}
          data-testid="md-block-editor"
          value={block}
          onChange={(event) => commitBlock(index, event.target.value)}
          onBlur={() => setEditingIndex(null)}
          onKeyDown={(event) => { if (event.key === 'Escape') setEditingIndex(null); }}
          rows={Math.min(20, Math.max(2, block.split('\n').length + 1))}
          className="w-full resize-y rounded-md border border-blue-300 bg-blue-50/40 px-3 py-2 font-mono text-[15px] leading-7 text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
          aria-label={t('editor.editMode')}
          spellCheck
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
        className={`${markdownClass} rounded-md px-3 py-2 transition ${clickable ? 'cursor-text hover:bg-gray-50' : ''}`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{block}</ReactMarkdown>
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

      <div className="h-[calc(100vh-245px)] min-h-[480px] overflow-auto bg-white px-6 py-6 md:px-10 md:py-8" aria-label={isEdit ? t('editor.editMode') : t('editor.previewMode')}>
        <div className="mx-auto max-w-4xl space-y-1">
          {blocks.length ? (
            blocks.map((block, index) => renderBlock(block, index))
          ) : (
            <p className="py-12 text-center text-sm text-gray-400">{isEdit ? t('editor.placeholder') : t('editor.emptyPreview')}</p>
          )}
          {isEdit && blocks.length > 0 && editingIndex === null ? (
            <button
              type="button"
              onClick={() => setEditingIndex(blocks.length)}
              className="mt-2 w-full rounded-md border border-dashed border-gray-300 px-3 py-2 text-left text-sm text-gray-400 hover:border-blue-300 hover:text-blue-600"
            >
              {t('editor.addBlock')}
            </button>
          ) : null}
          {isEdit && editingIndex === blocks.length && blocks.length > 0 ? (
            <textarea
              ref={editorRef}
              value=""
              onChange={(event) => onChange(blocks.concat(event.target.value).join('\n\n'))}
              onBlur={() => setEditingIndex(null)}
              onKeyDown={(event) => { if (event.key === 'Escape') setEditingIndex(null); }}
              rows={3}
              className="w-full resize-y rounded-md border border-blue-300 bg-blue-50/40 px-3 py-2 font-mono text-[15px] leading-7 text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
              aria-label={t('editor.editMode')}
              spellCheck
            />
          ) : null}
        </div>
      </div>
    </section>
  );
};
