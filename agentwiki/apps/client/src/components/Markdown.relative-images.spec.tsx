import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../api/client';
import { LanguageProvider } from '../context/LanguageContext';
import { fetchAttachmentBlob } from '../features/attachments/attachmentApi';
import { Markdown } from './Markdown';

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../features/attachments/attachmentApi', () => ({
  fetchAttachmentBlob: vi.fn(),
}));

const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

const renderMarkdown = (source: string, pageId = 'source-page') => render(
  <LanguageProvider><MemoryRouter>
    <Markdown spaceId="space-1" pageId={pageId} mode="page">{source}</Markdown>
  </MemoryRouter></LanguageProvider>,
);

describe('standard Markdown attachment image rendering', () => {
  const createObjectURL = vi.fn<(blob: Blob) => string>();
  const revokeObjectURL = vi.fn<(url: string) => void>();

  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    vi.clearAllMocks();
    createObjectURL.mockReturnValue('blob:first-local');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  });

  afterEach(() => {
    cleanup();
    if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL);
    else Reflect.deleteProperty(URL, 'createObjectURL');
    if (originalRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
    else Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  it('resolves a relative image through the public resource contract and real AttachmentImage', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string }> }).references.map(({ key }) => ({
        key,
        status: 'resolved',
        kind: 'attachment',
        attachmentId: 'attachment-first-local',
        displayName: 'first-local.png',
        mimeType: 'image/png',
        width: 480,
        height: 270,
      })),
    }));
    vi.mocked(fetchAttachmentBlob).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));

    const { container } = renderMarkdown(
      '![First local image](../assets/first-local.png "First image title")',
    );

    expect(await screen.findByRole('img', { name: 'First local image' })).toHaveAttribute('src', 'blob:first-local');
    expect(screen.getByRole('img', { name: 'First local image' })).toHaveAttribute('title', 'First image title');
    expect(container.querySelector('img[src="../assets/first-local.png"]')).toBeNull();
    expect(api.post).toHaveBeenCalledWith(
      '/spaces/space-1/markdown/resolve',
      {
        sourcePageId: 'source-page',
        references: [{
          key: 'r0',
          kind: 'attachment',
          syntax: 'markdown',
          target: '../assets/first-local.png',
        }],
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(fetchAttachmentBlob).toHaveBeenCalledWith('attachment-first-local', expect.any(AbortSignal));
  });

  it('preserves an explicitly empty alt while using the protected Blob renderer', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string }> }).references.map(({ key }) => ({
        key,
        status: 'resolved',
        kind: 'attachment',
        attachmentId: 'attachment-decorative',
        displayName: 'decorative.png',
        mimeType: 'image/png',
        width: 16,
        height: 16,
      })),
    }));
    vi.mocked(fetchAttachmentBlob).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));

    const { container } = renderMarkdown('![](../assets/decorative.png "Decoration")');

    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'blob:first-local'));
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
    expect(container.querySelector('img')).toHaveAttribute('title', 'Decoration');
  });

  it('fails missing and traversal images closed while preserving external HTTPS behavior', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string }> }).references.map(({ key }, index) => ({
        key,
        status: index === 0 ? 'unresolved' : 'ambiguous',
      })),
    }));

    const { container } = renderMarkdown([
      '![Missing](../assets/missing.png)',
      '![Traversal](../../secret.png)',
      '![External](https://cdn.example.test/safe.png)',
    ].join('\n\n'));

    expect(await screen.findByText('Image unavailable: Missing')).toBeInTheDocument();
    expect(screen.getByText('Image unavailable: Traversal')).toBeInTheDocument();
    expect(container.querySelector('img[src="../assets/missing.png"]')).toBeNull();
    expect(container.querySelector('img[src="../../secret.png"]')).toBeNull();
    expect(screen.getByRole('img', { name: 'External' })).toHaveAttribute(
      'src',
      'https://cdn.example.test/safe.png',
    );
    expect(fetchAttachmentBlob).not.toHaveBeenCalled();
  });

  it('uses the embedded Page as source context for its nested relative image', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      data: (body as { references: Array<{ key: string; kind: string }> }).references.map((reference) => (
        reference.kind === 'page'
          ? {
              key: reference.key,
              status: 'resolved',
              kind: 'page',
              pageId: 'nested-page',
              title: 'Nested Page',
              slug: 'nested-page',
            }
          : {
              key: reference.key,
              status: 'resolved',
              kind: 'attachment',
              attachmentId: 'attachment-nested',
              displayName: 'nested.png',
              mimeType: 'image/png',
              width: 320,
              height: 180,
            }
      )),
    }));
    vi.mocked(api.get).mockResolvedValue({
      data: { id: 'nested-page', content: '![Nested image](../../assets/nested.png)' },
    });
    vi.mocked(fetchAttachmentBlob).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));

    renderMarkdown('![[Nested Page]]');

    expect(await screen.findByRole('img', { name: 'Nested image' })).toHaveAttribute('src', 'blob:first-local');
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.post).mock.calls[1]?.[1]).toEqual({
      sourcePageId: 'nested-page',
      references: [{
        key: 'r0',
        kind: 'attachment',
        syntax: 'markdown',
        target: '../../assets/nested.png',
      }],
    });
  });
});
