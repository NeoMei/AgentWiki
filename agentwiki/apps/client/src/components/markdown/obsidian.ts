import { SKIP, visit } from 'unist-util-visit';

export interface WikiReference {
  embed: boolean;
  target: string;
  label: string | null;
  heading: string | null;
  blockId: string | null;
}

export interface ObsidianPluginOptions {
  resolvePage?: (reference: WikiReference) => string | null;
}

interface AstNode {
  type: string;
  value?: string;
  url?: string;
  checked?: boolean | null;
  children?: AstNode[];
  data?: Record<string, unknown> & {
    agentWikiGenerated?: boolean;
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
}

const SKIPPED_NODE_TYPES = new Set([
  'code',
  'inlineCode',
  'link',
  'linkReference',
  'html',
]);

const INLINE_OBSIDIAN_PATTERN = /(!?\[\[([^\]\n]+)\]\]|==([^=\n]+)==)/g;
const BLOCK_ID_PATTERN = /(?:^|\s)\^([\p{L}\p{N}_-]+)\s*$/u;
const CALLOUT_PATTERN = /^\[!([^\]\s]+)\]([+-])?(?:[ \t]+([^\n]*))?(?:\n|$)/;
const ATTACHMENT_IMAGE_PATTERN = /\.(?:png|jpe?g|webp|gif)$/iu;

const normalizeIdentityPart = (value: string | null | undefined) => (
  value?.trim().normalize('NFC').toLocaleLowerCase('und') ?? ''
);

export const wikiReferenceKind = (reference: WikiReference): 'page' | 'attachment' => (
  reference.embed && ATTACHMENT_IMAGE_PATTERN.test(reference.target.trim()) ? 'attachment' : 'page'
);

export const canonicalWikiReferenceKey = (reference: WikiReference): string => JSON.stringify([
  wikiReferenceKind(reference),
  normalizeIdentityPart(reference.target),
  normalizeIdentityPart(reference.heading),
  normalizeIdentityPart(reference.blockId),
]);

export function parseWikiReference(raw: string): WikiReference {
  const trimmed = raw.trim();
  const embed = trimmed.startsWith('!');
  const withoutEmbed = embed ? trimmed.slice(1) : trimmed;
  const aliasIndex = withoutEmbed.indexOf('|');
  const targetAndFragment = (aliasIndex === -1 ? withoutEmbed : withoutEmbed.slice(0, aliasIndex)).trim();
  const label = aliasIndex === -1 ? null : withoutEmbed.slice(aliasIndex + 1).trim() || null;
  const fragmentIndex = targetAndFragment.indexOf('#');
  const target = (fragmentIndex === -1 ? targetAndFragment : targetAndFragment.slice(0, fragmentIndex)).trim();
  const fragment = fragmentIndex === -1 ? '' : targetAndFragment.slice(fragmentIndex + 1).trim();

  return {
    embed,
    target,
    label,
    heading: fragment && !fragment.startsWith('^') ? fragment : null,
    blockId: fragment.startsWith('^') && fragment.length > 1 ? fragment.slice(1) : null,
  };
}

function generatedNode(
  type: string,
  hName: string,
  hProperties: Record<string, unknown>,
  children: AstNode[] = [],
): AstNode {
  return {
    type,
    children,
    data: {
      agentWikiGenerated: true,
      hName,
      hProperties,
    },
  };
}

function transformCallouts(tree: AstNode): void {
  visit(tree as never, 'blockquote', (node: AstNode) => {
    const firstParagraph = node.children?.[0];
    if (!firstParagraph || firstParagraph.type !== 'paragraph') return;
    const firstText = firstParagraph.children?.[0];
    if (firstText?.type !== 'text' || typeof firstText.value !== 'string') return;

    const match = CALLOUT_PATTERN.exec(firstText.value);
    if (!match) return;

    const type = match[1].toLowerCase();
    const fold = match[2] ?? '';
    const title = match[3]?.trim() || `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
    const remaining = firstText.value.slice(match[0].length);

    if (remaining) {
      firstText.value = remaining;
    } else {
      firstParagraph.children?.shift();
      if (firstParagraph.children?.[0]?.type === 'break') firstParagraph.children.shift();
      if (firstParagraph.children?.length === 0) node.children?.shift();
    }

    node.data = {
      ...node.data,
      hProperties: {
        ...node.data?.hProperties,
        'data-callout': type,
        'data-callout-title': title,
        'data-callout-fold': fold,
      },
    };
  });
}

function annotateTasks(tree: AstNode): void {
  let taskIndex = 0;
  visit(tree as never, 'listItem', (node: AstNode) => {
    if (typeof node.checked !== 'boolean') return;
    node.data = {
      ...node.data,
      hProperties: {
        ...node.data?.hProperties,
        'data-task-index': String(taskIndex),
      },
    };
    taskIndex += 1;
  });
}

function transformBlockAnchors(tree: AstNode): void {
  visit(tree as never, 'paragraph', (node: AstNode) => {
    const children = node.children;
    const last = children?.[children.length - 1];
    if (!children || last?.type !== 'text' || typeof last.value !== 'string') return;

    const match = BLOCK_ID_PATTERN.exec(last.value);
    if (!match || match.index === undefined) return;

    const prefix = last.value.slice(0, match.index).replace(/\s+$/, '');
    if (prefix) last.value = prefix;
    else children.pop();
    children.push(generatedNode('agentWikiBlockAnchor', 'span', {
      id: `^${match[1]}`,
      className: ['block-anchor'],
      ariaHidden: true,
    }));
  });
}

function tokenizeText(
  node: AstNode,
  resolvePage?: ObsidianPluginOptions['resolvePage'],
): AstNode[] | null {
  const value = node.value ?? '';
  const output: AstNode[] = [];
  let cursor = 0;
  let changed = false;
  INLINE_OBSIDIAN_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = INLINE_OBSIDIAN_PATTERN.exec(value))) {
    if (match.index > cursor) output.push({ type: 'text', value: value.slice(cursor, match.index) });

    if (match[3] !== undefined) {
      output.push(generatedNode(
        'agentWikiMark',
        'mark',
        { className: ['markdown-highlight'] },
        [{ type: 'text', value: match[3] }],
      ));
      changed = true;
    } else {
      const reference = parseWikiReference(`${match[1].startsWith('!') ? '!' : ''}${match[2]}`);
      const href = resolvePage?.(reference) ?? null;
      const kind = wikiReferenceKind(reference);
      const fallbackLabel = match[2].split('|', 1)[0];
      const startOffset = node.position?.start?.offset;
      const position = Number.isInteger(startOffset)
        ? `${startOffset! + match.index}`
        : `${match.index}`;
      const properties = {
        className: [reference.embed ? 'wiki-embed' : 'wiki-link'],
        'data-markdown-resource-key': canonicalWikiReferenceKey(reference),
        'data-markdown-resource-kind': kind,
        'data-markdown-literal': match[0],
        'data-markdown-target': reference.target,
        'data-markdown-label': reference.label ?? undefined,
        'data-markdown-heading': reference.heading ?? undefined,
        'data-markdown-block-id': reference.blockId ?? undefined,
        'data-markdown-legacy-href': href ?? undefined,
        'data-markdown-source-offset': position,
      };
      const hName = reference.embed
        ? kind === 'attachment' ? 'agent-wiki-image' : 'agent-wiki-embed'
        : 'agent-wiki-link';
      output.push(generatedNode(
        reference.embed ? kind === 'attachment' ? 'agentWikiImage' : 'agentWikiEmbed' : 'agentWikiLink',
        hName,
        properties,
        reference.embed ? [] : [{ type: 'text', value: reference.label ?? fallbackLabel }],
      ));
      changed = true;
    }

    cursor = match.index + match[0].length;
  }

  if (!changed) return null;
  if (cursor < value.length) output.push({ type: 'text', value: value.slice(cursor) });
  return output;
}

function transformInlineSyntax(tree: AstNode, resolvePage?: ObsidianPluginOptions['resolvePage']): void {
  visit(tree as never, (node: AstNode, index: number | undefined, parent: AstNode | undefined) => {
    if (node.data?.agentWikiGenerated || SKIPPED_NODE_TYPES.has(node.type)) return SKIP;
    if (node.type !== 'text' || typeof node.value !== 'string' || !parent || index === undefined) return;

    const replacement = tokenizeText(node, resolvePage);
    if (!replacement) return;
    parent.children?.splice(index, 1, ...replacement);
    return [SKIP, index + replacement.length];
  });
}

function liftBlockEmbeds(node: AstNode): void {
  for (const child of node.children ?? []) liftBlockEmbeds(child);
  if (!node.children) return;
  const nextChildren: AstNode[] = [];
  for (const child of node.children) {
    if (child.type !== 'paragraph' || !child.children?.some((part) => (
      part.type === 'agentWikiEmbed' || part.type === 'agentWikiImage'
    ))) {
      nextChildren.push(child);
      continue;
    }
    let inlineParts: AstNode[] = [];
    const flushParagraph = () => {
      if (inlineParts.some((part) => part.type !== 'text' || part.value?.trim())) {
        nextChildren.push({ ...child, children: inlineParts });
      }
      inlineParts = [];
    };
    for (const part of child.children) {
      if (part.type === 'agentWikiEmbed' || part.type === 'agentWikiImage') {
        flushParagraph();
        nextChildren.push(part);
      } else {
        inlineParts.push(part);
      }
    }
    flushParagraph();
  }
  node.children = nextChildren;
}

export function remarkAgentWikiObsidian(options: ObsidianPluginOptions) {
  return () => (tree: AstNode) => {
    transformCallouts(tree);
    annotateTasks(tree);
    transformBlockAnchors(tree);
    transformInlineSyntax(tree, options.resolvePage);
    liftBlockEmbeds(tree);
  };
}
