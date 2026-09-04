import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ExtraProps } from 'react-markdown';
import { Link } from 'react-router-dom';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import 'katex/dist/katex.min.css';
import { useLanguage } from '../context/LanguageContext';
import { AttachmentImage } from '../features/attachments/AttachmentImage';
import { isExternalHref, isInternalPageHref, PageLinkTarget, resolveWikiHref } from './markdownLinks';
import { KATEX_OPTIONS } from './markdown/math';
import type { MarkdownRenderMode, MarkdownTaskToggle } from './markdown/markdownTypes';
import { MermaidDiagram } from './markdown/MermaidDiagram';
import { MAX_MERMAID_SOURCE_CHARS } from './markdown/mermaidSecurity';
import { markdownWikiHeadingAnchorId, remarkAgentWikiObsidian } from './markdown/obsidian';
import { collectMarkdownTasks } from './markdown/tasks';
import { EmbeddedMarkdown } from './markdown/EmbeddedMarkdown';
import {
  collectMarkdownResourceRefs,
  createMarkdownTreeState,
  loadTreeResources,
  MarkdownRuntimeContext,
  type MarkdownRenderBranch,
  type MarkdownResourceMap,
  type MarkdownResourceState,
  type ResolvedMarkdownResource,
} from './markdown/resources';

export const markdownClass = `prose prose-sm min-w-0 max-w-none
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
  [&_pre]:max-w-full [&_pre]:bg-gray-50 [&_pre]:p-4 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:mb-4
  [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-mono
  [&_pre_code]:block [&_pre_code]:max-w-none [&_pre_code]:bg-transparent [&_pre_code]:p-0
  [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:mb-4
  [&_th]:border [&_th]:border-gray-300 [&_th]:px-3 [&_th]:py-2 [&_th]:bg-gray-50 [&_th]:font-semibold [&_th]:text-left
  [&_td]:border [&_td]:border-gray-300 [&_td]:px-3 [&_td]:py-2
  [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md
  [&_.markdown-mermaid]:max-w-full [&_.markdown-mermaid]:overflow-x-auto [&_.markdown-mermaid]:overflow-y-hidden
  [&_.markdown-mermaid_svg]:block [&_.markdown-mermaid_svg]:h-auto [&_.markdown-mermaid_svg]:max-w-full
  [&_.katex-display]:max-w-full [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden
  [&_hr]:border-gray-300 [&_hr]:my-6 [&_del]:line-through
  [&_input[type=checkbox]]:mr-2`;

const MAX_MERMAID_BLOCKS = 20;
const CODE_BLOCK_PROPERTY = 'data-markdown-code-block';
const CODE_PARENT_PROPERTY = 'data-markdown-code-parent';
const CODE_LANGUAGE_PROPERTY = 'data-markdown-language';
const MERMAID_INDEX_PROPERTY = 'data-mermaid-index';

interface HastNode {
  type: string;
  value?: string;
  children?: HastNode[];
}

interface HastElementNode extends HastNode {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}

const isElementNode = (node: HastNode): node is HastElementNode => node.type === 'element';

const hastText = (node: HastNode): string => (
  node.type === 'text' ? node.value ?? '' : (node.children ?? []).map(hastText).join('')
);

const rehypeAgentWikiHeadingAliases = () => (tree: HastNode) => {
  const aliases = new Set<string>();
  const addHeadingAliases = (node: HastNode) => {
    if (isElementNode(node) && /^h[1-6]$/u.test(node.tagName)) {
      const alias = markdownWikiHeadingAnchorId(hastText(node));
      if (!aliases.has(alias)) {
        aliases.add(alias);
        node.children.unshift({
          type: 'element',
          tagName: 'span',
          properties: { id: alias, className: ['wiki-heading-anchor'], ariaHidden: true },
          children: [],
        } as HastElementNode);
      }
    }
    for (const child of node.children ?? []) addHeadingAliases(child);
  };
  addHeadingAliases(tree);
};

const normalizedCodeLanguage = (node: HastElementNode) => {
  const rawClasses = node.properties.className;
  const classes = Array.isArray(rawClasses) ? rawClasses : [rawClasses];
  for (const value of classes) {
    const match = /^language-(.+)$/iu.exec(String(value ?? ''));
    if (match) return match[1].trim().toLowerCase();
  }
  return '';
};

const rehypeAnnotateCodeBlocks = () => (tree: HastNode) => {
  let mermaidIndex = 0;
  const annotate = (node: HastNode, parent?: HastElementNode) => {
    if (isElementNode(node) && node.tagName === 'code' && parent?.tagName === 'pre') {
      const language = normalizedCodeLanguage(node);
      node.properties[CODE_BLOCK_PROPERTY] = 'fenced';
      node.properties[CODE_PARENT_PROPERTY] = parent.tagName;
      node.properties[CODE_LANGUAGE_PROPERTY] = language;
      if (language === 'mermaid') {
        node.properties[MERMAID_INDEX_PROPERTY] = mermaidIndex;
        mermaidIndex += 1;
      }
    }
    for (const child of node.children ?? []) annotate(child, isElementNode(node) ? node : undefined);
  };
  annotate(tree);
};

const isMermaidCodeBlock = (node?: HastElementNode) => {
  const properties = node?.properties;
  return properties?.[CODE_BLOCK_PROPERTY] === 'fenced'
    && properties[CODE_PARENT_PROPERTY] === 'pre'
    && properties[CODE_LANGUAGE_PROPERTY] === 'mermaid'
    && Number.isInteger(Number(properties[MERMAID_INDEX_PROPERTY]));
};

const codeSource = (children: React.ReactNode) => String(children).replace(/\n$/u, '');

interface MermaidBlockProps {
  source: string;
  index: number;
}

const MermaidBlock = ({ source, index }: MermaidBlockProps) => {
  const { language, t } = useLanguage();
  if (index >= MAX_MERMAID_BLOCKS) {
    return (
      <div className="markdown-mermaid my-4" data-mermaid-state="limit">
        <p role="alert">{t('markdown.mermaid.limitReached')}</p>
        <pre><code className="language-mermaid">{source}</code></pre>
      </div>
    );
  }

  return (
    <div className="markdown-mermaid my-4">
      <MermaidDiagram
        source={source}
        loadingLabel={t('markdown.mermaid.loading')}
        errorLabel={t('markdown.mermaid.error')}
        tooLargeLabel={t('markdown.mermaid.tooLarge', {
          max: MAX_MERMAID_SOURCE_CHARS.toLocaleString(language === 'zh-CN' ? 'zh-CN' : 'en-US'),
        })}
      />
    </div>
  );
};

type MarkdownCodeProps = React.ComponentPropsWithoutRef<'code'> & ExtraProps;

const MarkdownCode = ({ children: codeChildren, node, ...props }: MarkdownCodeProps) => {
  if (!isMermaidCodeBlock(node)) return <code {...props}>{codeChildren}</code>;

  const source = codeSource(codeChildren);
  const index = Number(node?.properties[MERMAID_INDEX_PROPERTY]);
  return <MermaidBlock source={source} index={index} />;
};

type MarkdownPreProps = React.ComponentPropsWithoutRef<'pre'> & ExtraProps;

const MarkdownPre = ({ children: preChildren, node, ...props }: MarkdownPreProps) => {
  const codeNode = node?.children.find((child) => (
    isElementNode(child) && child.tagName === 'code'
  ));
  if (codeNode && isElementNode(codeNode) && isMermaidCodeBlock(codeNode)) return <>{preChildren}</>;
  return <pre {...props}>{preChildren}</pre>;
};

export interface MarkdownProps {
  children: string;
  pages?: PageLinkTarget[];
  className?: string;
  mode?: MarkdownRenderMode;
  canEdit?: boolean;
  pendingTaskIndexes?: ReadonlySet<number>;
  onTaskToggle?: (toggle: MarkdownTaskToggle) => void;
  spaceId?: string;
  pageId?: string;
  internalBranch?: MarkdownRenderBranch;
}

const emptyResources: MarkdownResourceMap = new Map();

const nodeProperty = (node: HastElementNode | undefined, name: string): string => {
  const value = node?.properties?.[name];
  return typeof value === 'string' ? value : '';
};

const ResourceFallback = ({ literal, status }: { literal: string; status: string }) => (
  <span role="alert" className="markdown-resource-fallback text-amber-800">
    <span>{status} </span><code>{literal}</code>
  </span>
);

const resourceForNode = (
  resourceState: MarkdownResourceState,
  node: HastElementNode | undefined,
): ResolvedMarkdownResource | null => {
  if (resourceState.status !== 'ready') return null;
  return resourceState.resources.get(nodeProperty(node, 'data-markdown-resource-key')) ?? null;
};

type AgentWikiNodeProps = React.HTMLAttributes<HTMLElement> & ExtraProps;

const AgentWikiLink = ({ node, children: linkChildren }: AgentWikiNodeProps) => {
  const runtime = useContext(MarkdownRuntimeContext);
  const { t } = useLanguage();
  const element = node && isElementNode(node) ? node : undefined;
  const literal = nodeProperty(element, 'data-markdown-literal');
  const legacyHref = nodeProperty(element, 'data-markdown-legacy-href');
  const heading = nodeProperty(element, 'data-markdown-heading') || null;
  const blockId = nodeProperty(element, 'data-markdown-block-id') || null;
  const fragmentPresent = nodeProperty(element, 'data-markdown-fragment-present') === 'true';
  const fragmentValid = nodeProperty(element, 'data-markdown-fragment-valid') !== 'false';
  if (fragmentPresent && !fragmentValid) {
    return <ResourceFallback literal={literal} status={t('markdown.resource.invalidFragment')} />;
  }
  if (!runtime?.tree.spaceId) {
    return legacyHref
      ? <Link to={legacyHref} target="_blank" rel="noopener noreferrer" className="wiki-link text-blue-600 hover:underline">{linkChildren}</Link>
      : <>{literal}</>;
  }
  const resource = resourceForNode(runtime.resourceState, element);
  if (!resource) {
    if (runtime.resourceState.status === 'loading') {
      return <span role="status" className="text-gray-500">{linkChildren}</span>;
    }
    return <ResourceFallback literal={literal} status={t('markdown.resource.failed')} />;
  }
  if (resource.status !== 'resolved') {
    return <ResourceFallback literal={literal} status={t(`markdown.resource.${resource.status}`)} />;
  }
  if (resource.kind !== 'page') {
    return <ResourceFallback literal={literal} status={t('markdown.resource.unresolved')} />;
  }
  const href = resolveWikiHref({
    embed: false,
    target: resource.pageId,
    label: null,
    heading,
    blockId,
    fragmentPresent: Boolean(heading || blockId),
    fragmentKind: blockId ? 'block' : heading ? 'heading' : null,
    fragmentValid: true,
  }, [{ id: resource.pageId, title: resource.title, slug: resource.slug }]);
  return <Link to={href!} target="_blank" rel="noopener noreferrer" className="wiki-link text-blue-600 hover:underline">{linkChildren}</Link>;
};

const AgentWikiImage = ({ node }: AgentWikiNodeProps) => {
  const runtime = useContext(MarkdownRuntimeContext);
  const { t } = useLanguage();
  const element = node && isElementNode(node) ? node : undefined;
  const literal = nodeProperty(element, 'data-markdown-literal');
  const label = nodeProperty(element, 'data-markdown-label');
  if (nodeProperty(element, 'data-markdown-fragment-present') === 'true') {
    return <ResourceFallback literal={literal} status={t('markdown.embed.attachmentFragment')} />;
  }
  const resource = runtime ? resourceForNode(runtime.resourceState, element) : null;
  if (!runtime?.tree.spaceId || !resource) {
    if (runtime?.tree.spaceId && runtime.resourceState.status === 'loading') {
      return <div role="status" className="my-3 text-sm text-gray-500">{t('markdown.resource.loading')}</div>;
    }
    const status = runtime?.resourceState.status === 'error'
      ? t('markdown.resource.failed')
      : t('markdown.resource.unresolved');
    return <ResourceFallback literal={literal} status={status} />;
  }
  if (resource.status !== 'resolved') {
    return <ResourceFallback literal={literal} status={t(`markdown.resource.${resource.status}`)} />;
  }
  if (resource.kind !== 'attachment') {
    return <ResourceFallback literal={literal} status={t('markdown.resource.unresolved')} />;
  }
  return (
    <AttachmentImage
      attachmentId={resource.attachmentId}
      displayName={resource.displayName}
      mimeType={resource.mimeType}
      width={resource.width}
      height={resource.height}
      alt={label || resource.displayName}
      className="markdown-attachment-image h-auto max-w-full rounded-md"
    />
  );
};

const AgentWikiEmbed = ({ node }: AgentWikiNodeProps) => {
  const runtime = useContext(MarkdownRuntimeContext);
  const { t } = useLanguage();
  const element = node && isElementNode(node) ? node : undefined;
  const literal = nodeProperty(element, 'data-markdown-literal');
  const fragmentPresent = nodeProperty(element, 'data-markdown-fragment-present') === 'true';
  const fragmentKind = nodeProperty(element, 'data-markdown-fragment-kind');
  const fragmentValid = nodeProperty(element, 'data-markdown-fragment-valid') !== 'false';
  if (fragmentKind === 'block') {
    return <ResourceFallback literal={literal} status={t('markdown.embed.block')} />;
  }
  if (fragmentPresent && !fragmentValid) {
    return <ResourceFallback literal={literal} status={t('markdown.embed.unavailable')} />;
  }
  const resource = runtime ? resourceForNode(runtime.resourceState, element) : null;
  if (!runtime?.tree.spaceId || !resource) {
    if (runtime?.tree.spaceId && runtime.resourceState.status === 'loading') {
      return <div role="status" className="my-3 text-sm text-gray-500">{t('markdown.resource.loading')}</div>;
    }
    const status = runtime?.resourceState.status === 'error'
      ? t('markdown.resource.failed')
      : t('markdown.resource.unresolved');
    return <ResourceFallback literal={literal} status={status} />;
  }
  if (resource.status !== 'resolved') {
    return <ResourceFallback literal={literal} status={t(`markdown.resource.${resource.status}`)} />;
  }
  if (resource.kind !== 'page') {
    return <ResourceFallback literal={literal} status={t('markdown.resource.unresolved')} />;
  }
  return (
    <EmbeddedMarkdown
      literal={literal}
      label={nodeProperty(element, 'data-markdown-label') || undefined}
      heading={nodeProperty(element, 'data-markdown-heading') || undefined}
      blockId={nodeProperty(element, 'data-markdown-block-id') || undefined}
      sourceOffset={nodeProperty(element, 'data-markdown-source-offset')}
      resource={resource}
    />
  );
};

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

const TaskIndexContext = createContext<{ index: number; label: string } | null>(null);

interface TaskInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  taskInputsEnabled: boolean;
  pendingTaskIndexes: ReadonlySet<number>;
}

const TaskInput: React.FC<TaskInputProps> = ({ taskInputsEnabled, pendingTaskIndexes, ...props }) => {
  const task = useContext(TaskIndexContext);
  const pending = task !== null && pendingTaskIndexes.has(task.index);
  return (
    <input
      {...props}
      aria-label={task?.label || undefined}
      disabled={!taskInputsEnabled || pending}
      onChange={() => undefined}
    />
  );
};

export const Markdown: React.FC<MarkdownProps> = ({
  children,
  pages = [],
  className,
  mode = 'static',
  canEdit = false,
  pendingTaskIndexes = new Set<number>(),
  onTaskToggle,
  spaceId,
  pageId,
  internalBranch,
}) => {
  const parentRuntime = useContext(MarkdownRuntimeContext);
  const ownTree = useMemo(
    () => createMarkdownTreeState(spaceId ?? '', mode),
    [children, mode, pageId, spaceId],
  );
  const tree = parentRuntime?.tree ?? ownTree;
  const isRootTree = parentRuntime === null;
  const branch = internalBranch ?? parentRuntime?.branch ?? {
    depth: 0,
    documentId: pageId ?? 'root',
    instanceId: pageId ?? 'root',
    visitedPageIds: pageId ? new Set([pageId]) : new Set<string>(),
  };
  const documentKey = `${branch.documentId}\u0000${children}`;
  const resourceCollection = useMemo(() => {
    if (!tree.spaceId) return { references: [], failed: false };
    try {
      return { references: collectMarkdownResourceRefs(children), failed: false };
    } catch {
      return { references: [], failed: true };
    }
  }, [children, tree]);
  const [resourceSnapshot, setResourceSnapshot] = useState<{
    tree: typeof tree;
    key: string;
    state: MarkdownResourceState;
  }>({
    tree,
    key: documentKey,
    state: tree.spaceId
      ? { status: 'loading', resources: emptyResources }
      : { status: 'ready', resources: emptyResources },
  });
  const resourceState = resourceSnapshot.tree === tree && resourceSnapshot.key === documentKey
    ? resourceSnapshot.state
    : tree.spaceId
      ? { status: 'loading' as const, resources: emptyResources }
      : { status: 'ready' as const, resources: emptyResources };

  useEffect(() => {
    if (!isRootTree || !tree.spaceId) return;
    tree.retain();
    return () => tree.release();
  }, [isRootTree, tree]);

  useEffect(() => {
    if (!tree.spaceId) return;
    if (resourceCollection.failed) {
      setResourceSnapshot({ tree, key: documentKey, state: { status: 'error', resources: emptyResources } });
      return;
    }
    let current = true;
    setResourceSnapshot({ tree, key: documentKey, state: { status: 'loading', resources: emptyResources } });
    const sourcePageId = branch.documentId === 'root' ? undefined : branch.documentId;
    void loadTreeResources(tree, documentKey, resourceCollection.references, sourcePageId).then((resources) => {
      if (current) setResourceSnapshot({ tree, key: documentKey, state: { status: 'ready', resources } });
    }).catch(() => {
      if (current) setResourceSnapshot({ tree, key: documentKey, state: { status: 'error', resources: emptyResources } });
    });
    return () => {
      current = false;
    };
  }, [branch.documentId, documentKey, resourceCollection, tree]);

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

  const runtimeValue = useMemo(() => ({ tree, branch, resourceState }), [branch, resourceState, tree]);

  return (
    <MarkdownRuntimeContext.Provider value={runtimeValue}>
    <div className={className ?? markdownClass} onChange={handleChange}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath, obsidianPlugin, remarkBreaks]}
        rehypePlugins={[
          rehypeSlug,
          rehypeAgentWikiHeadingAliases,
          [rehypeKatex, KATEX_OPTIONS],
          [rehypeAutolinkHeadings, {
            behavior: 'append',
            properties: { className: ['heading-anchor'], ariaHidden: true, tabIndex: -1 },
            content: { type: 'text', value: ' #' },
          }],
          rehypeHighlight,
          rehypeAnnotateCodeBlocks,
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
          code: MarkdownCode,
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
              <TaskIndexContext.Provider value={index === null ? null : {
                index,
                label: tasks[index]?.signature ?? '',
              }}>
                <li
                  {...props}
                  onClick={(event) => {
                    const target = event.target;
                    if (!(target instanceof Element)
                      || target.closest('li[data-task-index]') !== event.currentTarget
                      || !taskInputsEnabled
                      || target.closest('a, button, input, select, textarea')) return;
                    event.currentTarget.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
                  }}
                >{listChildren}</li>
              </TaskIndexContext.Provider>
            );
          },
          pre: MarkdownPre,
          'agent-wiki-link': AgentWikiLink,
          'agent-wiki-embed': AgentWikiEmbed,
          'agent-wiki-image': AgentWikiImage,
        } as React.ComponentProps<typeof ReactMarkdown>['components']}
      >
        {children}
      </ReactMarkdown>
    </div>
    </MarkdownRuntimeContext.Provider>
  );
};
