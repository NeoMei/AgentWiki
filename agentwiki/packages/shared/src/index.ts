export const SPACE_NAME_MAX_LENGTH = 32;
export const PAGE_CONTENT_MAX_BYTES = 10 * 1024 * 1024;
// JSON may escape one UTF-8 byte into six ASCII bytes.
export const PAGE_CONTENT_JSON_MAX_BYTES = 64 * 1024 * 1024;
const pageContentEncoder = new TextEncoder();

export function exceedsPageContentLimit(content: string): boolean {
  const normalized = content.replace(/\r\n?/gu, '\n');
  return normalized.length > PAGE_CONTENT_MAX_BYTES
    || pageContentEncoder.encode(normalized).byteLength > PAGE_CONTENT_MAX_BYTES;
}

export interface User {
  id: string;
  email: string;
  name: string;
  platformRole?: 'user' | 'super_admin';
}

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
}

export interface Space {
  id: string;
  name: string;
  workspaceId: string;
}

export interface Page {
  id: string;
  title: string;
  content: string;
  spaceId: string;
}

export interface PageSourceStatus {
  status: 'untracked' | 'unknown' | 'unavailable' | 'needs_review' | 'current';
  reason: 'no_source' | 'unverified_source' | 'source_unavailable' | 'source_changed' | 'page_changed' | 'reviewed_source';
  sourceId?: string;
  reviewedSourceVersionId?: string;
  currentSourceVersionId?: string;
  reviewedSourceVersion?: number;
  currentSourceVersion?: number;
  reviewedSourceGeneration?: number;
  currentSourceGeneration?: number;
}
