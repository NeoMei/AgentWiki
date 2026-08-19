import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { isExternalHref, isInternalPageHref, PageLinkTarget, resolveWikiHref } from './markdownLinks';

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
  [&_pre]:bg-gray-50 [&_pre]:p-4 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:mb-4
  [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-mono
  [&_pre_code]:bg-transparent [&_pre_code]:p-0
  [&_table]:w-full [&_table]:border-collapse [&_table]:mb-4
  [&_th]:border [&_th]:border-gray-300 [&_th]:px-3 [&_th]:py-2 [&_th]:bg-gray-50 [&_th]:font-semibold [&_th]:text-left
  [&_td]:border [&_td]:border-gray-300 [&_td]:px-3 [&_td]:py-2
  [&_hr]:border-gray-300 [&_hr]:my-6 [&_del]:line-through
  [&_input[type=checkbox]]:mr-2`;

const WIKILINK = /\[\[([^\][]+)\]\]/g;

// remark plugin: turn [[Page Name]] text into link nodes that resolve to
// /pages/{id}. Unresolvable names are left as literal text.
// Minimal recursive mdast walker (avoids adding unist-util-visit dependency).
const walk = (node: any, parent: any, index: number | undefined, fn: (node: any, index: number | undefined, parent: any) => number | void) => {
  if (!node) return;
  const next = fn(node, index, parent);
  const children = node.children;
  if (Array.isArray(children)) {
    for (let i = typeof next === 'number' ? next : 0; i < children.length; i += 1) {
      walk(children[i], node, i, fn);
    }
  }
};

const remarkWikilink = (pages: PageLinkTarget[]) => () => (tree: any) => {
  walk(tree, null, undefined, (node: any, index: number | undefined, parent: any) => {
    if (!parent || index === undefined || node.type !== 'text' || typeof node.value !== 'string') return;
    if (parent.type === 'link' || parent.type === 'linkReference') return;
    const value: string = node.value;
    if (!value.includes('[[')) return;
    const out: any[] = [];
    let last = 0;
    WIKILINK.lastIndex = 0;
    let match: RegExpExecArray | null;
    let changed = false;
    while ((match = WIKILINK.exec(value))) {
      const name = match[1];
      const href = resolveWikiHref(name, pages);
      if (!href) continue;
      changed = true;
      if (match.index > last) out.push({ type: 'text', value: value.slice(last, match.index) });
      out.push({
        type: 'link',
        url: href,
        children: [{ type: 'text', value: name }],
        data: { hProperties: { className: ['wiki-link'] } },
      });
      last = match.index + match[0].length;
    }
    if (!changed) return;
    if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
    parent.children.splice(index, 1, ...out);
    return index + out.length;
  });
};

interface MarkdownProps {
  children: string;
  pages?: PageLinkTarget[];
  className?: string;
}

export const Markdown: React.FC<MarkdownProps> = ({ children, pages = [], className }) => (
  <div className={className ?? markdownClass}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks, remarkWikilink(pages)]}
      rehypePlugins={[rehypeSlug, [rehypeAutolinkHeadings, { behavior: 'append', properties: { className: ['heading-anchor'], ariaHidden: true, tabIndex: -1 }, content: { type: 'text', value: ' #' } }], rehypeHighlight]}
      components={{
        a: ({ href, children: linkChildren, ...rest }: any) => {
          if (isInternalPageHref(href)) {
            return <Link to={href!} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" {...rest}>{linkChildren}</Link>;
          }
          if (isExternalHref(href)) {
            return <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" {...rest}>{linkChildren}</a>;
          }
          return <a href={href} className="text-blue-600 hover:underline" {...rest}>{linkChildren}</a>;
        },
      }}
    >
      {children}
    </ReactMarkdown>
  </div>
);
