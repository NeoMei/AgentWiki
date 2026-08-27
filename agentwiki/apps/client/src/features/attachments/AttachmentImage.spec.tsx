import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachmentImage } from './AttachmentImage';

const mocks = vi.hoisted(() => ({ fetchAttachmentBlob: vi.fn() }));
vi.mock('./attachmentApi', () => ({ fetchAttachmentBlob: mocks.fetchAttachmentBlob }));
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('AttachmentImage', () => {
  const createObjectURL = vi.fn<(blob: Blob) => string>();
  const revokeObjectURL = vi.fn<(url: string) => void>();

  beforeEach(() => {
    vi.clearAllMocks();
    createObjectURL.mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
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

  it('renders a bounded loading frame, then one protected Object URL with filename alt and dimensions', async () => {
    mocks.fetchAttachmentBlob.mockResolvedValue(new Blob(['first'], { type: 'image/png' }));
    const { unmount } = render(<AttachmentImage attachmentId="first" displayName="diagram.png" width={1280} height={720} style={{ aspectRatio: '1 / 1' }} />);

    expect(screen.getByRole('status')).toHaveTextContent('diagram.png');
    expect(screen.getByRole('status')).toHaveStyle({ aspectRatio: '1280 / 720' });
    const image = await screen.findByRole('img', { name: 'diagram.png' });
    expect(image).toHaveAttribute('src', 'blob:first');
    expect(image).toHaveAttribute('width', '1280');
    expect(image).toHaveAttribute('height', '720');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(image.getAttribute('src')).not.toContain('/api/attachments');

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first');
  });

  it('uses explicit alt and renders a bounded error frame on a current failure', async () => {
    mocks.fetchAttachmentBlob.mockRejectedValue(new Error('denied'));
    render(<AttachmentImage attachmentId="first" displayName="diagram.png" alt="Architecture" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Architecture');
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('aborts and revokes the prior URL on ID change', async () => {
    mocks.fetchAttachmentBlob.mockResolvedValueOnce(new Blob(['first'])).mockResolvedValueOnce(new Blob(['second']));
    const { rerender } = render(<AttachmentImage attachmentId="first" displayName="first.png" />);
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:first');
    const firstSignal = mocks.fetchAttachmentBlob.mock.calls[0][1] as AbortSignal;

    rerender(<AttachmentImage attachmentId="second" displayName="second.png" />);

    expect(firstSignal.aborted).toBe(true);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first');
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:second');
  });

  it('suppresses a stale response before creating an Object URL or replacing the current image', async () => {
    const stale = deferred<Blob>();
    const current = deferred<Blob>();
    mocks.fetchAttachmentBlob.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);
    const { rerender } = render(<AttachmentImage attachmentId="first" displayName="first.png" />);
    rerender(<AttachmentImage attachmentId="second" displayName="second.png" />);

    await act(async () => current.resolve(new Blob(['second'])));
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:first');

    await act(async () => stale.resolve(new Blob(['stale'])));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:first');
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:second');
  });

  it('does not turn an abort into an error and creates no URL after unmount', async () => {
    const pending = deferred<Blob>();
    mocks.fetchAttachmentBlob.mockReturnValue(pending.promise);
    const { unmount } = render(<AttachmentImage attachmentId="first" displayName="first.png" />);
    const signal = mocks.fetchAttachmentBlob.mock.calls[0][1] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(new Blob(['late'])));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
