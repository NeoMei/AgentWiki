import React, { createContext, useContext, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { isExternalHref, isInternalPageHref, PageLinkTarget, resolveWikiHref } from './markdownLinks';
import type { MarkdownRenderMode, MarkdownTaskToggle } from './markdown/markdownTypes';
import { remarkAgentWikiObsidian } from './markdown/obsidian';
import { collectMarkdownTasks } from './markdown/tasks';

export const markdownClass = `prose prose-sm max-w-none
  [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:mt-6
  [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mb-3 [&_h2]:mt-5
  [&_h3]:text-xl [&_h3]:font-bold [&_h3]:mb-2 [&_h3]:mt-4
  [&_p]:mb-3 [&_p]:leading-7
  [&_ul]:ml-6 [&_ul]:list-disc [&_ul]:mb-3
  [&_ol]:ml-6 [&_ol]:list-decimal [&_ol]:mb-3
  [&_li]:mb-1 [&_a]:text-blue-600 [&_a]:hover:underline
  [&_strong]:font-bold [&_em]:italic
  [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-4 [&_blockquote]:text-gray-600 [&_blockquote]:italic [&_blockquote]:my-4
  [&_[data-callout]]:my-4 [&_[data-callout]]:rounded-lg [&_[data-callout]]:border [&_[data-callout]]:p-4
  [&_[data-callout]_p:last-child]:mb-0
  [&_.callout-neutral]:border-gray-300 [&_.callout-neutral]:bg-gray-50
  [&_mark]:rounded [&_mark]:bg-yellow-200 [&_mark]:px-0.5
  [&_.block-anchor]:relative [&_.block-anchor]:top-[-5rem]
  [&_.task-list-item]:list-none [&_.contains-task-list]:ml-0
  [&_pre]:bg-gray-50 [&_pre]:p-4 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:mb-4
  [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-mono
  [&_pre_code]:bg-transparent [&_pre_code]:p-0
  [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:mb-4
  [&_th]:border [&_th]:border-gray-300 [&_th]:px-3 [&_th]:py-2 [&_th]:bg-gray-50 [&_th]:font-semibold [&_th]:text-left
  [&_td]:border [&_td]:border-gray-300 [&_td]:px-3 [&_td]:py-2
  [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md
  [&_hr]:border-gray-300 [&_hr]:my-6 [&_del]:line-through
  [&_input[type=checkbox]]:mr-2`;

export interface MarkdownProps {
  children: string;
  pages?: PageLinkTarget[];
  className?: string;
  mode?: MarkdownRenderMode;
  canEdit?: boolean;
  pendingTaskIndexes?: ReadonlySet<number>;
  onTaskToggle?: (toggle: MarkdownTaskToggle) => void;
}

const KNOWN_CALLOUT_TYPES = new Set([
  'abstract', 'bug', 'danger', 'error', 'example', 'failure', 'info', 'note',
  'question', 'quote', 'success', 'summary', 'tip', 'todo', 'warning',
]);

interface CalloutProps {
  type: string;
  title: string;
  fold: string;
  children: React.ReactNode;
}

const Callout: React.FC<CalloutProps> = ({ type, title, fold, children }) => {
  const folding = fold === '+' || fold === '-';
  const [expanded, setExpanded] = useState(fold !== '-');
  const styleClass = KNOWN_CALLOUT_TYPES.has(type) ? `callout-${type}` : 'callout-neutral';

  return (
    <aside
      data-callout={type}
      data-callout-title={title}
      data-callout-fold={fold}
      className={`markdown-callout ${styleClass}`}
    >
      {folding ? (
        <button
          type="button"
          className="callout-title flex w-full items-center justify-between font-semibold"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {title}
        </button>
      ) : (
        <div className="callout-title font-semibold">{title}</div>
      )}
      {(!folding || expanded) && <div className="callout-body mt-2">{children}</div>}
    </aside>
  );
};

const isExternalHttpsImage = (src: string): boolean => /^https:\/\//i.test(src);

const isInternalImage = (src: string): boolean => {
  if (!src || src.startsWith('//') || /\\|%5c/i.test(src)) return false;
  return !/^[a-z][a-z\d+.-]*:/i.test(src);
};

const SafeImage = ({ src, alt = '', ...rest }: React.ImgHTMLAttributes<HTMLImageElement>) => {
  const source = typeof src === 'string' ? src.trim() : '';
  const external = isExternalHttpsImage(source);
  if (!external && !isInternalImage(source)) {
    const message = `Image unavailable${alt ? `: ${alt}` : ''}`;
    return <span role="img" aria-label={message} className="markdown-image-fallback">{message}</span>;
  }

  return (
    <img
      {...rest}
      src={source}
      alt={alt}
      className="markdown-image h-auto max-w-full rounded-md"
      {...(external ? { loading: 'lazy' as const, decoding: 'async' as const, referrerPolicy: 'no-referrer' as const } : {})}
    />
  );
};

const TaskIndexContext = createContext<number | null>(null);

interface TaskInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  taskInputsEnabled: boolean;
  pendingTaskIndexes: ReadonlySet<number>;
}

const TaskInput: React.FC<TaskInputProps> = ({ taskInputsEnabled, pendingTaskIndexes, ...props }) => {
  const taskIndex = useContext(TaskIndexContext);
  const pending = taskIndex !== null && pendingTaskIndexes.has(taskIndex);
  return <input {...props} disabled={!taskInputsEnabled || pending} onChange={() => undefined} />;
};

export const Markdown: React.FC<MarkdownProps> = ({
  children,
  pages = [],
  className,
  mode = 'static',
  canEdit = false,
  pendingTaskIndexes = new Set<number>(),
  onTaskToggle,
}) => {
  const tasks = useMemo(() => collectMarkdownTasks(children), [children]);
  const taskInputsEnabled = Boolean(
    onTaskToggle && (mode === 'editor-preview' || (mode === 'page' && canEdit)),
  );
  const obsidianPlugin = useMemo(
    () => remarkAgentWikiObsidian({ resolvePage: (reference) => resolveWikiHref(reference, pages) }),
    [pages],
  );

  const handleChange = (event: React.ChangeEvent<HTMLDivElement>) => {
    if (!onTaskToggle || !(event.target instanceof HTMLInputElement) || event.target.type !== 'checkbox') return;
    const listItem = event.target.closest<HTMLLIElement>('li[data-task-index]');
    const index = Number(listItem?.dataset.taskIndex);
    const task = Number.isInteger(index) ? tasks[index] : undefined;
    if (!task || !taskInputsEnabled || pendingTaskIndexes.has(index)) return;
    onTaskToggle({ task, nextChecked: event.target.checked });
  };

  return (
    <div className={className ?? markdownClass} onChange={handleChange}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, obsidianPlugin, remarkBreaks]}
        rehypePlugins={[
          rehypeSlug,
          [rehypeAutolinkHeadings, {
            behavior: 'append',
            properties: { className: ['heading-anchor'], ariaHidden: true, tabIndex: -1 },
            content: { type: 'text', value: ' #' },
          }],
          rehypeHighlight,
        ]}
        components={{
          a: ({ href, children: linkChildren, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
            if (isInternalPageHref(href)) {
              return <Link to={href!} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" {...rest}>{linkChildren}</Link>;
            }
            if (isExternalHref(href)) {
              return <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" {...rest}>{linkChildren}</a>;
            }
            return <a href={href} className="text-blue-600 hover:underline" {...rest}>{linkChildren}</a>;
          },
          blockquote: ({ children: quoteChildren, node, ...props }) => {
            const properties = node?.properties ?? {};
            const calloutType = String(properties['data-callout'] ?? '');
            if (calloutType) {
              return (
                <Callout
                  type={calloutType}
                  title={String(properties['data-callout-title'] ?? calloutType)}
                  fold={String(properties['data-callout-fold'] ?? '')}
                >
                  {quoteChildren}
                </Callout>
              );
            }
            return <blockquote {...props}>{quoteChildren}</blockquote>;
          },
          img: SafeImage,
          input: ({ node: _node, ...props }) => (
            <TaskInput
              {...props}
              taskInputsEnabled={taskInputsEnabled}
              pendingTaskIndexes={pendingTaskIndexes}
            />
          ),
          li: ({ children: listChildren, node, ...props }) => {
            const rawIndex = node?.properties?.['data-task-index'];
            const index = typeof rawIndex === 'string' || typeof rawIndex === 'number' ? Number(rawIndex) : null;
            return (
              <TaskIndexContext.Provider value={index}>
                <li {...props}>{listChildren}</li>
              </TaskIndexContext.Provider>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
};
