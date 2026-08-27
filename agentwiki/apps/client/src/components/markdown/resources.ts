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
const MAX_REFERENCE_CHARS = 512;

// Mirrors validator.js `isLength`, which class-validator's MaxLength delegates
// to: surrogate pairs and BMP presentation-selector sequences each count as a
// single character.
export const validatorStringLength = (value: string): number => {
  const presentationSequences = value.match(/[^\uFE0F\uFE0E][\uFE0F\uFE0E]/g) ?? [];
  const surrogatePairs = value.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) ?? [];
  return value.length - presentationSequences.length - surrogatePairs.length;
};

export interface MarkdownResourceRef {
  canonicalKey: string;
  kind: 'page' | 'attachment';
  target: string;
  heading?: string;
  blockId?: string;
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

const assertBoundedPart = (value: string | undefined): void => {
  if (value !== undefined && validatorStringLength(value) > MAX_REFERENCE_CHARS) {
    throw new Error('Markdown resource reference is too long');
  }
};

export function collectMarkdownResourceRefs(source: string): MarkdownResourceRef[] {
  const tree = resourceParser.runSync(resourceParser.parse(source)) as MarkdownAstNode;
  const refs = new Map<string, MarkdownResourceRef>();

  visit(tree as never, (node: MarkdownAstNode) => {
    if (!['agentWikiLink', 'agentWikiEmbed', 'agentWikiImage'].includes(node.type)) return;
    const properties = node.data?.hProperties ?? {};
    const target = String(properties['data-markdown-target'] ?? '').trim();
    if (!target) return;
    const headingValue = properties['data-markdown-heading'];
    const blockValue = properties['data-markdown-block-id'];
    const heading = typeof headingValue === 'string' && headingValue.trim() ? headingValue.trim() : undefined;
    const blockId = typeof blockValue === 'string' && blockValue.trim() ? blockValue.trim() : undefined;
    const fragmentPresent = properties['data-markdown-fragment-present'] === 'true';
    const fragmentKind = properties['data-markdown-fragment-kind'];
    const fragmentValid = properties['data-markdown-fragment-valid'] !== 'false';
    if (!fragmentValid) return;
    if (node.type === 'agentWikiEmbed' && fragmentKind === 'block') return;
    if (node.type === 'agentWikiImage' && fragmentPresent) return;
    assertBoundedPart(target);
    assertBoundedPart(heading);
    assertBoundedPart(blockId);

    const reference: WikiReference = {
      embed: node.type !== 'agentWikiLink',
      target,
      label: null,
      heading: heading ?? null,
      blockId: blockId ?? null,
      fragmentPresent,
      fragmentKind: fragmentKind === 'heading' || fragmentKind === 'block' ? fragmentKind : null,
      fragmentValid,
    };
    const canonicalKey = canonicalWikiReferenceKey(reference);
    if (!refs.has(canonicalKey)) {
      refs.set(canonicalKey, {
        canonicalKey,
        kind: wikiReferenceKind(reference),
        target,
        ...(heading ? { heading } : {}),
        ...(blockId ? { blockId } : {}),
      });
      if (refs.size > MAX_REFERENCES) throw new Error('Markdown resource limit exceeded');
    }
  });

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
  const result = new Map<string, ResolvedMarkdownResource>();
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
