import { createContext } from 'react';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import api from '../../api/client';
import {
  canonicalWikiReferenceKey,
  normalizeMarkdownAttachmentIdentity,
  normalizeMarkdownPageIdentity,
  remarkAgentWikiObsidian,
  type WikiReference,
  wikiReferenceKind,
} from './obsidian';

const MAX_REFERENCES = 100;
const MAX_EDITOR_WIKI_OCCURRENCES = 256;
const MAX_EDITOR_CANDIDATE_PARSE_CHARS = 32_768;
const MAX_REFERENCE_CHARS = 512;
const RAW_HTML_BLOCK_TAGS = new Set(['pre', 'script', 'style', 'textarea']);
const HTML_BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center',
  'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'head', 'header', 'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main',
  'menu', 'menuitem', 'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param',
  'search', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title',
  'tr', 'track', 'ul',
]);

// Mirrors validator.js `isLength`, which class-validator's MaxLength delegates
// to: surrogate pairs and BMP presentation-selector sequences each count as a
// single character.
export const validatorDtoStringLength = (value: string): number => {
  const presentationSequences = value.match(/[^\uFE0F\uFE0E][\uFE0F\uFE0E]/g) ?? [];
  const surrogatePairs = value.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) ?? [];
  return value.length - presentationSequences.length - surrogatePairs.length;
};

export const unicodeCodePointLength = (value: string): number => Array.from(value).length;

export interface MarkdownResourceRef {
  canonicalKey: string;
  kind: 'page' | 'attachment';
  target: string;
  heading?: string;
  blockId?: string;
}

export interface MarkdownResourceOccurrence {
  from: number;
  to: number;
  reference: MarkdownResourceRef;
}

export interface MarkdownResourceRequest {
  key: string;
  kind: 'page' | 'attachment';
  target: string;
  heading?: string;
  blockId?: string;
}

export type ResolvedMarkdownResource =
  | { key: string; status: 'resolved'; kind: 'page'; pageId: string; title: string; slug: string }
  | { key: string; status: 'resolved'; kind: 'attachment'; attachmentId: string; displayName: string; mimeType: string; width: number; height: number }
  | { key: string; status: 'unresolved' }
  | { key: string; status: 'ambiguous' };

export type MarkdownResourceMap = ReadonlyMap<string, ResolvedMarkdownResource>;

export interface MarkdownEmbedBudget {
  depth: number;
  embedCount: number;
  embeddedChars: number;
  visitedPageIds: ReadonlySet<string>;
}

export interface MarkdownRenderBranch {
  depth: number;
  documentId: string;
  instanceId: string;
  visitedPageIds: ReadonlySet<string>;
}

export type MarkdownResourceState =
  | { status: 'loading'; resources: MarkdownResourceMap }
  | { status: 'ready'; resources: MarkdownResourceMap }
  | { status: 'error'; resources: MarkdownResourceMap };

interface EmbedAcquisition {
  countAllowed: boolean;
  chars?: { length: number; allowed: boolean };
}

export interface MarkdownTreeState {
  readonly spaceId: string;
  readonly rootMode: 'page' | 'editor-preview' | 'version' | 'embed' | 'static';
  readonly resourceRequests: Map<string, Promise<MarkdownResourceMap>>;
  readonly pageRequests: Map<string, Promise<string>>;
  readonly acquisitions: Map<string, EmbedAcquisition>;
  readonly controllers: Set<AbortController>;
  embedCount: number;
  embeddedChars: number;
  retain: () => void;
  release: () => void;
}

export interface MarkdownRuntimeValue {
  tree: MarkdownTreeState;
  branch: MarkdownRenderBranch;
  resourceState: MarkdownResourceState;
}

export const MarkdownRuntimeContext = createContext<MarkdownRuntimeValue | null>(null);

export const createMarkdownTreeState = (
  spaceId: string,
  rootMode: MarkdownTreeState['rootMode'],
): MarkdownTreeState => {
  let retainCount = 0;
  let disposeGeneration = 0;
  const tree: MarkdownTreeState = {
    spaceId,
    rootMode,
    resourceRequests: new Map(),
    pageRequests: new Map(),
    acquisitions: new Map(),
    controllers: new Set(),
    embedCount: 0,
    embeddedChars: 0,
    retain: () => {
      retainCount += 1;
      disposeGeneration += 1;
    },
    release: () => {
      retainCount = Math.max(0, retainCount - 1);
      const generation = ++disposeGeneration;
      queueMicrotask(() => {
        if (retainCount !== 0 || generation !== disposeGeneration) return;
        for (const controller of tree.controllers) controller.abort();
        tree.controllers.clear();
        tree.resourceRequests.clear();
        tree.pageRequests.clear();
      });
    },
  };
  return tree;
};

export function loadTreeResources(
  tree: MarkdownTreeState,
  documentKey: string,
  references: readonly MarkdownResourceRef[],
): Promise<MarkdownResourceMap> {
  const cached = tree.resourceRequests.get(documentKey);
  if (cached) return cached;
  if (references.length === 0) {
    const empty = Promise.resolve(new Map<string, ResolvedMarkdownResource>());
    tree.resourceRequests.set(documentKey, empty);
    return empty;
  }
  const controller = new AbortController();
  tree.controllers.add(controller);
  const request = resolveMarkdownResources(tree.spaceId, references, controller.signal)
    .catch((error) => {
      tree.resourceRequests.delete(documentKey);
      throw error;
    })
    .finally(() => tree.controllers.delete(controller));
  tree.resourceRequests.set(documentKey, request);
  return request;
}

export function loadTreePage(tree: MarkdownTreeState, pageId: string): Promise<string> {
  const cached = tree.pageRequests.get(pageId);
  if (cached) return cached;
  const controller = new AbortController();
  tree.controllers.add(controller);
  const request = api.get(`/pages/${encodeURIComponent(pageId)}`, { signal: controller.signal })
    .then((response) => {
      const content = response.data?.content;
      if (typeof content !== 'string') throw new Error('Invalid embedded page response');
      return content;
    })
    .catch((error) => {
      tree.pageRequests.delete(pageId);
      throw error;
    })
    .finally(() => tree.controllers.delete(controller));
  tree.pageRequests.set(pageId, request);
  return request;
}

export function acquireEmbedCount(tree: MarkdownTreeState, occurrenceKey: string): boolean {
  const existing = tree.acquisitions.get(occurrenceKey);
  if (existing) return existing.countAllowed;
  const allowed = tree.embedCount < 20;
  tree.acquisitions.set(occurrenceKey, { countAllowed: allowed });
  if (allowed) tree.embedCount += 1;
  return allowed;
}

export function acquireEmbedCharacters(
  tree: MarkdownTreeState,
  occurrenceKey: string,
  length: number,
): boolean {
  const acquisition = tree.acquisitions.get(occurrenceKey);
  if (!acquisition?.countAllowed) return false;
  if (acquisition.chars) return acquisition.chars.length === length && acquisition.chars.allowed;
  const allowed = tree.embeddedChars + length <= 200_000;
  acquisition.chars = { length, allowed };
  if (allowed) tree.embeddedChars += length;
  return allowed;
}

interface MarkdownAstNode {
  type: string;
  value?: string;
  depth?: number;
  children?: MarkdownAstNode[];
  data?: {
    hProperties?: Record<string, unknown>;
  };
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
}

const parser = unified().use(remarkParse).use(remarkGfm);
const resourceParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkAgentWikiObsidian({}) as never);

export const editorMarkdownResourceParser = {
  parse(source: string): MarkdownAstNode {
    return resourceParser.runSync(resourceParser.parse(source)) as MarkdownAstNode;
  },
};

interface MarkdownResourceCandidate {
  from: number;
  to: number;
  literal: string;
}

interface ParsedMarkdownResourceCandidate {
  candidate: MarkdownResourceCandidate;
  node: MarkdownAstNode;
}

const markerRunEnd = (source: string, start: number, end: number, marker: string): number => {
  let cursor = start;
  while (cursor < end && source[cursor] === marker) cursor += 1;
  return cursor;
};

const findTokenBefore = (source: string, token: string, start: number, end: number): number => {
  for (let cursor = start; cursor + token.length <= end; cursor += 1) {
    if (source.startsWith(token, cursor)) return cursor;
  }
  return -1;
};

const findAsciiCaseInsensitiveTokenBefore = (
  source: string,
  token: string,
  start: number,
  end: number,
): number => {
  for (let cursor = start; cursor + token.length <= end; cursor += 1) {
    let matches = true;
    for (let tokenIndex = 0; tokenIndex < token.length; tokenIndex += 1) {
      const sourceCode = source.charCodeAt(cursor + tokenIndex);
      const foldedSourceCode = sourceCode >= 65 && sourceCode <= 90 ? sourceCode + 32 : sourceCode;
      if (foldedSourceCode !== token.charCodeAt(tokenIndex)) {
        matches = false;
        break;
      }
    }
    if (matches) return cursor;
  }
  return -1;
};

const isAsciiLetter = (character: string | undefined): boolean => {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
};

const isAsciiDigit = (character: string | undefined): boolean => {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  return code >= 48 && code <= 57;
};

const stripMarkdownContainerPrefixes = (
  source: string,
  start: number,
  end: number,
): { contentStart: number; quoteDepth: number } => {
  let cursor = start;
  let quoteDepth = 0;
  while (cursor < end) {
    const beforePrefix = cursor;
    let indent = 0;
    while (cursor < end && source[cursor] === ' ' && indent < 3) {
      cursor += 1;
      indent += 1;
    }

    if (source[cursor] === '>') {
      cursor += 1;
      if (source[cursor] === ' ' || source[cursor] === '\t') cursor += 1;
      quoteDepth += 1;
      continue;
    }

    let markerEnd = cursor;
    if ((source[cursor] === '-' || source[cursor] === '+' || source[cursor] === '*')
      && (source[cursor + 1] === ' ' || source[cursor + 1] === '\t')) {
      markerEnd = cursor + 1;
    } else {
      let digitEnd = cursor;
      while (digitEnd < end && digitEnd - cursor < 9 && isAsciiDigit(source[digitEnd])) digitEnd += 1;
      if (digitEnd > cursor && (source[digitEnd] === '.' || source[digitEnd] === ')')
        && (source[digitEnd + 1] === ' ' || source[digitEnd + 1] === '\t')) {
        markerEnd = digitEnd + 1;
      }
    }
    if (markerEnd !== cursor) {
      cursor = markerEnd;
      let paddingEnd = cursor;
      while (paddingEnd < end && paddingEnd - cursor < 5
        && (source[paddingEnd] === ' ' || source[paddingEnd] === '\t')) {
        paddingEnd += 1;
      }
      cursor += paddingEnd - cursor > 4 ? 1 : paddingEnd - cursor;
      continue;
    }

    return { contentStart: beforePrefix, quoteDepth };
  }
  return { contentStart: cursor, quoteDepth };
};

const contentAfterRequiredBlockquotes = (
  source: string,
  start: number,
  end: number,
  quoteDepth: number,
): number => {
  let cursor = start;
  for (let depth = 0; depth < quoteDepth; depth += 1) {
    let indent = 0;
    while (cursor < end && source[cursor] === ' ' && indent < 3) {
      cursor += 1;
      indent += 1;
    }
    if (source[cursor] !== '>') return end;
    cursor += 1;
    if (source[cursor] === ' ' || source[cursor] === '\t') cursor += 1;
  }
  return cursor;
};

const htmlTagNameAt = (source: string, start: number, end: number): string | null => {
  if (source[start] !== '<') return null;
  let cursor = start + 1;
  if (source[cursor] === '/') cursor += 1;
  const nameStart = cursor;
  while (cursor < end && (isAsciiLetter(source[cursor]) || isAsciiDigit(source[cursor])
    || source[cursor] === '-')) cursor += 1;
  if (cursor === nameStart || !isAsciiLetter(source[nameStart])) return null;
  const boundary = source[cursor];
  if (boundary !== undefined && boundary !== '>' && boundary !== '/' && boundary !== ' ' && boundary !== '\t') {
    return null;
  }
  return source.slice(nameStart, cursor).toLowerCase();
};

const completeHtmlTagLineAt = (source: string, start: number, end: number): boolean => {
  if (htmlTagNameAt(source, start, end) === null) return false;
  let quote: '"' | "'" | null = null;
  for (let cursor = start + 1; cursor < end; cursor += 1) {
    const character = source[cursor];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character !== '>') continue;
    for (let rest = cursor + 1; rest < end; rest += 1) {
      if (source[rest] !== ' ' && source[rest] !== '\t') return false;
    }
    return true;
  }
  return false;
};

type HtmlBlockState =
  | { kind: 'blank-line'; quoteDepth?: number }
  | { kind: 'token'; token: string; asciiInsensitive: boolean; quoteDepth?: number };

const htmlBlockAt = (source: string, start: number, end: number): HtmlBlockState | null => {
  if (source[start] !== '<') return null;
  const tag = htmlTagNameAt(source, start, end);
  if (tag !== null && RAW_HTML_BLOCK_TAGS.has(tag) && source[start + 1] !== '/') {
    return { kind: 'token', token: `</${tag}`, asciiInsensitive: true };
  }
  if (source.startsWith('<!--', start)) {
    return { kind: 'token', token: '-->', asciiInsensitive: false };
  }
  if (source.startsWith('<?', start)) {
    return { kind: 'token', token: '?>', asciiInsensitive: false };
  }
  if (source.startsWith('<![CDATA[', start)) {
    return { kind: 'token', token: ']]>', asciiInsensitive: false };
  }
  if (source.startsWith('<!', start) && isAsciiLetter(source[start + 2])
    && source.charCodeAt(start + 2) >= 65 && source.charCodeAt(start + 2) <= 90) {
    return { kind: 'token', token: '>', asciiInsensitive: false };
  }
  if (tag !== null && HTML_BLOCK_TAGS.has(tag)) return { kind: 'blank-line' };
  if (tag !== null && completeHtmlTagLineAt(source, start, end)) return { kind: 'blank-line' };
  return null;
};

const closingFenceAt = (
  source: string,
  start: number,
  end: number,
  marker: string,
  minimumLength: number,
): boolean => {
  const runEnd = markerRunEnd(source, start, end, marker);
  if (runEnd - start < minimumLength) return false;
  for (let cursor = runEnd; cursor < end; cursor += 1) {
    if (source[cursor] !== ' ' && source[cursor] !== '\t') return false;
  }
  return true;
};

const skipHtmlTag = (source: string, start: number, end: number): number => {
  const next = source[start + 1];
  if (!next || !/[A-Za-z!/?]/u.test(next)) return start + 1;
  let quote: '"' | "'" | null = null;
  let cursor = start + 1;
  while (cursor < end) {
    const character = source[cursor];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return cursor + 1;
    }
    cursor += 1;
  }
  return end;
};

const skipLinkDestination = (source: string, start: number, end: number): number => {
  let depth = 0;
  let cursor = start;
  while (cursor < end) {
    if (source[cursor] === '\\' && cursor + 1 < end) {
      cursor += 2;
      continue;
    }
    if (source[cursor] === '(') depth += 1;
    else if (source[cursor] === ')') {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
    cursor += 1;
  }
  return end;
};

const scanMarkdownResourceCandidates = (source: string): MarkdownResourceCandidate[] => {
  const candidates: MarkdownResourceCandidate[] = [];
  let candidateCharacters = 0;
  let fence: { marker: '`' | '~'; length: number } | null = null;
  let inlineTicks = 0;
  let bracketDepth = 0;
  let inHtmlComment = false;
  let htmlBlock: HtmlBlockState | null = null;
  let lineStart = 0;

  while (lineStart < source.length) {
    let lineEnd = lineStart;
    while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') lineEnd += 1;

    const container = stripMarkdownContainerPrefixes(source, lineStart, lineEnd);
    const containerContent = container.contentStart;
    let firstContent = containerContent;
    let indentation = 0;
    while (firstContent < lineEnd && source[firstContent] === ' ' && indentation < 4) {
      firstContent += 1;
      indentation += 1;
    }
    const indentedCode = indentation >= 4 || source[firstContent] === '\t';
    const startedInsideFence = fence !== null;
    let rawHtmlBlockLine = false;

    if (htmlBlock !== null) {
      rawHtmlBlockLine = true;
      if (htmlBlock.kind === 'blank-line') {
        if (firstContent >= lineEnd) htmlBlock = null;
      } else {
        const tokenSearchStart = contentAfterRequiredBlockquotes(
          source,
          lineStart,
          lineEnd,
          htmlBlock.quoteDepth ?? 0,
        );
        const closingToken = htmlBlock.asciiInsensitive
          ? findAsciiCaseInsensitiveTokenBefore(source, htmlBlock.token, tokenSearchStart, lineEnd)
          : findTokenBefore(source, htmlBlock.token, tokenSearchStart, lineEnd);
        if (closingToken !== -1) htmlBlock = null;
      }
    } else if (fence === null && inlineTicks === 0 && indentation <= 3) {
      const openingBlock = htmlBlockAt(source, firstContent, lineEnd);
      if (openingBlock !== null) {
        rawHtmlBlockLine = true;
        if (openingBlock.kind === 'blank-line') {
          htmlBlock = { ...openingBlock, quoteDepth: container.quoteDepth };
        } else {
          const closingToken = openingBlock.asciiInsensitive
            ? findAsciiCaseInsensitiveTokenBefore(source, openingBlock.token, firstContent, lineEnd)
            : findTokenBefore(source, openingBlock.token, firstContent, lineEnd);
          if (closingToken === -1) htmlBlock = { ...openingBlock, quoteDepth: container.quoteDepth };
        }
      }
    }

    if (!rawHtmlBlockLine && fence !== null) {
      if (indentation <= 3 && source[firstContent] === fence.marker
        && closingFenceAt(source, firstContent, lineEnd, fence.marker, fence.length)) {
        fence = null;
      }
    } else if (!rawHtmlBlockLine && inlineTicks === 0 && !indentedCode
      && (source[firstContent] === '`' || source[firstContent] === '~')) {
      const marker = source[firstContent] as '`' | '~';
      const runEnd = markerRunEnd(source, firstContent, lineEnd, marker);
      if (runEnd - firstContent >= 3) fence = { marker, length: runEnd - firstContent };
      else firstContent = containerContent;
    } else if (!rawHtmlBlockLine && (!indentedCode || inlineTicks !== 0)) {
      firstContent = containerContent;
    }

    const fenceLine = rawHtmlBlockLine || startedInsideFence || fence !== null;
    if (!fenceLine && (!indentedCode || inlineTicks !== 0)) {
      let cursor = firstContent;
      while (cursor < lineEnd) {
        if (inHtmlComment) {
          const commentEnd = findTokenBefore(source, '-->', cursor, lineEnd);
          if (commentEnd === -1) {
            cursor = lineEnd;
            continue;
          }
          inHtmlComment = false;
          cursor = commentEnd + 3;
          continue;
        }
        if (source.startsWith('<!--', cursor)) {
          inHtmlComment = true;
          cursor += 4;
          continue;
        }

        const character = source[cursor];
        if (character === '`') {
          const runEnd = markerRunEnd(source, cursor, lineEnd, '`');
          const runLength = runEnd - cursor;
          if (inlineTicks === 0) inlineTicks = runLength;
          else if (runLength === inlineTicks) inlineTicks = 0;
          cursor = runEnd;
          continue;
        }
        if (inlineTicks !== 0) {
          cursor += 1;
          continue;
        }
        if (character === '\\' && cursor + 1 < lineEnd) {
          cursor += 2;
          continue;
        }
        if (character === '<') {
          cursor = skipHtmlTag(source, cursor, lineEnd);
          continue;
        }
        if (character === '[' && source[cursor + 1] === '[') {
          let close = cursor + 2;
          let validShape = true;
          while (close < lineEnd) {
            if (source[close] === '[') {
              validShape = false;
              break;
            }
            if (source[close] === ']') {
              if (source[close + 1] === ']') break;
              validShape = false;
              break;
            }
            close += 1;
          }
          if (!validShape || close >= lineEnd || source[close + 1] !== ']') {
            const recovery = findTokenBefore(source, ']]', close, lineEnd);
            cursor = recovery !== -1 ? recovery + 2 : lineEnd;
            continue;
          }
          const to = close + 2;
          const embed = cursor > lineStart && source[cursor - 1] === '!';
          const from = embed ? cursor - 1 : cursor;
          if (bracketDepth === 0) {
            const literalLength = to - from;
            const separatorLength = candidates.length === 0 ? 0 : 1;
            if (candidateCharacters + separatorLength + literalLength > MAX_EDITOR_CANDIDATE_PARSE_CHARS) {
              return candidates;
            }
            candidates.push({ from, to, literal: source.slice(from, to) });
            candidateCharacters += separatorLength + literalLength;
            if (candidates.length >= MAX_EDITOR_WIKI_OCCURRENCES) return candidates;
          }
          cursor = to;
          continue;
        }
        if (character === '[') bracketDepth += 1;
        else if (character === ']' && bracketDepth > 0) {
          bracketDepth -= 1;
          if (bracketDepth === 0) {
            if (source[cursor + 1] === '(') {
              cursor = skipLinkDestination(source, cursor + 1, lineEnd);
              continue;
            }
            if (source[cursor + 1] === ':') {
              cursor = lineEnd;
              continue;
            }
          }
        }
        cursor += 1;
      }
    }

    if (lineEnd >= source.length) break;
    lineStart = lineEnd + (source[lineEnd] === '\r' && source[lineEnd + 1] === '\n' ? 2 : 1);
  }

  return candidates;
};

const parseMarkdownResourceCandidates = (source: string): ParsedMarkdownResourceCandidate[] => {
  const candidates = scanMarkdownResourceCandidates(source);
  if (candidates.length === 0) return [];
  const mappings = new Map<number, MarkdownResourceCandidate>();
  let syntheticSource = '';
  for (const candidate of candidates) {
    if (syntheticSource) syntheticSource += '\n';
    mappings.set(syntheticSource.length, candidate);
    syntheticSource += candidate.literal;
  }
  if (syntheticSource.length > MAX_EDITOR_CANDIDATE_PARSE_CHARS) {
    throw new Error('Markdown resource candidate budget exceeded');
  }

  const tree = editorMarkdownResourceParser.parse(syntheticSource);
  const parsed: ParsedMarkdownResourceCandidate[] = [];
  const consumed = new Set<number>();
  visit(tree as never, (node: MarkdownAstNode) => {
    if (!['agentWikiLink', 'agentWikiEmbed', 'agentWikiImage'].includes(node.type)) return;
    const properties = node.data?.hProperties ?? {};
    const sourceOffset = properties['data-markdown-source-offset'];
    const literal = properties['data-markdown-literal'];
    const syntheticFrom = typeof sourceOffset === 'string' && /^\d+$/u.test(sourceOffset)
      ? Number(sourceOffset)
      : -1;
    const candidate = mappings.get(syntheticFrom);
    if (!candidate || consumed.has(syntheticFrom) || literal !== candidate.literal
      || syntheticSource.slice(syntheticFrom, syntheticFrom + candidate.literal.length) !== candidate.literal
      || source.slice(candidate.from, candidate.to) !== candidate.literal) return;
    consumed.add(syntheticFrom);
    parsed.push({ candidate, node });
  });
  return parsed;
};

const assertBoundedPart = (value: string | undefined): void => {
  if (value !== undefined && validatorDtoStringLength(value) > MAX_REFERENCE_CHARS) {
    throw new Error('Markdown resource reference is too long');
  }
};

const markdownResourceRefFromNode = (node: MarkdownAstNode): MarkdownResourceRef | null => {
  if (!['agentWikiLink', 'agentWikiEmbed', 'agentWikiImage'].includes(node.type)) return null;
  const properties = node.data?.hProperties ?? {};
  const target = String(properties['data-markdown-target'] ?? '').trim();
  if (!target) return null;
  const headingValue = properties['data-markdown-heading'];
  const blockValue = properties['data-markdown-block-id'];
  const heading = typeof headingValue === 'string' && headingValue.trim() ? headingValue.trim() : undefined;
  const blockId = typeof blockValue === 'string' && blockValue.trim() ? blockValue.trim() : undefined;
  const fragmentPresent = properties['data-markdown-fragment-present'] === 'true';
  const fragmentKind = properties['data-markdown-fragment-kind'];
  const fragmentValid = properties['data-markdown-fragment-valid'] !== 'false';
  if (!fragmentValid) return null;
  if (node.type === 'agentWikiEmbed' && fragmentKind === 'block') return null;
  if (node.type === 'agentWikiImage' && fragmentPresent) return null;
  assertBoundedPart(target);
  assertBoundedPart(heading);
  assertBoundedPart(blockId);

  const wikiReference: WikiReference = {
    embed: node.type !== 'agentWikiLink',
    target,
    label: null,
    heading: heading ?? null,
    blockId: blockId ?? null,
    fragmentPresent,
    fragmentKind: fragmentKind === 'heading' || fragmentKind === 'block' ? fragmentKind : null,
    fragmentValid,
  };
  return {
    canonicalKey: canonicalWikiReferenceKey(wikiReference),
    kind: wikiReferenceKind(wikiReference),
    target,
    ...(heading ? { heading } : {}),
    ...(blockId ? { blockId } : {}),
  };
};

export function collectMarkdownResourceOccurrences(source: string): MarkdownResourceOccurrence[] {
  const occurrences: MarkdownResourceOccurrence[] = [];
  const uniqueReferences = new Set<string>();

  for (const { candidate, node } of parseMarkdownResourceCandidates(source)) {
    if (node.type !== 'agentWikiLink') continue;
    const reference = markdownResourceRefFromNode(node);
    if (!reference) continue;
    if (!uniqueReferences.has(reference.canonicalKey)) {
      if (uniqueReferences.size >= MAX_REFERENCES) break;
      uniqueReferences.add(reference.canonicalKey);
    }
    occurrences.push({ from: candidate.from, to: candidate.to, reference });
  }

  return occurrences;
}

export function collectMarkdownResourceRefs(
  source: string,
  options: { maxReferences?: number } = {},
): MarkdownResourceRef[] {
  const maxReferences = options.maxReferences ?? MAX_REFERENCES;
  const refs = new Map<string, MarkdownResourceRef>();

  for (const { node } of parseMarkdownResourceCandidates(source)) {
    const reference = markdownResourceRefFromNode(node);
    if (!reference) continue;
    if (!refs.has(reference.canonicalKey)) {
      refs.set(reference.canonicalKey, reference);
      if (refs.size > maxReferences) throw new Error('Markdown resource limit exceeded');
    }
  }

  return [...refs.values()];
}

const exactKeys = (value: object, allowed: readonly string[]): boolean => {
  const keys = Object.keys(value).sort();
  return keys.length === allowed.length && keys.every((key, index) => key === [...allowed].sort()[index]);
};

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isPositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

function validateResponseItem(value: unknown, expected: MarkdownResourceRequest): ResolvedMarkdownResource {
  if (!value || typeof value !== 'object') throw new Error('Invalid Markdown resource response');
  const item = value as Record<string, unknown>;
  if (item.key !== expected.key) throw new Error('Invalid Markdown resource response');
  if (item.status === 'unresolved' || item.status === 'ambiguous') {
    if (!exactKeys(item, ['key', 'status'])) throw new Error('Invalid Markdown resource response');
    return item as ResolvedMarkdownResource;
  }
  if (item.status !== 'resolved' || item.kind !== expected.kind) {
    throw new Error('Invalid Markdown resource response');
  }
  if (item.kind === 'page') {
    if (!exactKeys(item, ['key', 'status', 'kind', 'pageId', 'title', 'slug'])
      || !isNonEmptyString(item.pageId) || typeof item.title !== 'string' || typeof item.slug !== 'string') {
      throw new Error('Invalid Markdown resource response');
    }
  } else if (!exactKeys(item, ['key', 'status', 'kind', 'attachmentId', 'displayName', 'mimeType', 'width', 'height'])
    || !isNonEmptyString(item.attachmentId) || !isNonEmptyString(item.displayName)
    || !isNonEmptyString(item.mimeType) || !isPositiveInteger(item.width) || !isPositiveInteger(item.height)) {
    throw new Error('Invalid Markdown resource response');
  }
  return item as ResolvedMarkdownResource;
}

export async function resolveMarkdownResources(
  spaceId: string,
  references: readonly MarkdownResourceRef[],
  signal?: AbortSignal,
): Promise<MarkdownResourceMap> {
  if (!Array.isArray(references) || references.length === 0) {
    throw new Error('Invalid Markdown resource request');
  }
  if (references.length > MAX_REFERENCES) throw new Error('Markdown resource limit exceeded');
  const identities = new Set<string>();
  for (const reference of references) {
    if (!reference || typeof reference !== 'object'
      || (reference.kind !== 'page' && reference.kind !== 'attachment')
      || typeof reference.target !== 'string' || !/\S/u.test(reference.target)
      || (reference.heading !== undefined && (
        typeof reference.heading !== 'string' || !/\S/u.test(reference.heading)
      ))
      || (reference.blockId !== undefined && (
        typeof reference.blockId !== 'string'
        || !/^[\p{L}\p{N}_-]+$/u.test(reference.blockId)
      ))
      || (reference.heading !== undefined && reference.blockId !== undefined)
      || (reference.kind === 'attachment' && (
        reference.heading !== undefined || reference.blockId !== undefined
      ))) {
      throw new Error('Invalid Markdown resource request');
    }
    assertBoundedPart(reference.target);
    assertBoundedPart(reference.heading);
    assertBoundedPart(reference.blockId);
    const identity = [
      reference.kind,
      reference.kind === 'attachment'
        ? normalizeMarkdownAttachmentIdentity(reference.target)
        : normalizeMarkdownPageIdentity(reference.target),
      reference.heading === undefined ? '' : normalizeMarkdownPageIdentity(reference.heading),
      reference.blockId === undefined ? '' : normalizeMarkdownPageIdentity(reference.blockId),
    ].join('\u0000');
    if (identities.has(identity)) throw new Error('Invalid Markdown resource request');
    identities.add(identity);
  }
  const requests: MarkdownResourceRequest[] = references.map((reference, index) => ({
    key: `r${index}`,
    kind: reference.kind,
    target: reference.target,
    ...(reference.heading ? { heading: reference.heading } : {}),
    ...(reference.blockId ? { blockId: reference.blockId } : {}),
  }));
  const result = new Map<string, ResolvedMarkdownResource>();
  const response = await api.post(
    `/spaces/${encodeURIComponent(spaceId)}/markdown/resolve`,
    { references: requests },
    { signal },
  );
  if (!Array.isArray(response.data) || response.data.length !== requests.length) {
    throw new Error('Invalid Markdown resource response');
  }
  const byKey = new Map<string, unknown>();
  for (const item of response.data) {
    const key = item && typeof item === 'object' ? (item as Record<string, unknown>).key : undefined;
    if (typeof key !== 'string' || byKey.has(key)) throw new Error('Invalid Markdown resource response');
    byKey.set(key, item);
  }
  requests.forEach((request, index) => {
    if (!byKey.has(request.key)) throw new Error('Invalid Markdown resource response');
    result.set(references[index].canonicalKey, validateResponseItem(byKey.get(request.key), request));
  });
  return result;
}

export function extractMarkdownSection(source: string, heading: string): string | null {
  const tree = parser.parse(source) as MarkdownAstNode;
  const headings: MarkdownAstNode[] = [];
  visit(tree as never, 'heading', (node: MarkdownAstNode) => {
    headings.push(node);
  });
  const wanted = normalizeMarkdownPageIdentity(heading);
  const matchIndex = headings.findIndex((node) => (
    normalizeMarkdownPageIdentity(toString(node as never)) === wanted
  ));
  if (matchIndex < 0) return null;
  const match = headings[matchIndex];
  const start = match.position?.start?.offset;
  if (!Number.isInteger(start) || !Number.isInteger(match.depth)) return null;
  const next = headings.slice(matchIndex + 1).find((node) => (
    Number.isInteger(node.depth) && node.depth! <= match.depth!
  ));
  const end = next?.position?.start?.offset ?? source.length;
  if (!Number.isInteger(end)) return null;
  return source.slice(start, end);
}
