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
  syntaxValid: boolean;
}

type MarkdownContainerStep =
  | { kind: 'blockquote' }
  | { kind: 'list'; contentIndent: number; contentStarted: boolean };

type FenceContainerStep =
  | { kind: 'blockquote' }
  | { kind: 'list'; contentIndent: number };

interface MarkdownContainerState {
  path: MarkdownContainerStep[];
}

interface MarkdownFenceState {
  marker: '`' | '~';
  length: number;
  containerPath: FenceContainerStep[];
  containsBlockquote: boolean;
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

function findMalformedMarkdownExpressionEnd(value: string, start: number): number {
  let cursor = start;
  let quote: '"' | "'" | null = null;
  let parenthesisDepth = 0;
  while (cursor < value.length) {
    const character = value[cursor];
    if (character === '\n' || character === '\r') return cursor;
    if (character === '\\') {
      cursor = skipBackslashRun(value, cursor);
      continue;
    }
    if (quote !== null) {
      if (character === quote) quote = null;
      cursor += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      cursor += 1;
      continue;
    }
    if (character === '(') {
      parenthesisDepth += 1;
      cursor += 1;
      continue;
    }
    if (character === ')') {
      if (parenthesisDepth === 0) return cursor + 1;
      parenthesisDepth -= 1;
    }
    cursor += 1;
  }
  return cursor;
}

function findMalformedAngleTargetEnd(value: string, start: number): number {
  let cursor = start;
  while (cursor < value.length) {
    const character = value[cursor];
    if (character === '\n' || character === '\r' || character === ')' || /[ \t]/u.test(character ?? '')) {
      return cursor;
    }
    if (character === '\\') {
      cursor = skipBackslashRun(value, cursor);
      continue;
    }
    cursor += 1;
  }
  return cursor;
}

interface LinePosition {
  offset: number;
  column: number;
  virtualIndent: number;
}

interface IndentScan {
  position: LinePosition;
  indent: number;
  blank: boolean;
}

function nextTabStop(column: number): number {
  return column + 4 - (column % 4);
}

function scanIndent(
  value: string,
  position: LinePosition,
  lineEnd: number,
): IndentScan {
  let offset = position.offset;
  let column = position.column;
  let indent = position.virtualIndent;
  while (offset < lineEnd) {
    if (value[offset] === ' ') {
      offset += 1;
      column += 1;
      indent += 1;
      continue;
    }
    if (value[offset] === '\t') {
      const nextColumn = nextTabStop(column);
      indent += nextColumn - column;
      column = nextColumn;
      offset += 1;
      continue;
    }
    break;
  }
  return {
    position: { offset, column, virtualIndent: 0 },
    indent,
    blank: offset >= lineEnd || value[offset] === '\r',
  };
}

function blankLine(value: string, lineStart: number, lineEnd: number): boolean {
  return scanIndent(value, {
    offset: lineStart,
    column: 0,
    virtualIndent: 0,
  }, lineEnd).blank;
}

function consumeIndent(
  value: string,
  position: LinePosition,
  lineEnd: number,
  required: number,
): LinePosition | null {
  const scanned = scanIndent(value, position, lineEnd);
  if (!scanned.blank && scanned.indent < required) return null;
  return {
    ...scanned.position,
    virtualIndent: scanned.blank ? 0 : scanned.indent - required,
  };
}

function blockquoteMarkerPosition(
  value: string,
  position: LinePosition,
  lineEnd: number,
): LinePosition | null {
  const indent = scanIndent(value, position, lineEnd);
  if (indent.indent > 3 || value[indent.position.offset] !== '>') return null;
  let offset = indent.position.offset + 1;
  let column = indent.position.column + 1;
  if (value[offset] === ' ') {
    offset += 1;
    column += 1;
  } else if (value[offset] === '\t') {
    const nextColumn = nextTabStop(column);
    offset += 1;
    return {
      offset,
      column: nextColumn,
      virtualIndent: nextColumn - column - 1,
    };
  }
  return { offset, column, virtualIndent: 0 };
}

function listMarkerPosition(
  value: string,
  position: LinePosition,
  lineEnd: number,
): { position: LinePosition; contentIndent: number; empty: boolean } | null {
  const indentation = scanIndent(value, position, lineEnd);
  if (indentation.indent > 3 || indentation.blank) return null;
  const markerStart = indentation.position.offset;
  let delimiterEnd = -1;
  if (value[markerStart] === '-' || value[markerStart] === '+' || value[markerStart] === '*') {
    delimiterEnd = markerStart + 1;
  } else {
    let cursor = markerStart;
    while (cursor < lineEnd && cursor - markerStart < 9 && /[0-9]/u.test(value[cursor] ?? '')) {
      cursor += 1;
    }
    if (cursor > markerStart && (value[cursor] === '.' || value[cursor] === ')')) {
      delimiterEnd = cursor + 1;
    }
  }
  if (delimiterEnd === -1) return null;

  const delimiterWidth = delimiterEnd - markerStart;
  const delimiterColumn = indentation.position.column + delimiterWidth;
  const padding = scanIndent(value, {
    offset: delimiterEnd,
    column: delimiterColumn,
    virtualIndent: 0,
  }, lineEnd);
  if (padding.blank) {
    return {
      position: padding.position,
      contentIndent: indentation.indent + delimiterWidth + 1,
      empty: true,
    };
  }
  if (padding.indent === 0) return null;

  const consumedPadding = padding.indent <= 4 ? padding.indent : 1;
  return {
    position: {
      ...padding.position,
      virtualIndent: padding.indent - consumedPadding,
    },
    contentIndent: indentation.indent + delimiterWidth + consumedPadding,
    empty: false,
  };
}

function markdownLineContext(
  value: string,
  lineStart: number,
  lineEnd: number,
  state: MarkdownContainerState,
): { contentStart: number; indentedCode: boolean } {
  let position: LinePosition = { offset: lineStart, column: 0, virtualIndent: 0 };
  const path: MarkdownContainerStep[] = [];

  for (const step of state.path) {
    if (step.kind === 'blockquote') {
      const nextPosition = blockquoteMarkerPosition(value, position, lineEnd);
      if (nextPosition === null) break;
      path.push(step);
      position = nextPosition;
      continue;
    }

    const remainderBlank = scanIndent(value, position, lineEnd).blank;
    if (!step.contentStarted && remainderBlank) break;
    const nextPosition = consumeIndent(value, position, lineEnd, step.contentIndent);
    if (nextPosition === null) break;
    if (!remainderBlank) step.contentStarted = true;
    path.push(step);
    position = nextPosition;
  }

  while (position.offset < lineEnd) {
    const quotePosition = blockquoteMarkerPosition(value, position, lineEnd);
    if (quotePosition !== null) {
      path.push({ kind: 'blockquote' });
      position = quotePosition;
      continue;
    }

    const listMarker = listMarkerPosition(value, position, lineEnd);
    if (listMarker === null) break;
    path.push({
      kind: 'list',
      contentIndent: listMarker.contentIndent,
      contentStarted: !listMarker.empty,
    });
    position = listMarker.position;
  }

  state.path = path;
  const indent = scanIndent(value, position, lineEnd);
  return {
    contentStart: indent.position.offset,
    indentedCode: !indent.blank && indent.indent >= 4,
  };
}

function activeFenceLineContext(
  value: string,
  lineStart: number,
  lineEnd: number,
  fence: MarkdownFenceState,
): { inContainer: boolean; position: LinePosition } {
  const initialPosition: LinePosition = { offset: lineStart, column: 0, virtualIndent: 0 };
  if (blankLine(value, lineStart, lineEnd)) {
    return {
      inContainer: !fence.containsBlockquote,
      position: { offset: lineEnd, column: 0, virtualIndent: 0 },
    };
  }

  let position = initialPosition;
  for (const step of fence.containerPath) {
    if (step.kind === 'blockquote') {
      const nextPosition = blockquoteMarkerPosition(value, position, lineEnd);
      if (nextPosition === null) return { inContainer: false, position: initialPosition };
      position = nextPosition;
      continue;
    }

    const nextPosition = consumeIndent(value, position, lineEnd, step.contentIndent);
    if (nextPosition === null) return { inContainer: false, position: initialPosition };
    position = nextPosition;
  }
  return { inContainer: true, position };
}

function scanImageTargetTokens(body: string): ImageTargetToken[] {
  const tokens: ImageTargetToken[] = [];
  let cursor = 0;
  let lineStart = true;
  const scannerState: { fence: MarkdownFenceState | null } = { fence: null };
  const containers: MarkdownContainerState = {
    path: [],
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
          const indentation = scanIndent(body, fenceContext.position, lineEnd);
          const markerStart = indentation.position.offset;
          const marker = body[markerStart];
          let markerEnd = markerStart;
          if (indentation.indent <= 3 && marker === scannerState.fence.marker) {
            while (body[markerEnd] === marker) markerEnd += 1;
          }
          const isClosingFence = indentation.indent <= 3
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
          scannerState.fence = {
            marker,
            length: markerLength,
            containerPath: containers.path.map((step) => (
              step.kind === 'blockquote'
                ? { kind: 'blockquote' }
                : { kind: 'list', contentIndent: step.contentIndent }
            )),
            containsBlockquote: containers.path.some((step) => step.kind === 'blockquote'),
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
        tokens.push({ syntax: 'obsidian', targetStart, targetEnd, syntaxValid: true });
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
      const angleClose = findUnescaped(body, '>', targetStart + 1);
      const targetEnd = angleClose === -1
        ? findMalformedAngleTargetEnd(body, targetStart + 1)
        : angleClose;
      const syntaxEnd = angleClose === -1
        ? -1
        : findMarkdownDestinationClose(body, angleClose + 1);
      if (targetEnd > targetStart + 1) {
        tokens.push({
          syntax: 'markdown',
          targetStart: targetStart + 1,
          targetEnd,
          syntaxValid: syntaxEnd !== -1,
        });
        cursor = syntaxEnd === -1
          ? findMalformedMarkdownExpressionEnd(body, targetEnd)
          : syntaxEnd + 1;
        continue;
      }
      cursor += 1;
      continue;
    }

    let depth = 0;
    let targetEnd = -1;
    let syntaxEnd = -1;
    let index = targetStart;
    for (; index < body.length; index += 1) {
      const current = body[index];
      if (current === '\n' || current === '\r') {
        targetEnd = index;
        if (depth === 0) syntaxEnd = findMarkdownDestinationClose(body, index);
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
    if (targetEnd === -1 && index === body.length) targetEnd = body.length;
    if (targetEnd > targetStart) {
      tokens.push({
        syntax: 'markdown',
        targetStart,
        targetEnd,
        syntaxValid: syntaxEnd !== -1,
      });
      cursor = syntaxEnd === -1
        ? findMalformedMarkdownExpressionEnd(body, targetEnd)
        : syntaxEnd + 1;
      continue;
    }
    cursor += 1;
  }

  return tokens;
}

export function hasImageReferenceLiteral(
  body: string,
  rawTargets: ReadonlyArray<string>,
): boolean {
  const targets = new Set(rawTargets);
  return scanImageTargetTokens(body).some((token) => {
    const rawTarget = body.slice(token.targetStart, token.targetEnd);
    if (targets.has(rawTarget)) return true;
    if (token.syntax !== 'obsidian') return false;
    const markerStart = token.targetStart - 3;
    return markerStart >= 0 && rawTargets.some((target) => (
      body.startsWith(`![[${target}]]`, markerStart)
    ));
  });
}

function decodeTarget(rawTarget: string, syntax: ParsedImageReference['syntax']): string | null {
  const escapedTarget = syntax === 'markdown'
    ? rawTarget.replace(/\\([ \t!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/gu, '$1')
    : rawTarget.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/gu, '$1');
  try {
    return decodeURIComponent(escapedTarget).normalize('NFC');
  } catch {
    return null;
  }
}

function classifyTarget(
  rawTarget: string,
  syntax: ParsedImageReference['syntax'],
  sourceSyncPath: string,
  syntaxValid = true,
): Pick<ParsedImageReference, 'resolvedPath' | 'classification'> {
  if (!syntaxValid) return { resolvedPath: null, classification: 'invalid_local' };
  const decoded = decodeTarget(rawTarget, syntax);
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
  if (syntax === 'obsidian') {
    candidate = !decoded.includes('/') ? `assets/${decoded}` : decoded;
  } else {
    const pagePath = sourceSyncPath.normalize('NFC');
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

export function classifyImageReferenceTarget(
  rawTarget: string,
  syntax: ParsedImageReference['syntax'],
  sourceSyncPath: string,
): Pick<ParsedImageReference, 'resolvedPath' | 'classification'> {
  return classifyTarget(rawTarget, syntax, sourceSyncPath);
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
      ...(token.syntaxValid
        ? classifyImageReferenceTarget(rawTarget, token.syntax, sourceSyncPath)
        : { resolvedPath: null, classification: 'invalid_local' as const }),
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
  const validRanges = new Set(scanImageTargetTokens(body)
    .filter((token) => token.syntaxValid)
    .map((token) => `${token.targetStart}:${token.targetEnd}`));
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
