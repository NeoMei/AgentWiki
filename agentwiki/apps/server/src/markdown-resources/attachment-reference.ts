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

export class AttachmentReferenceError extends Error {
  readonly code: AttachmentReferenceErrorCode;

  constructor(code: AttachmentReferenceErrorCode) {
    super(code);
    this.name = 'AttachmentReferenceError';
    this.code = code;
  }
}

function isEscaped(value: string, offset: number): boolean {
  let backslashes = 0;
  for (let index = offset - 1; index >= 0 && value[index] === '\\'; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function trimRange(value: string, start: number, end: number): [number, number] {
  while (start < end && /\s/u.test(value[start] ?? '')) start += 1;
  while (end > start && /\s/u.test(value[end - 1] ?? '')) end -= 1;
  return [start, end];
}

function findUnescaped(value: string, needle: string, start: number): number {
  for (let index = start; index <= value.length - needle.length; index += 1) {
    if (value.startsWith(needle, index) && !isEscaped(value, index)) return index;
  }
  return -1;
}

function findClosingBracket(value: string, start: number): number {
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === '\n' || value[index] === '\r') return -1;
    if (isEscaped(value, index)) continue;
    if (value[index] === '[') {
      depth += 1;
      continue;
    }
    if (value[index] === ']') {
      if (depth === 0) return index;
      depth -= 1;
    }
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
  let quote: "'" | '"' | null = null;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === ')') return index;
  }
  return -1;
}

function scanImageTargetTokens(body: string): ImageTargetToken[] {
  const tokens: ImageTargetToken[] = [];
  let cursor = 0;
  let lineStart = true;
  let fence: { marker: '`' | '~'; length: number } | null = null;

  while (cursor < body.length) {
    if (lineStart) {
      let markerStart = cursor;
      while (markerStart < body.length && markerStart - cursor < 3 && body[markerStart] === ' ') {
        markerStart += 1;
      }
      const marker = body[markerStart];
      if (marker === '`' || marker === '~') {
        let markerEnd = markerStart;
        while (body[markerEnd] === marker) markerEnd += 1;
        const markerLength = markerEnd - markerStart;
        const newline = body.indexOf('\n', markerEnd);
        const lineEnd = newline === -1 ? body.length : newline;
        const isClosingFence = Boolean(
          fence
          && fence.marker === marker
          && markerLength >= fence.length
          && /^[ \t\r]*$/u.test(body.slice(markerEnd, lineEnd)),
        );
        if ((!fence && markerLength >= 3) || isClosingFence) {
          fence = fence ? null : { marker, length: markerLength };
          cursor = newline === -1 ? body.length : newline + 1;
          lineStart = true;
          continue;
        }
      }
    }

    if (fence) {
      const newline = body.indexOf('\n', cursor);
      cursor = newline === -1 ? body.length : newline + 1;
      lineStart = true;
      continue;
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

    if (character === '`' && !isEscaped(body, cursor)) {
      let runEnd = cursor;
      while (body[runEnd] === '`') runEnd += 1;
      const delimiter = body.slice(cursor, runEnd);
      const close = body.indexOf(delimiter, runEnd);
      cursor = close === -1 ? runEnd : close + delimiter.length;
      continue;
    }

    if (character !== '!' || isEscaped(body, cursor)) {
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
  if (/^(?:[a-z][a-z0-9+.-]*:\/\/|data:)/iu.test(decoded) || decoded.startsWith('//')) {
    return { resolvedPath: null, classification: 'external' };
  }
  if (decoded.startsWith('/') || decoded.startsWith('~/') || decoded.includes('\\')) {
    return { resolvedPath: null, classification: 'invalid_local' };
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
    if (reference.classification === 'external') continue;
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
