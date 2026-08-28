import api from './client';

interface ContentTreeHeadResponse {
  treeRevision: string;
}

export async function getContentTreeRevision(
  spaceId: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await api.get<ContentTreeHeadResponse>(
    `/spaces/${encodeURIComponent(spaceId)}/content-tree`,
    { params: { take: 1 }, ...(signal ? { signal } : {}) },
  );
  const revision = response.data?.treeRevision;
  if (typeof revision !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(revision)) {
    throw new Error('Invalid content tree revision');
  }
  return revision;
}
