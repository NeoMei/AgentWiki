import { AsyncLocalStorage } from 'node:async_hooks';
import { PAGE_CONTENT_MAX_BYTES } from '@agentwiki/shared';
import type { NextFunction, Request, Response } from 'express';

const largeDocumentPreference = new AsyncLocalStorage<boolean>();
const syncRoutes = /^\/api\/(?:sync\/v[123]|integrations\/obsidian)(?:\/|$)/iu;
export const LEGACY_SYNC_PAGE_BYTES = 1024 * 1024;
export const LEGACY_SYNC_DOCUMENT_TREE_BYTES = 2 * 1024 * 1024;
export const LEGACY_SYNC_JSON_BYTES = 4 * 1024 * 1024;

export function syncDocumentLimitsMiddleware(request: Request, _response: Response, next: NextFunction) {
  if (!syncRoutes.test(request.path)) return next();
  const acceptsLargeDocuments =
    request.get('X-AgentWiki-Sync-Max-Page-Bytes') === String(PAGE_CONTENT_MAX_BYTES);
  return largeDocumentPreference.run(acceptsLargeDocuments, next);
}

export function supportsLargeSyncDocuments(): boolean {
  return largeDocumentPreference.getStore() !== false;
}
