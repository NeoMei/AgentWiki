import { posix } from 'node:path';
import {
  FlatAttachmentPathSchema,
  pathKey,
  type SyncV3ErrorCode,
} from '@neomei/agentwiki-sync-protocol';

export interface ParsedImageReference {
  syntax: 'obsidian' | 'markdown';
  rawTarget: string;
  targetStart: number;
  targetEnd: number;
  resolvedPath: string | null;
  classification:
    | 'managed_candidate'
    | 'page_embed'
    | 'external'
    | 'unsupported'
    | 'invalid_local';
}

export interface AttachmentReferenceCandidate {
  id: string;
  displayName: string;
  nameKey: string;
}

type AttachmentReferenceErrorCode = Extract<
  SyncV3ErrorCode,
  'ATTACHMENT_REFERENCE_INVALID' | 'ATTACHMENT_MISSING'
>;

export interface ResolvedAttachmentReferences {
  attachmentIds: string[];
  references: Array<ParsedImageReference & { attachmentId: string }>;
  errors: Array<{
    code: AttachmentReferenceErrorCode;
    targetStart: number;
    targetEnd: number;
  }>;
}

interface ImageTargetToken {
  syntax: ParsedImageReference['syntax'];
  targetStart: number;
  targetEnd: number;
}

interface ListContainer {
  markerIndent: number;
  contentIndent: number;
}

interface MarkdownContainerState {
  quoteDepth: number;
  lists: ListContainer[];
}

interface MarkdownFenceState {
  marker: '`' | '~';
  length: number;
  quoteDepth: number;
  listContentIndent: number | null;
}

export class AttachmentReferenceError extends Error {
  readonly code: AttachmentReferenceErrorCode;

  constructor(code: AttachmentReferenceErrorCode) {
    super(code);
    this.name = 'AttachmentReferenceError';
    this.code = code;
  }
}

function skipBackslashRun(value: string, start: number): number {
  let cursor = start;
  while (value[cursor] === '\\') cursor += 1;
  return cursor + ((cursor - start) % 2 === 1 && cursor < value.length ? 1 : 0);
}

function trimRange(value: string, start: number, end: number): [number, number] {
  while (start < end && /\s/u.test(value[start] ?? '')) start += 1;
  while (end > start && /\s/u.test(value[end - 1] ?? '')) end -= 1;
  return [start, end];
}

function findUnescaped(value: string, needle: string, start: number): number {
  let cursor = start;
  while (cursor <= value.length - needle.length) {
    if (value[cursor] === '\\') {
      cursor = skipBackslashRun(value, cursor);
      continue;
    }
    if (value.startsWith(needle, cursor)) return cursor;
    cursor += 1;
  }
  return -1;
}

function findClosingBracket(value: string, start: number): number {
  let depth = 0;
  let cursor = start;
  while (cursor < value.length) {
    const character = value[cursor];
    if (character === '\n' || character === '\r') return -1;
    if (character === '\\') {
      cursor = skipBackslashRun(value, cursor);
      continue;
    }
    if (character === '[') {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (character === ']') {
      if (depth === 0) return cursor;
      depth -= 1;
    }
    cursor += 1;
  }
  return -1;
}

function skipMarkdownWhitespace(value: string, start: number): number {
  let cursor = start;
  while (cursor < value.length && /[ \t]/u.test(value[cursor] ?? '')) cursor += 1;
  if (value[cursor] === '\r' || value[cursor] === '\n') {
    cursor += value[cursor] === '\r' && value[cursor + 1] === '\n' ? 2 : 1;
    while (cursor < value.length && /[ \t]/u.test(value[cursor] ?? '')) cursor += 1;
  }
  return cursor;
}

function findMarkdownDestinationClose(value: string, start: number): number {
  if (value[start] === ')') return start;
  let cursor = skipMarkdownWhitespace(value, start);
  if (cursor === start) return -1;
  if (value[cursor] === ')') return cursor;

  const opener = value[cursor];
  const closer = opener === '"' ? '"' : opener === "'" ? "'" : opener === '(' ? ')' : null;
  if (closer === null) return -1;
  cursor += 1;
  let titleClosed = false;
  while (cursor < value.length) {
    const character = value[cursor];
    if (character === '\\') {
      cursor += 2;
      continue;
    }
    if (character === closer) {
      titleClosed = true;
      cursor += 1;
      break;
    }
    if (opener === '(' && character === '(') return -1;
    cursor += 1;
  }
  if (!titleClosed) return -1;
  if (value[cursor] === ')') return cursor;
  const syntaxEnd = skipMarkdownWhitespace(value, cursor);
  return syntaxEnd > cursor && value[syntaxEnd] === ')' ? syntaxEnd : -1;
}

function listMarkerEnd(value: string, start: number, lineEnd: number): number {
  const marker = value[start];
  if ((marker === '-' || marker === '+' || marker === '*') && /[ \t]/u.test(value[start + 1] ?? '')) {
    return start + 2;
  }
  let cursor = start;
  while (cursor < lineEnd && cursor - start < 9 && /[0-9]/u.test(value[cursor] ?? '')) cursor += 1;
  if (
    cursor > start
    && (value[cursor] === '.' || value[cursor] === ')')
    && /[ \t]/u.test(value[cursor + 1] ?? '')
  ) {
    return cursor + 2;
  }
  return -1;
}

function markdownLineContext(
  value: string,
  lineStart: number,
  lineEnd: number,
  state: MarkdownContainerState,
): { contentStart: number; indentedCode: boolean } {
  let cursor = lineStart;
  let quoteDepth = 0;
  while (cursor < lineEnd) {
    let spaces = 0;
    while (cursor + spaces < lineEnd && value[cursor + spaces] === ' ') spaces += 1;
    const markerStart = cursor + spaces;
    if (spaces <= 3 && value[markerStart] === '>') {
      quoteDepth += 1;
      cursor = markerStart + 1;
      if (value[cursor] === ' ' || value[cursor] === '\t') cursor += 1;
      continue;
    }
    break;
  }
  if (quoteDepth !== state.quoteDepth) {
    state.quoteDepth = quoteDepth;
    state.lists = [];
  }

  let indent = 0;
  while (cursor + indent < lineEnd && value[cursor + indent] === ' ') indent += 1;
  const markerStart = cursor + indent;
  const blank = markerStart >= lineEnd || value[markerStart] === '\r';
  if (!blank) {
    while (
      state.lists.length > 0
      && indent < (state.lists[state.lists.length - 1]?.contentIndent ?? 0)
    ) {
      state.lists.pop();
    }
  }
  const listContentIndent = state.lists[state.lists.length - 1]?.contentIndent ?? 0;
  const indentedCode = value[cursor] === '\t' || indent >= listContentIndent + 4;
  if (indentedCode) {
    return {
      contentStart: markerStart,
      indentedCode: true,
    };
  }

  const markerEnd = listMarkerEnd(value, markerStart, lineEnd);
  if (markerEnd !== -1) {
    while (
      state.lists.length > 0
      && (state.lists[state.lists.length - 1]?.markerIndent ?? -1) >= indent
    ) {
      state.lists.pop();
    }
    state.lists.push({
      markerIndent: indent,
      contentIndent: markerEnd - cursor,
    });
    return {
      contentStart: markerEnd,
      indentedCode: false,
    };
  }

  return {
    contentStart: markerStart,
    indentedCode: false,
  };
}

function activeFenceLineContext(
  value: string,
  lineStart: number,
  lineEnd: number,
  fence: MarkdownFenceState,
): { inContainer: boolean; contentStart: number } {
  let cursor = lineStart;
  for (let depth = 0; depth < fence.quoteDepth; depth += 1) {
    let spaces = 0;
    while (cursor + spaces < lineEnd && value[cursor + spaces] === ' ') spaces += 1;
    const markerStart = cursor + spaces;
    if (spaces > 3 || value[markerStart] !== '>') {
      return { inContainer: false, contentStart: lineStart };
    }
    cursor = markerStart + 1;
    if (value[cursor] === ' ' || value[cursor] === '\t') cursor += 1;
  }

  if (fence.listContentIndent === null) {
    return { inContainer: true, contentStart: cursor };
  }
  let indent = 0;
  while (cursor + indent < lineEnd && value[cursor + indent] === ' ') indent += 1;
  const blank = cursor + indent >= lineEnd || value[cursor + indent] === '\r';
  if (!blank && indent < fence.listContentIndent) {
    return { inContainer: false, contentStart: lineStart };
  }
  return {
    inContainer: true,
    contentStart: blank ? cursor + indent : cursor + fence.listContentIndent,
  };
}

function scanImageTargetTokens(body: string): ImageTargetToken[] {
  const tokens: ImageTargetToken[] = [];
  let cursor = 0;
  let lineStart = true;
  const scannerState: { fence: MarkdownFenceState | null } = { fence: null };
  const containers: MarkdownContainerState = {
    quoteDepth: 0,
    lists: [],
  };

  while (cursor < body.length) {
    if (lineStart) {
      const newline = body.indexOf('\n', cursor);
      const lineEnd = newline === -1 ? body.length : newline;
      if (scannerState.fence) {
        const fenceContext = activeFenceLineContext(
          body,
          cursor,
          lineEnd,
          scannerState.fence,
        );
        if (fenceContext.inContainer) {
          let markerStart = fenceContext.contentStart;
          let indent = 0;
          while (body[markerStart + indent] === ' ') indent += 1;
          markerStart += indent;
          const marker = body[markerStart];
          let markerEnd = markerStart;
          if (indent <= 3 && marker === scannerState.fence.marker) {
            while (body[markerEnd] === marker) markerEnd += 1;
          }
          const isClosingFence = indent <= 3
            && marker === scannerState.fence.marker
            && markerEnd - markerStart >= scannerState.fence.length
            && /^[ \t\r]*$/u.test(body.slice(markerEnd, lineEnd));
          if (isClosingFence) scannerState.fence = null;
          cursor = newline === -1 ? body.length : newline + 1;
          lineStart = true;
          continue;
        }
        scannerState.fence = null;
      }

      const context = markdownLineContext(body, cursor, lineEnd, containers);
      if (context.indentedCode) {
        cursor = newline === -1 ? body.length : newline + 1;
        lineStart = true;
        continue;
      }
      const markerStart = context.contentStart;
      const marker = body[markerStart];
      if (marker === '`' || marker === '~') {
        let markerEnd = markerStart;
        while (body[markerEnd] === marker) markerEnd += 1;
        const markerLength = markerEnd - markerStart;
        if (markerLength >= 3) {
          const listContentIndent = containers.lists[containers.lists.length - 1]?.contentIndent;
          scannerState.fence = {
            marker,
            length: markerLength,
            quoteDepth: containers.quoteDepth,
            listContentIndent: listContentIndent ?? null,
          };
          cursor = newline === -1 ? body.length : newline + 1;
          lineStart = true;
          continue;
        }
      }
      cursor = context.contentStart;
    }

    const character = body[cursor];
    if (character === '\n') {
      cursor += 1;
      lineStart = true;
      continue;
    }
    if (character === '\r') {
      cursor += body[cursor + 1] === '\n' ? 2 : 1;
      lineStart = true;
      continue;
    }
    lineStart = false;

    if (character === '\\') {
      cursor = skipBackslashRun(body, cursor);
      continue;
    }

    if (body.startsWith('<!--', cursor)) {
      const close = body.indexOf('-->', cursor + 4);
      cursor = close === -1 ? body.length : close + 3;
      continue;
    }

    if (character === '`') {
      let runEnd = cursor;
      while (body[runEnd] === '`') runEnd += 1;
      const delimiter = body.slice(cursor, runEnd);
      const close = body.indexOf(delimiter, runEnd);
      cursor = close === -1 ? runEnd : close + delimiter.length;
      continue;
    }

    if (character !== '!') {
      cursor += 1;
      continue;
    }

    if (body.startsWith('![[', cursor)) {
      const close = findUnescaped(body, ']]', cursor + 3);
      if (close === -1) {
        cursor += 1;
        continue;
      }
      const separator = findUnescaped(body, '|', cursor + 3);
      const rawEnd = separator !== -1 && separator < close ? separator : close;
      const [targetStart, targetEnd] = trimRange(body, cursor + 3, rawEnd);
      if (targetStart < targetEnd) {
        tokens.push({ syntax: 'obsidian', targetStart, targetEnd });
      }
      cursor = close + 2;
      continue;
    }

    if (!body.startsWith('![', cursor)) {
      cursor += 1;
      continue;
    }
    const altClose = findClosingBracket(body, cursor + 2);
    if (altClose === -1 || body[altClose + 1] !== '(') {
      cursor += 1;
      continue;
    }
    const targetStart = skipMarkdownWhitespace(body, altClose + 2);
    if (body[targetStart] === '<') {
      const targetEnd = findUnescaped(body, '>', targetStart + 1);
      const syntaxEnd = targetEnd === -1
        ? -1
        : findMarkdownDestinationClose(body, targetEnd + 1);
      if (targetEnd === -1 || syntaxEnd === -1) {
        cursor += 1;
        continue;
      }
      tokens.push({ syntax: 'markdown', targetStart: targetStart + 1, targetEnd });
      cursor = syntaxEnd + 1;
      continue;
    }

    let depth = 0;
    let targetEnd = -1;
    let syntaxEnd = -1;
    for (let index = targetStart; index < body.length; index += 1) {
      const current = body[index];
      if (current === '\n' || current === '\r') {
        if (depth > 0) break;
        targetEnd = index;
        syntaxEnd = findMarkdownDestinationClose(body, index);
        break;
      }
      if (current === '\\') {
        index += 1;
        continue;
      }
      if (current === '(') {
        depth += 1;
        continue;
      }
      if (current === ')') {
        if (depth > 0) {
          depth -= 1;
          continue;
        }
        targetEnd = index;
        syntaxEnd = index;
        break;
      }
      if (depth === 0 && /\s/u.test(current ?? '')) {
        targetEnd = index;
        syntaxEnd = findMarkdownDestinationClose(body, index);
        break;
      }
    }
    if (targetEnd > targetStart && syntaxEnd !== -1) {
      tokens.push({ syntax: 'markdown', targetStart, targetEnd });
      cursor = syntaxEnd + 1;
      continue;
    }
    cursor += 1;
  }

  return tokens;
}

function decodeTarget(rawTarget: string): string | null {
  const markdownUnescaped = rawTarget.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/gu, '$1');
  try {
    return decodeURIComponent(markdownUnescaped).normalize('NFC');
  } catch {
    return null;
  }
}

function classifyTarget(
  rawTarget: string,
  syntax: ParsedImageReference['syntax'],
  sourceSyncPath: string,
): Pick<ParsedImageReference, 'resolvedPath' | 'classification'> {
  const decoded = decodeTarget(rawTarget);
  if (decoded === null) return { resolvedPath: null, classification: 'invalid_local' };
  if (/^data:/iu.test(decoded) || decoded.startsWith('//')) {
    return { resolvedPath: null, classification: 'external' };
  }
  if (
    /^file:/iu.test(decoded)
    || /^[a-z]:[\\/]/iu.test(decoded)
    || decoded.startsWith('/')
    || decoded.startsWith('~/')
    || decoded.includes('\\')
  ) {
    return { resolvedPath: null, classification: 'invalid_local' };
  }
  if (/^(?:https?|ftp):\/\//iu.test(decoded)) {
    return { resolvedPath: null, classification: 'external' };
  }
  if (
    syntax === 'obsidian'
    && !decoded.startsWith('assets/')
    && !/\.(?:png|jpe?g|webp|gif)$/iu.test(decoded)
  ) {
    // Obsidian uses the same ![[...]] syntax for transcluded Markdown Pages.
    // Only a supported image extension (or the explicit assets namespace)
    // belongs to the attachment protocol; all other targets remain Page embeds.
    return { resolvedPath: null, classification: 'page_embed' };
  }

  let candidate: string;
  if (!decoded.includes('/') && syntax === 'obsidian') {
    candidate = `assets/${decoded}`;
  } else if (decoded.startsWith('assets/')) {
    candidate = decoded;
  } else {
    const pagePath = sourceSyncPath.normalize('NFC').replace(/^pages\//u, '');
    const directory = posix.dirname(pagePath);
    candidate = posix.normalize(posix.join(directory === '.' ? '' : directory, decoded));
  }
  if (candidate.startsWith('../') || candidate === '..') {
    return { resolvedPath: null, classification: 'invalid_local' };
  }

  const parsed = FlatAttachmentPathSchema.safeParse(candidate);
  if (parsed.success) {
    return { resolvedPath: parsed.data, classification: 'managed_candidate' };
  }
  const unsupported = parsed.error.issues.some((issue) => (
    issue.message === 'Attachment path must use a supported image extension'
  ));
  return {
    resolvedPath: null,
    classification: unsupported ? 'unsupported' : 'invalid_local',
  };
}

export function parseImageReferences(
  body: string,
  sourceSyncPath: string,
): ParsedImageReference[] {
  return scanImageTargetTokens(body).map((token) => {
    const rawTarget = body.slice(token.targetStart, token.targetEnd);
    return {
      syntax: token.syntax,
      rawTarget,
      targetStart: token.targetStart,
      targetEnd: token.targetEnd,
      ...classifyTarget(rawTarget, token.syntax, sourceSyncPath),
    };
  });
}

export function resolveReferencedAttachments(
  body: string,
  sourceSyncPath: string,
  attachments: ReadonlyArray<AttachmentReferenceCandidate>,
): ResolvedAttachmentReferences {
  return resolveParsedAttachmentReferences(
    parseImageReferences(body, sourceSyncPath),
    attachments,
  );
}

export function resolveParsedAttachmentReferences(
  parsedReferences: ReadonlyArray<ParsedImageReference>,
  attachments: ReadonlyArray<AttachmentReferenceCandidate>,
): ResolvedAttachmentReferences {
  const references: ResolvedAttachmentReferences['references'] = [];
  const errors: ResolvedAttachmentReferences['errors'] = [];
  const attachmentsByPathKey = new Map<string, AttachmentReferenceCandidate[]>();
  for (const attachment of attachments) {
    const key = pathKey(`assets/${attachment.nameKey}`);
    const matches = attachmentsByPathKey.get(key) ?? [];
    matches.push(attachment);
    attachmentsByPathKey.set(key, matches);
  }

  for (const reference of parsedReferences) {
    if (reference.classification === 'external' || reference.classification === 'page_embed') continue;
    if (reference.classification !== 'managed_candidate' || reference.resolvedPath === null) {
      errors.push({
        code: 'ATTACHMENT_REFERENCE_INVALID',
        targetStart: reference.targetStart,
        targetEnd: reference.targetEnd,
      });
      continue;
    }
    const matches = attachmentsByPathKey.get(pathKey(reference.resolvedPath)) ?? [];
    if (matches.length !== 1) {
      errors.push({
        code: matches.length === 0 ? 'ATTACHMENT_MISSING' : 'ATTACHMENT_REFERENCE_INVALID',
        targetStart: reference.targetStart,
        targetEnd: reference.targetEnd,
      });
      continue;
    }
    references.push({ ...reference, attachmentId: matches[0].id });
  }

  return {
    attachmentIds: [...new Set(references.map((reference) => reference.attachmentId))].sort(),
    references,
    errors,
  };
}

export function rewriteAttachmentReferenceRanges(
  body: string,
  replacements: ReadonlyArray<{ start: number; end: number; target: string }>,
): string {
  const validRanges = new Set(scanImageTargetTokens(body).map((token) => (
    `${token.targetStart}:${token.targetEnd}`
  )));
  const ordered = [...replacements].sort((left, right) => (
    right.start - left.start || right.end - left.end
  ));
  let previousStart = body.length;
  for (const replacement of ordered) {
    if (
      replacement.start < 0
      || replacement.end <= replacement.start
      || replacement.end > body.length
      || replacement.end > previousStart
      || !validRanges.has(`${replacement.start}:${replacement.end}`)
    ) {
      throw new AttachmentReferenceError('ATTACHMENT_REFERENCE_INVALID');
    }
    previousStart = replacement.start;
  }

  let next = body;
  for (const replacement of ordered) {
    next = next.slice(0, replacement.start) + replacement.target + next.slice(replacement.end);
  }
  return next;
}
