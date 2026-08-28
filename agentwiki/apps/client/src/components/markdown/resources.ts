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
const MAX_INLINE_STRUCTURE_TOKENS = 512;
const MAX_MARKDOWN_CONTAINER_FRAMES = 64;
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

type MarkdownContainerFrame =
  | { kind: 'quote' }
  | { kind: 'list'; continuationIndent: number };

interface MarkdownContainerPrefix {
  contentStart: number;
  frames: readonly MarkdownContainerFrame[];
  overflow: boolean;
}

const stripMarkdownContainerPrefixes = (
  source: string,
  start: number,
  end: number,
): MarkdownContainerPrefix => {
  let cursor = start;
  const frames: MarkdownContainerFrame[] = [];
  while (cursor < end) {
    const beforePrefix = cursor;
    let indent = 0;
    while (cursor < end && source[cursor] === ' ' && indent < 3) {
      cursor += 1;
      indent += 1;
    }

    if (source[cursor] === '>') {
      if (frames.length >= MAX_MARKDOWN_CONTAINER_FRAMES) {
        return { contentStart: end, frames, overflow: true };
      }
      cursor += 1;
      if (source[cursor] === ' ' || source[cursor] === '\t') cursor += 1;
      frames.push({ kind: 'quote' });
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
      if (frames.length >= MAX_MARKDOWN_CONTAINER_FRAMES) {
        return { contentStart: end, frames, overflow: true };
      }
      const markerStart = beforePrefix;
      cursor = markerEnd;
      let paddingEnd = cursor;
      while (paddingEnd < end && paddingEnd - cursor < 5
        && (source[paddingEnd] === ' ' || source[paddingEnd] === '\t')) {
        paddingEnd += 1;
      }
      cursor += paddingEnd - cursor > 4 ? 1 : paddingEnd - cursor;
      frames.push({ kind: 'list', continuationIndent: cursor - markerStart });
      continue;
    }

    return { contentStart: beforePrefix, frames, overflow: false };
  }
  return { contentStart: cursor, frames, overflow: false };
};

const matchMarkdownContainerScope = (
  source: string,
  start: number,
  end: number,
  frames: readonly MarkdownContainerFrame[],
): number | null => {
  let cursor = start;
  for (const frame of frames) {
    if (frame.kind === 'list') {
      let consumed = 0;
      while (cursor < end && consumed < frame.continuationIndent
        && (source[cursor] === ' ' || source[cursor] === '\t')) {
        cursor += 1;
        consumed += 1;
      }
      if (consumed < frame.continuationIndent) return null;
      continue;
    }

    let indent = 0;
    while (cursor < end && source[cursor] === ' ' && indent < 3) {
      cursor += 1;
      indent += 1;
    }
    if (source[cursor] !== '>') return null;
    cursor += 1;
    if (source[cursor] === ' ' || source[cursor] === '\t') cursor += 1;
  }
  return cursor;
};

interface MarkdownContainerScope {
  frames: readonly MarkdownContainerFrame[];
}

const leadingIndentFrom = (source: string, start: number, end: number): number => {
  let cursor = start;
  while (cursor < end && (source[cursor] === ' ' || source[cursor] === '\t')) cursor += 1;
  return cursor - start;
};

const lineContinuesContainer = (
  source: string,
  lineStart: number,
  lineEnd: number,
  _container: ReturnType<typeof stripMarkdownContainerPrefixes>,
  scope: MarkdownContainerScope,
): boolean => {
  return matchMarkdownContainerScope(source, lineStart, lineEnd, scope.frames) !== null;
};

const lineContinuesParagraphScope = (
  source: string,
  lineStart: number,
  lineEnd: number,
  _container: ReturnType<typeof stripMarkdownContainerPrefixes>,
  scope: MarkdownContainerScope,
): boolean => {
  const contentStart = matchMarkdownContainerScope(source, lineStart, lineEnd, scope.frames);
  if (contentStart === null) return false;
  return stripMarkdownContainerPrefixes(source, contentStart, lineEnd).frames.length === 0;
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

type HtmlBlockOpening =
  | { kind: 'blank-line'; canInterruptParagraph: boolean }
  | { kind: 'token'; token: string; asciiInsensitive: boolean; canInterruptParagraph: true };

type HtmlBlockState = HtmlBlockOpening & MarkdownContainerScope;

const htmlBlockAt = (source: string, start: number, end: number): HtmlBlockOpening | null => {
  if (source[start] !== '<') return null;
  const tag = htmlTagNameAt(source, start, end);
  if (tag !== null && RAW_HTML_BLOCK_TAGS.has(tag) && source[start + 1] !== '/') {
    return { kind: 'token', token: `</${tag}`, asciiInsensitive: true, canInterruptParagraph: true };
  }
  if (source.startsWith('<!--', start)) {
    return { kind: 'token', token: '-->', asciiInsensitive: false, canInterruptParagraph: true };
  }
  if (source.startsWith('<?', start)) {
    return { kind: 'token', token: '?>', asciiInsensitive: false, canInterruptParagraph: true };
  }
  if (source.startsWith('<![CDATA[', start)) {
    return { kind: 'token', token: ']]>', asciiInsensitive: false, canInterruptParagraph: true };
  }
  if (source.startsWith('<!', start) && isAsciiLetter(source[start + 2])
    && source.charCodeAt(start + 2) >= 65 && source.charCodeAt(start + 2) <= 90) {
    return { kind: 'token', token: '>', asciiInsensitive: false, canInterruptParagraph: true };
  }
  if (tag !== null && HTML_BLOCK_TAGS.has(tag)) {
    return { kind: 'blank-line', canInterruptParagraph: true };
  }
  if (tag !== null && completeHtmlTagLineAt(source, start, end)) {
    return { kind: 'blank-line', canInterruptParagraph: false };
  }
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

interface SourceRange {
  from: number;
  to: number;
}

const mergeSourceRanges = (ranges: SourceRange[]): SourceRange[] => {
  ranges.sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: SourceRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (!previous || range.from > previous.to) merged.push({ ...range });
    else if (range.to > previous.to) previous.to = range.to;
  }
  return merged;
};

const rangeContaining = (ranges: SourceRange[], position: number, startIndex = 0): number => {
  let index = startIndex;
  while (index < ranges.length && ranges[index].to <= position) index += 1;
  return index < ranges.length && ranges[index].from <= position ? index : -index - 1;
};

const inlineExclusionsFor = (source: string, start: number, end: number): SourceRange[] => {
  const failRaw = (): SourceRange[] => [{ from: start, to: end }];
  const opaqueRanges: SourceRange[] = [];
  const ticks: Array<{ from: number; to: number; length: number; next?: number }> = [];
  let cursor = start;
  let slashRun = 0;
  while (cursor < end) {
    const character = source[cursor];
    if (character === '\\') {
      slashRun += 1;
      cursor += 1;
      continue;
    }
    if (character === '`' && slashRun % 2 === 0) {
      const runEnd = markerRunEnd(source, cursor, end, '`');
      if (ticks.length >= MAX_INLINE_STRUCTURE_TOKENS) return failRaw();
      ticks.push({ from: cursor, to: runEnd, length: runEnd - cursor });
      cursor = runEnd;
      slashRun = 0;
      continue;
    }
    slashRun = 0;
    cursor += 1;
  }
  const nextTickByLength = new Map<number, number>();
  for (let index = ticks.length - 1; index >= 0; index -= 1) {
    ticks[index].next = nextTickByLength.get(ticks[index].length);
    nextTickByLength.set(ticks[index].length, index);
  }
  for (let index = 0; index < ticks.length;) {
    const closingIndex = ticks[index].next;
    if (closingIndex === undefined) {
      index += 1;
      continue;
    }
    opaqueRanges.push({ from: ticks[index].from, to: ticks[closingIndex].to });
    index = closingIndex + 1;
  }

  const codeRanges = mergeSourceRanges(opaqueRanges);
  let codeIndex = 0;
  let commentStart = -1;
  cursor = start;
  while (cursor < end) {
    const codeRangeIndex = rangeContaining(codeRanges, cursor, codeIndex);
    if (codeRangeIndex >= 0) {
      codeIndex = codeRangeIndex;
      cursor = codeRanges[codeRangeIndex].to;
      continue;
    }
    codeIndex = -codeRangeIndex - 1;
    if (commentStart === -1 && source.startsWith('<!--', cursor)) {
      commentStart = cursor;
      cursor += 4;
      continue;
    }
    if (commentStart !== -1 && source.startsWith('-->', cursor)) {
      if (opaqueRanges.length >= MAX_INLINE_STRUCTURE_TOKENS) return failRaw();
      opaqueRanges.push({ from: commentStart, to: cursor + 3 });
      commentStart = -1;
      cursor += 3;
      continue;
    }
    cursor += 1;
  }

  const exclusions = mergeSourceRanges(opaqueRanges);
  let exclusionIndex = 0;
  cursor = start;
  while (cursor < end) {
    const containing = rangeContaining(exclusions, cursor, exclusionIndex);
    if (containing >= 0) {
      exclusionIndex = containing;
      cursor = exclusions[containing].to;
      continue;
    }
    exclusionIndex = -containing - 1;
    if (source[cursor] === '<') {
      const tagEnd = skipHtmlTag(source, cursor, end);
      if (tagEnd > cursor + 1 && source[tagEnd - 1] === '>') {
        if (exclusions.length >= MAX_INLINE_STRUCTURE_TOKENS) return failRaw();
        exclusions.push({ from: cursor, to: tagEnd });
        cursor = tagEnd;
        continue;
      }
      if (tagEnd === end) break;
    }
    cursor += 1;
  }

  const nonLinkRanges = mergeSourceRanges(exclusions);
  const bracketStack: number[] = [];
  exclusionIndex = 0;
  cursor = start;
  while (cursor < end) {
    const containing = rangeContaining(nonLinkRanges, cursor, exclusionIndex);
    if (containing >= 0) {
      exclusionIndex = containing;
      cursor = nonLinkRanges[containing].to;
      continue;
    }
    exclusionIndex = -containing - 1;
    if (source[cursor] === '\\' && cursor + 1 < end) {
      cursor += 2;
      continue;
    }
    if (source[cursor] === '[' && source[cursor + 1] === '[') {
      const wikiEnd = findTokenBefore(source, ']]', cursor + 2, end);
      cursor = wikiEnd === -1 ? end : wikiEnd + 2;
      continue;
    }
    if (source[cursor] === '[') {
      if (bracketStack.length >= MAX_INLINE_STRUCTURE_TOKENS) return failRaw();
      bracketStack.push(cursor);
    }
    else if (source[cursor] === ']' && bracketStack.length > 0) {
      const labelStart = bracketStack.pop()!;
      if (source[cursor + 1] === '(') {
        const linkEnd = skipLinkDestination(source, cursor + 1, end);
        if (linkEnd < end || source[linkEnd - 1] === ')') {
          if (exclusions.length >= MAX_INLINE_STRUCTURE_TOKENS) return failRaw();
          exclusions.push({ from: labelStart, to: linkEnd });
        }
        cursor = linkEnd;
        continue;
      }
      if (source[cursor + 1] === '[') {
        const referenceEnd = findTokenBefore(source, ']', cursor + 2, end);
        if (referenceEnd !== -1) {
          if (exclusions.length >= MAX_INLINE_STRUCTURE_TOKENS) return failRaw();
          exclusions.push({ from: labelStart, to: referenceEnd + 1 });
          cursor = referenceEnd + 1;
          continue;
        } else cursor = end;
      }
      if (source[cursor + 1] === ':') {
        if (exclusions.length >= MAX_INLINE_STRUCTURE_TOKENS) return failRaw();
        exclusions.push({ from: labelStart, to: end });
      }
    }
    cursor += 1;
  }
  return mergeSourceRanges(exclusions);
};

const paragraphEndFrom = (
  source: string,
  start: number,
  initialContainer: ReturnType<typeof stripMarkdownContainerPrefixes>,
): number => {
  let lineStart = start;
  let firstLine = true;
  while (lineStart < source.length) {
    let lineEnd = lineStart;
    while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') lineEnd += 1;
    const container = stripMarkdownContainerPrefixes(source, lineStart, lineEnd);
    const blank = leadingIndentFrom(source, container.contentStart, lineEnd) === lineEnd - container.contentStart;
    if (blank) return lineStart;
    if (!firstLine && !lineContinuesParagraphScope(source, lineStart, lineEnd, container, {
      frames: initialContainer.frames,
    })) return lineStart;
    if (lineEnd >= source.length) return lineEnd;
    lineStart = lineEnd + (source[lineEnd] === '\r' && source[lineEnd + 1] === '\n' ? 2 : 1);
    firstLine = false;
  }
  return source.length;
};

const lineOpensParagraph = (source: string, start: number, end: number): boolean => {
  if (source[start] === '#') {
    const runEnd = markerRunEnd(source, start, end, '#');
    if (runEnd - start <= 6 && (runEnd === end || source[runEnd] === ' ' || source[runEnd] === '\t')) {
      return false;
    }
  }
  const marker = source[start];
  if (marker === '=' || marker === '-' || marker === '*' || marker === '_') {
    let count = 0;
    let cursor = start;
    while (cursor < end) {
      if (source[cursor] === marker) count += 1;
      else if (source[cursor] !== ' ' && source[cursor] !== '\t') break;
      cursor += 1;
    }
    if (cursor === end && (marker === '=' ? count >= 1 : count >= 3)) return false;
  }
  return true;
};

const scanMarkdownResourceCandidates = (source: string): MarkdownResourceCandidate[] => {
  const candidates: MarkdownResourceCandidate[] = [];
  let candidateCharacters = 0;
  let fence: ({ marker: '`' | '~'; length: number } & MarkdownContainerScope) | null = null;
  let htmlBlock: HtmlBlockState | null = null;
  let paragraphScope: MarkdownContainerScope | null = null;
  let inlineParagraph: { from: number; to: number; exclusions: SourceRange[] } | null = null;
  let lineStart = 0;

  while (lineStart < source.length) {
    let lineEnd = lineStart;
    while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') lineEnd += 1;

    const container = stripMarkdownContainerPrefixes(source, lineStart, lineEnd);
    if (container.overflow) {
      paragraphScope = null;
      inlineParagraph = null;
      if (lineEnd >= source.length) break;
      lineStart = lineEnd + (source[lineEnd] === '\r' && source[lineEnd + 1] === '\n' ? 2 : 1);
      continue;
    }
    const containerContent = container.contentStart;
    let firstContent = containerContent;
    let indentation = 0;
    while (firstContent < lineEnd && source[firstContent] === ' ' && indentation < 4) {
      firstContent += 1;
      indentation += 1;
    }
    const indentedCode = indentation >= 4 || source[firstContent] === '\t';
    const blankLine = firstContent >= lineEnd;
    if (blankLine) {
      paragraphScope = null;
      inlineParagraph = null;
    } else if (paragraphScope !== null && !lineContinuesParagraphScope(
      source,
      lineStart,
      lineEnd,
      container,
      paragraphScope,
    )) {
      paragraphScope = null;
      inlineParagraph = null;
    }
    if (htmlBlock !== null && !blankLine && !lineContinuesContainer(
      source,
      lineStart,
      lineEnd,
      container,
      htmlBlock,
    )) htmlBlock = null;
    if (fence !== null && !blankLine && !lineContinuesContainer(
      source,
      lineStart,
      lineEnd,
      container,
      fence,
    )) fence = null;
    const startedInsideFence = fence !== null;
    let rawHtmlBlockLine = false;

    if (htmlBlock !== null) {
      rawHtmlBlockLine = true;
      if (htmlBlock.kind === 'blank-line') {
        if (firstContent >= lineEnd) htmlBlock = null;
      } else {
        const tokenSearchStart = matchMarkdownContainerScope(
          source, lineStart, lineEnd, htmlBlock.frames,
        ) ?? lineEnd;
        const closingToken = htmlBlock.asciiInsensitive
          ? findAsciiCaseInsensitiveTokenBefore(source, htmlBlock.token, tokenSearchStart, lineEnd)
          : findTokenBefore(source, htmlBlock.token, tokenSearchStart, lineEnd);
        if (closingToken !== -1) htmlBlock = null;
      }
    } else if (fence === null && indentation <= 3) {
      const openingBlock = htmlBlockAt(source, firstContent, lineEnd);
      if (openingBlock !== null && (openingBlock.canInterruptParagraph || paragraphScope === null)) {
        rawHtmlBlockLine = true;
        paragraphScope = null;
        inlineParagraph = null;
        if (openingBlock.kind === 'blank-line') {
          htmlBlock = {
            ...openingBlock,
            frames: container.frames,
          };
        } else {
          const closingToken = openingBlock.asciiInsensitive
            ? findAsciiCaseInsensitiveTokenBefore(source, openingBlock.token, firstContent, lineEnd)
            : findTokenBefore(source, openingBlock.token, firstContent, lineEnd);
          if (closingToken === -1) {
            htmlBlock = {
              ...openingBlock,
              frames: container.frames,
            };
          }
        }
      }
    }

    if (!rawHtmlBlockLine && fence !== null) {
      if (indentation <= 3 && source[firstContent] === fence.marker
        && closingFenceAt(source, firstContent, lineEnd, fence.marker, fence.length)) {
        fence = null;
      }
    } else if (!rawHtmlBlockLine && !indentedCode
      && (source[firstContent] === '`' || source[firstContent] === '~')) {
      const marker = source[firstContent] as '`' | '~';
      const runEnd = markerRunEnd(source, firstContent, lineEnd, marker);
      if (runEnd - firstContent >= 3) {
        fence = {
          marker,
          length: runEnd - firstContent,
          frames: container.frames,
        };
        paragraphScope = null;
        inlineParagraph = null;
      }
      else firstContent = containerContent;
    } else if (!rawHtmlBlockLine && !indentedCode) {
      firstContent = containerContent;
    }

    const fenceLine = rawHtmlBlockLine || startedInsideFence || fence !== null;
    if (!fenceLine && !indentedCode && !blankLine) {
      if (inlineParagraph === null || lineStart < inlineParagraph.from || lineStart >= inlineParagraph.to) {
        const paragraphEnd = paragraphEndFrom(source, lineStart, container);
        inlineParagraph = {
          from: lineStart,
          to: paragraphEnd,
          exclusions: inlineExclusionsFor(source, lineStart, paragraphEnd),
        };
      }
      let cursor = firstContent;
      let exclusionIndex = 0;
      while (cursor < lineEnd) {
        const containing = rangeContaining(inlineParagraph.exclusions, cursor, exclusionIndex);
        if (containing >= 0) {
          exclusionIndex = containing;
          cursor = Math.min(inlineParagraph.exclusions[containing].to, lineEnd);
          continue;
        }
        exclusionIndex = -containing - 1;

        const character = source[cursor];
        if (character === '\\' && cursor + 1 < lineEnd) {
          cursor += 2;
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
          const literalLength = to - from;
          const separatorLength = candidates.length === 0 ? 0 : 1;
          if (candidateCharacters + separatorLength + literalLength > MAX_EDITOR_CANDIDATE_PARSE_CHARS) {
            return candidates;
          }
          candidates.push({ from, to, literal: source.slice(from, to) });
          candidateCharacters += separatorLength + literalLength;
          if (candidates.length >= MAX_EDITOR_WIKI_OCCURRENCES) return candidates;
          cursor = to;
          continue;
        }
        cursor += 1;
      }
      if (lineOpensParagraph(source, firstContent, lineEnd)) {
        paragraphScope ??= {
          frames: container.frames,
        };
      } else {
        paragraphScope = null;
        inlineParagraph = null;
      }
    } else if (indentedCode || rawHtmlBlockLine || startedInsideFence) {
      paragraphScope = null;
      inlineParagraph = null;
    }

    if (lineEnd >= source.length) break;
    lineStart = lineEnd + (source[lineEnd] === '\r' && source[lineEnd + 1] === '\n' ? 2 : 1);
  }

  return candidates;
};

const parseMarkdownResourceCandidates = (source: string): ParsedMarkdownResourceCandidate[] => {
  const candidates = scanMarkdownResourceCandidates(source);
  if (candidates.length === 0) return [];
  const parserInputCharacters = candidates.reduce((total, candidate) => total + candidate.literal.length, 0);
  if (parserInputCharacters > MAX_EDITOR_CANDIDATE_PARSE_CHARS
    || candidates.length > MAX_EDITOR_WIKI_OCCURRENCES) {
    throw new Error('Markdown resource candidate budget exceeded');
  }

  const parsed: ParsedMarkdownResourceCandidate[] = [];
  for (const candidate of candidates) {
    if (source.slice(candidate.from, candidate.to) !== candidate.literal) continue;
    const tree = editorMarkdownResourceParser.parse(candidate.literal);
    const resourceNodes: MarkdownAstNode[] = [];
    visit(tree as never, (node: MarkdownAstNode) => {
      if (!['agentWikiLink', 'agentWikiEmbed', 'agentWikiImage'].includes(node.type)) return;
      resourceNodes.push(node);
    });
    if (resourceNodes.length !== 1) continue;
    const node = resourceNodes[0];
    if (node.data?.hProperties?.['data-markdown-source-offset'] !== '0') continue;
    const rootChildren = tree.children ?? [];
    const coversWholeCandidate = node.type === 'agentWikiLink'
      ? rootChildren.length === 1
        && rootChildren[0].type === 'paragraph'
        && rootChildren[0].children?.length === 1
        && rootChildren[0].children[0] === node
      : rootChildren.length === 1 && rootChildren[0] === node;
    if (coversWholeCandidate) parsed.push({ candidate, node });
  }
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
