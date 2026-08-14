import { createHash } from 'crypto';

/**
 * Streams the legacy KnowledgeBundle JSON exactly as the pre-migration
 * `JSON.stringify(snapshot)` produced it, without building the full string.
 *
 * Field insertion order, array order, conditional metadata omission, and
 * JSON string escaping must stay byte-compatible with the historical
 * serializer so `SpaceKnowledgeRevision.contentHash` remains stable.
 */

function jsonString(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '"') out += '\\"';
    else if (char === '\\') out += '\\\\';
    else if (char === '\b') out += '\\b';
    else if (char === '\f') out += '\\f';
    else if (char === '\n') out += '\\n';
    else if (char === '\r') out += '\\r';
    else if (char === '\t') out += '\\t';
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else if (code >= 0xd800 && code <= 0xdfff) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += char;
  }
  return `${out}"`;
}

function jsonArray(values: unknown[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(',')}]`;
}

export interface LegacyPageProjection {
  pageId: string;
  spaceId: string;
  path: string;
  title: string;
  body: string;
  order: number;
  metadata: { parentId: string } | null;
  artifactIds: string[];
  contentHash: string;
  updatedAt: string;
}

export interface LegacyBundleShape {
  schemaVersion: string;
  recipeVersion: string;
  spaceId: string;
  baseRevision: string | null;
  pages: LegacyPageProjection[];
  memories: unknown[];
  relations: unknown[];
  provenance: unknown[];
  deletions: unknown[];
}

function pageJson(page: LegacyPageProjection): string {
  let out = '{';
  out += `${jsonString('pageId')}:${jsonString(page.pageId)},`;
  out += `${jsonString('spaceId')}:${jsonString(page.spaceId)},`;
  out += `${jsonString('path')}:${jsonString(page.path)},`;
  out += `${jsonString('title')}:${jsonString(page.title)},`;
  out += `${jsonString('body')}:${jsonString(page.body)},`;
  out += `${jsonString('order')}:${page.order},`;
  if (page.metadata) {
    out += `${jsonString('metadata')}:${JSON.stringify(page.metadata)},`;
  }
  out += `${jsonString('artifactIds')}:${jsonArray(page.artifactIds)},`;
  out += `${jsonString('contentHash')}:${jsonString(page.contentHash)},`;
  out += `${jsonString('updatedAt')}:${jsonString(page.updatedAt)}`;
  return `${out}}`;
}

export function legacyBundleHash(bundle: LegacyBundleShape): string {
  let out = '{';
  out += `${jsonString('schemaVersion')}:${jsonString(bundle.schemaVersion)},`;
  out += `${jsonString('recipeVersion')}:${jsonString(bundle.recipeVersion)},`;
  out += `${jsonString('spaceId')}:${jsonString(bundle.spaceId)},`;
  out += `${jsonString('baseRevision')}:${bundle.baseRevision === null ? 'null' : jsonString(bundle.baseRevision)},`;
  out += `${jsonString('pages')}:[${bundle.pages.map(pageJson).join(',')}],`;
  out += `${jsonString('memories')}:${jsonArray(bundle.memories)},`;
  out += `${jsonString('relations')}:${jsonArray(bundle.relations)},`;
  out += `${jsonString('provenance')}:${jsonArray(bundle.provenance)},`;
  out += `${jsonString('deletions')}:${jsonArray(bundle.deletions)}`;
  out += '}';
  return createHash('sha256').update(out).digest('hex');
}

/**
 * Incremental builder that reproduces `JSON.stringify(snapshot)` bytes without
 * assembling the whole bundle string in memory. Callers append pages one at a
 * time (in legacy ordinal order), then call digest().
 */
export class LegacyBundleHashStream {
  private readonly hash = createHash('sha256');
  private firstPage = true;

  constructor(
    schemaVersion: string,
    recipeVersion: string,
    spaceId: string,
    baseRevision: string | null,
  ) {
    this.write(`{${jsonString('schemaVersion')}:${jsonString(schemaVersion)},`);
    this.write(`${jsonString('recipeVersion')}:${jsonString(recipeVersion)},`);
    this.write(`${jsonString('spaceId')}:${jsonString(spaceId)},`);
    this.write(`${jsonString('baseRevision')}:${baseRevision === null ? 'null' : jsonString(baseRevision)},`);
    this.write(`${jsonString('pages')}:[`);
  }

  appendPage(page: LegacyPageProjection): void {
    if (!this.firstPage) this.write(',');
    this.firstPage = false;
    this.write(pageJson(page));
  }

  digest(memories: unknown[], relations: unknown[], provenance: unknown[], deletions: unknown[]): string {
    this.write(`],${jsonString('memories')}:${jsonArray(memories)},`);
    this.write(`${jsonString('relations')}:${jsonArray(relations)},`);
    this.write(`${jsonString('provenance')}:${jsonArray(provenance)},`);
    this.write(`${jsonString('deletions')}:${jsonArray(deletions)}}`);
    return this.hash.digest('hex');
  }

  private write(chunk: string): void {
    this.hash.update(chunk, 'utf8');
  }
}
