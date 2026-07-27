import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { Eye, PenLine } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export type MarkdownMode = 'edit' | 'preview';

interface MarkdownWorkspaceProps {
  value: string;
  mode: MarkdownMode;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
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

export const MarkdownWorkspace: React.FC<MarkdownWorkspaceProps> = ({ value, mode, onChange, onModeChange }) => {
  const { t } = useLanguage();

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" aria-label={t('editor.mode')}>
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-gray-200 bg-gray-50/80 px-3 py-2">
        <div className="inline-flex rounded-lg bg-gray-200/70 p-1" role="group" aria-label={t('editor.mode')}>
          <button
            type="button"
            onClick={() => onModeChange('edit')}
            aria-pressed={mode === 'edit'}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              mode === 'edit' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <PenLine size={16} aria-hidden="true" />
            {t('common.edit')}
          </button>
          <button
            type="button"
            onClick={() => onModeChange('preview')}
            aria-pressed={mode === 'preview'}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              mode === 'preview' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Eye size={16} aria-hidden="true" />
            {t('common.preview')}
          </button>
        </div>
        <div className="hidden items-center gap-3 text-xs text-gray-400 sm:flex">
          <span>{t('editor.markdown')}</span>
          <span>{t('editor.shortcut')}</span>
        </div>
      </div>

      <div className="h-[calc(100vh-245px)] min-h-[480px] bg-white">
        {mode === 'edit' ? (
          <textarea
            value={value}
            onChange={onChange}
            className="h-full w-full resize-none border-0 bg-white px-6 py-6 font-mono text-[15px] leading-7 text-gray-800 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 md:px-10 md:py-8"
            placeholder={t('editor.placeholder')}
            aria-label={t('editor.editMode')}
            spellCheck="true"
          />
        ) : (
          <div className="h-full overflow-auto px-6 py-6 md:px-10 md:py-8" aria-label={t('editor.previewMode')}>
            <div className="mx-auto max-w-4xl">
              {value ? (
                <div className={markdownClass}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{value}</ReactMarkdown>
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-gray-400">{t('editor.emptyPreview')}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
