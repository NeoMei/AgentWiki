import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import {
  archiveAttachment,
  fetchAttachmentBlob,
  listAttachments,
  restoreAttachment,
  uploadAttachment,
} from './attachmentApi';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const rawAttachment = (overrides: Record<string, unknown> = {}) => ({
  id: 'attachment-1',
  spaceId: 'space-1',
  displayName: 'diagram.png',
  mimeType: 'image/png',
  sizeBytes: '9007199254740993',
  width: 1280,
  height: 720,
  status: 'active',
  uploadedByUserId: 'user-1',
  createdAt: '2026-08-27T01:00:00.000Z',
  updatedAt: '2026-08-27T01:01:00.000Z',
  archivedAt: null,
  ...overrides,
});

describe('attachmentApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('encodes the Space path, forwards bounded list query and preserves bigint sizes', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { items: [rawAttachment()], total: 1, skip: 2, take: 20 },
    });

    const result = await listAttachments('space /?#', {
      q: 'road map/#1', status: 'archived', skip: 2, take: 20,
    });

    expect(api.get).toHaveBeenCalledWith('/spaces/space%20%2F%3F%23/attachments', {
      params: { q: 'road map/#1', status: 'archived', skip: 2, take: 20 },
      signal: undefined,
    });
    expect(result.items[0].sizeBytes).toBe(9007199254740993n);
    expect(result).toMatchObject({ total: 1, skip: 2, take: 20 });
  });

  it.each([
    ['-1'], ['1.5'], ['1e3'], [''], ['not-a-number'], [Number('9007199254740993')],
  ])('rejects malformed or precision-losing server size %p', async (sizeBytes) => {
    vi.mocked(api.get).mockResolvedValue({
      data: { items: [rawAttachment({ sizeBytes })], total: 1, skip: 0, take: 20 },
    });
    await expect(listAttachments('space-1')).rejects.toThrow('Invalid attachment response');
  });

  it('uploads multipart without forcing JSON content type and normalizes progress', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, _body, config) => {
      config?.onUploadProgress?.({ loaded: 5, total: 8 } as never);
      config?.onUploadProgress?.({ loaded: 12, total: 8 } as never);
      return { data: rawAttachment({ displayName: 'diagram (2).png' }) };
    });
    const progress = vi.fn();
    const file = new File(['png'], 'diagram.png', { type: 'image/png' });

    const result = await uploadAttachment('space /', file, { onProgress: progress });

    const [url, formData, config] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/spaces/space%20%2F/attachments');
    expect(formData).toBeInstanceOf(FormData);
    expect((formData as FormData).get('file')).toBe(file);
    expect(config?.headers).toEqual({ 'Content-Type': undefined });
    expect(progress.mock.calls.map(([value]) => value)).toEqual([63, 100]);
    expect(result.displayName).toBe('diagram (2).png');
  });

  it.each([
    ['archive', archiveAttachment],
    ['restore', restoreAttachment],
  ] as const)('encodes state-change paths and sends compare-and-set timestamp for %s', async (action, fn) => {
    vi.mocked(api.post).mockResolvedValue({ data: rawAttachment({ status: action === 'archive' ? 'archived' : 'active' }) });
    const signal = new AbortController().signal;

    await fn('space /', 'attachment /?#', '2026-08-27T01:01:00.000Z', signal);

    expect(api.post).toHaveBeenCalledWith(
      `/spaces/space%20%2F/attachments/attachment%20%2F%3F%23/${action}`,
      { expectedUpdatedAt: '2026-08-27T01:01:00.000Z' },
      { signal },
    );
  });

  it('fetches protected content through the shared client with Blob mode and abort signal', async () => {
    const blob = new Blob(['image'], { type: 'image/png' });
    vi.mocked(api.get).mockResolvedValue({ data: blob });
    const signal = new AbortController().signal;

    await expect(fetchAttachmentBlob('attachment /?#', signal)).resolves.toBe(blob);
    expect(api.get).toHaveBeenCalledWith('/attachments/attachment%20%2F%3F%23/content', {
      responseType: 'blob', signal,
    });
  });

  it('propagates a shared-client 401 rejection without swallowing or replacing it', async () => {
    const unauthorized = { response: { status: 401 } };
    vi.mocked(api.get).mockRejectedValue(unauthorized);
    await expect(fetchAttachmentBlob('attachment-1')).rejects.toBe(unauthorized);
  });

  it('uses the one shared Axios instance so its real 401 interceptor remains active', async () => {
    vi.resetModules();
    vi.doUnmock('../../api/client');
    const axiosModule = await import('axios');
    const createSpy = vi.spyOn(axiosModule.default, 'create');
    const { default: sharedApi } = await import('../../api/client');
    expect(createSpy).toHaveBeenCalledTimes(1);
    const unauthorized = {
      config: { url: '/attachments/attachment-1/content' },
      response: { status: 401 },
    };
    sharedApi.defaults.adapter = async () => Promise.reject(unauthorized);
    localStorage.setItem('token', 'expired-token');
    const freshAttachmentApi = await import('./attachmentApi');

    await expect(freshAttachmentApi.fetchAttachmentBlob('attachment-1')).rejects.toBe(unauthorized);

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('token')).toBeNull();
  });
});
