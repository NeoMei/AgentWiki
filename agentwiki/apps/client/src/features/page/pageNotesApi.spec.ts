import { beforeEach, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { fromPageNote, pageNotesApi, type PageNoteDto } from './pageNotesApi';
import { captureAssistTarget } from './assistTargets';
vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const scope = { userId: 'viewer', spaceId: 'space', pageId: 'page' };
const target = captureAssistTarget('quote', 'selection', 0, 5, '2026-10-14T00:00:00Z')!;
const dto: PageNoteDto = { id: 'server-id', spaceId: 'space', pageId: 'page', body: 'body', target, status: 'pending', author: { type: 'agent', id: 'agent-id', name: 'Agent name' }, canEdit: false, createdAt: 'v1', updatedAt: 'v1' };
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });
it('keeps server human/Agent author and uses the page-scoped API', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { notes: [dto], canCreate: true } });
  const result = await pageNotesApi.list(scope);
  expect(api.get).toHaveBeenCalledWith('/spaces/space/pages/page/notes', { signal: undefined });
  expect(result.notes[0]).toMatchObject({ author: dto.author, userId: 'agent:agent-id', canEdit: false });
});
it('rejects a response for a different page or an unknown author type', () => {
  expect(() => fromPageNote({ ...dto, pageId: 'other' }, scope)).toThrow();
  expect(() => fromPageNote({ ...dto, author: { ...dto.author, type: 'unknown' as any } }, scope)).toThrow();
});
it('never submits the viewer identity as a note author and includes the server version for writes', async () => {
  vi.mocked(api.post).mockResolvedValue({ data: dto }); vi.mocked(api.patch).mockResolvedValue({ data: dto });
  const signal = new AbortController().signal;
  await pageNotesApi.create(scope, { clientNoteId: 'retry-key', body: 'body', target }, signal);
  expect(api.post).toHaveBeenCalledWith('/spaces/space/pages/page/notes', { clientNoteId: 'retry-key', body: 'body', target }, { signal });
  await pageNotesApi.update(scope, dto.id, { expectedUpdatedAt: 'v1', status: 'resolved' }, signal);
  expect(api.patch).toHaveBeenCalledWith('/spaces/space/pages/page/notes/server-id', { expectedUpdatedAt: 'v1', status: 'resolved' }, expect.objectContaining({ signal, timeout: 15_000, transformRequest: expect.any(Array) }));
});


it('rejects a session switch after the Axios interceptor but before the write adapter runs', async () => {
  localStorage.setItem('token', 'old-test-session');
  vi.mocked(api.patch).mockImplementation(async (_url, input, config) => {
    const transform = config!.transformRequest as Array<(data: unknown) => string>;
    expect(transform[0](input)).toBe(JSON.stringify(input));
    localStorage.setItem('token', 'new-test-session');
    transform[0](input);
    return { data: dto };
  });
  await expect(pageNotesApi.update(scope, dto.id, { expectedUpdatedAt: 'v1', status: 'resolved' })).rejects.toThrow('Page note session changed');
});
