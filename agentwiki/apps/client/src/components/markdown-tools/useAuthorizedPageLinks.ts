import { useCallback, useLayoutEffect, useRef } from 'react';
import api from '../../api/client';
import type { PageLinkTarget } from '../markdownLinks';

export type RequestPageLinks = (query?: string, signal?: AbortSignal) => Promise<PageLinkTarget[]>;

/** On demand only; no global cache. Invalidates pending results on identity/permission change. */
export const useAuthorizedPageLinks = (userId: string | undefined, spaceId: string | undefined, pageId: string | undefined, canEdit: boolean): RequestPageLinks => {
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const scope = useRef({ userId, spaceId, pageId, canEdit });
  scope.current = { userId, spaceId, pageId, canEdit };
  useLayoutEffect(() => {
    generation.current += 1; controller.current?.abort();
    return () => { generation.current += 1; controller.current?.abort(); };
  }, [userId, spaceId, pageId, canEdit]);
  return useCallback(async (query = '', signal?: AbortSignal): Promise<PageLinkTarget[]> => {
    const captured = scope.current;
    if (!captured.userId || !captured.spaceId || !captured.pageId || !captured.canEdit) throw new Error('Page links unavailable');
    controller.current?.abort();
    const token = ++generation.current;
    if (signal?.aborted) throw new DOMException('Page links cancelled', 'AbortError');
    const request = new AbortController(); controller.current = request;
    const abort = () => request.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const normalizedQuery = query.trim();
    const limit = normalizedQuery ? 50 : 100;
    try {
      const response = await api.get(normalizedQuery ? '/search' : '/pages', {
        params: normalizedQuery ? { q: normalizedQuery, spaceId: captured.spaceId, limit } : { spaceId: captured.spaceId, take: limit },
        signal: request.signal,
      });
      if (request.signal.aborted || token !== generation.current || scope.current.userId !== captured.userId || scope.current.spaceId !== captured.spaceId || scope.current.pageId !== captured.pageId || !scope.current.canEdit) throw new Error('Page links changed scope');
      const data: unknown = normalizedQuery ? response.data?.results : response.data?.data;
      if (!Array.isArray(data)) throw new Error('Invalid page links response');
      const pages: PageLinkTarget[] = [];
      const seen = new Set<string>();
      for (const row of data) {
        const item: unknown = normalizedQuery ? row?.page : row;
        if (!item || typeof item !== 'object') continue;
        const { id, title, slug, spaceId: resultSpace } = item as Record<string, unknown>;
        if (typeof id !== 'string' || !id.trim() || typeof title !== 'string' || resultSpace !== captured.spaceId || seen.has(id)) continue;
        seen.add(id);
        pages.push({ id, title, ...(typeof slug === 'string' ? { slug } : {}) });
        if (pages.length === limit) break;
      }
      return pages;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (controller.current === request) controller.current = null;
    }
  }, []);
};
