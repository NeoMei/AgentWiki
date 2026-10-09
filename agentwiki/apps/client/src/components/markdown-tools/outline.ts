import GithubSlugger from 'github-slugger';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';
export interface MarkdownOutlineItem { id: string; label: string; level: number; from: number; to: number }
/** Same heading slug algorithm as the read renderer (rehype-slug), one source of offsets. */
export const outlineFor = (source: string): MarkdownOutlineItem[] => {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(source);
  const slugger = new GithubSlugger();
  const items: MarkdownOutlineItem[] = [];
  visit(tree, 'heading', (node) => {
    const label = toString(node);
    const id = slugger.slug(label);
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (typeof from === 'number' && typeof to === 'number' && label.trim()) {
      items.push({ id, label, level: node.depth, from, to });
    }
  });
  return items;
};
