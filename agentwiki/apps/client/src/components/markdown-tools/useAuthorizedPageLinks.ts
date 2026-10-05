import { useCallback, useLayoutEffect, useRef } from 'react';
import api from '../../api/client';
import type { PageLinkTarget } from '../markdownLinks';
/** On demand only; no global cache. Invalidates pending results on identity/permission change. */
export const useAuthorizedPageLinks = (userId: string | undefined, spaceId: string | undefined, pageId: string | undefined, canEdit: boolean) => {
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const scope = useRef({ userId, spaceId, pageId, canEdit });
  scope.current = { userId, spaceId, pageId, canEdit };
  useLayoutEffect(() => {
    generation.current += 1; controller.current?.abort();
    return () => { generation.current += 1; controller.current?.abort(); };
  }, [userId, spaceId, pageId, canEdit]);
  return useCallback(async (): Promise<PageLinkTarget[]> => {
    const captured = scope.current;
    if (!captured.userId || !captured.spaceId || !captured.pageId || !captured.canEdit) throw new Error('Page links unavailable');
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const token = ++generation.current;
    const response = await api.get('/pages', { params: { spaceId: captured.spaceId, take: 100 }, signal: request.signal });
    if (request.signal.aborted || token !== generation.current || scope.current.userId !== captured.userId || scope.current.spaceId !== captured.spaceId || scope.current.pageId !== captured.pageId || !scope.current.canEdit) throw new Error('Page links changed scope');
    const data: unknown = response.data?.data;
    if (!Array.isArray(data)) throw new Error('Invalid page links response');
    return data.slice(0, 100).filter((item): item is { id: string; title: string; slug?: string; spaceId: string } =>
      !!item && typeof item.id === 'string' && typeof item.title === 'string' && item.spaceId === captured.spaceId
    ).map(({ id, title, slug }) => ({ id, title, ...(typeof slug === 'string' ? { slug } : {}) }));
  }, []);
};
