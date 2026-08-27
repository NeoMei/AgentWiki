import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { AttachmentPickerDialog } from './AttachmentPickerDialog';

const mocks = vi.hoisted(() => ({
  listAttachments: vi.fn(),
  uploadAttachment: vi.fn(),
  archiveAttachment: vi.fn(),
  restoreAttachment: vi.fn(),
}));
vi.mock('./attachmentApi', () => mocks);

const attachment = (overrides: Record<string, unknown> = {}) => ({
  id: 'attachment-1', spaceId: 'space-1', displayName: 'diagram.png', mimeType: 'image/png',
  sizeBytes: 10n, width: 100, height: 50, status: 'active' as const,
  uploadedByUserId: 'user-1', createdAt: '2026-08-27T01:00:00Z',
  updatedAt: '2026-08-27T01:01:00Z', archivedAt: null,
  ...overrides,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

const renderDialog = (overrides: Partial<React.ComponentProps<typeof AttachmentPickerDialog>> = {}) => {
  const onClose = vi.fn();
  const onInsert = vi.fn();
  render(<LanguageProvider><AttachmentPickerDialog spaceId="space-1" onClose={onClose} onInsert={onInsert} {...overrides} /></LanguageProvider>);
  return { onClose, onInsert };
};

describe('AttachmentPickerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'en');
    mocks.listAttachments.mockResolvedValue({ items: [attachment()], total: 1, skip: 0, take: 20 });
  });

  it('loads active attachments, searches with stale suppression, filters and loads more using server pagination', async () => {
    const stale = deferred<{ items: ReturnType<typeof attachment>[]; total: number; skip: number; take: number }>();
    mocks.listAttachments
      .mockResolvedValueOnce({ items: [attachment()], total: 1, skip: 0, take: 20 })
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ items: [attachment({ id: 'new', displayName: 'new.png' })], total: 21, skip: 0, take: 20 })
      .mockResolvedValueOnce({ items: [attachment({ id: 'more', displayName: 'more.png' })], total: 21, skip: 20, take: 20 })
      .mockResolvedValueOnce({ items: [attachment({ id: 'archived', displayName: 'old.png', status: 'archived' })], total: 1, skip: 0, take: 20 });
    renderDialog();
    expect(await screen.findByText('diagram.png')).toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: 'Search attachments' });
    fireEvent.change(search, { target: { value: 'old' } });
    fireEvent.change(search, { target: { value: 'new' } });
    expect(await screen.findByText('new.png')).toBeInTheDocument();
    await act(async () => stale.resolve({ items: [attachment({ displayName: 'stale.png' })], total: 1, skip: 0, take: 20 }));
    expect(screen.queryByText('stale.png')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('more.png')).toBeInTheDocument();
    expect(mocks.listAttachments).toHaveBeenCalledWith('space-1', expect.objectContaining({ q: 'new', status: 'active', skip: 20, take: 20 }), expect.any(AbortSignal));

    fireEvent.change(screen.getByRole('combobox', { name: 'Attachment status' }), { target: { value: 'archived' } });
    expect(await screen.findByText('old.png')).toBeInTheDocument();
    expect(mocks.listAttachments).toHaveBeenLastCalledWith('space-1', expect.objectContaining({ status: 'archived', skip: 0 }), expect.any(AbortSignal));
  });

  it('switches to the authoritative active filter after restore before allowing insertion', async () => {
    const archived = attachment({ id: 'old', displayName: 'old.png', status: 'archived' });
    const restoredItem = attachment({ id: 'old', displayName: 'old.png', status: 'active', updatedAt: '2026-08-27T02:00:00Z' });
    const activeReload = deferred<{ items: ReturnType<typeof attachment>[]; total: number; skip: number; take: number }>();
    let activeCalls = 0;
    mocks.listAttachments.mockImplementation(async (_spaceId: string, params: { status: string }) => {
      if (params.status === 'archived') return { items: [archived], total: 1, skip: 0, take: 20 };
      activeCalls += 1;
      if (activeCalls === 1) return { items: [attachment()], total: 1, skip: 0, take: 20 };
      return activeReload.promise;
    });
    const restored = deferred<ReturnType<typeof attachment>>();
    mocks.restoreAttachment.mockReturnValue(restored.promise);
    const { onInsert } = renderDialog();
    await screen.findByRole('listitem', { name: 'diagram.png' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Attachment status' }), { target: { value: 'archived' } });
    const archivedRow = await screen.findByRole('listitem', { name: 'old.png' });
    expect(within(archivedRow).queryByRole('button', { name: 'Insert old.png' })).not.toBeInTheDocument();
    fireEvent.click(within(archivedRow).getByRole('button', { name: 'Restore old.png' }));
    expect(mocks.restoreAttachment).toHaveBeenCalledWith('space-1', 'old', '2026-08-27T01:01:00Z');
    expect(within(archivedRow).queryByRole('button', { name: 'Insert old.png' })).not.toBeInTheDocument();
    await act(async () => restored.resolve(restoredItem));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Attachment status' })).toHaveValue('active'));
    await waitFor(() => expect(mocks.listAttachments).toHaveBeenLastCalledWith('space-1', expect.objectContaining({ status: 'active' }), expect.any(AbortSignal)));
    expect(screen.getByRole('searchbox', { name: 'Search attachments' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Attachment status' })).toBeDisabled();
    expect(screen.getByLabelText('Upload image')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close attachment picker' })).toBeDisabled();
    await act(async () => activeReload.resolve({ items: [restoredItem], total: 1, skip: 0, take: 20 }));
    const activeRow = await screen.findByRole('listitem', { name: 'old.png' });
    expect(screen.getByRole('searchbox', { name: 'Search attachments' })).toBeEnabled();
    fireEvent.click(within(activeRow).getByRole('button', { name: 'Insert old.png' }));
    expect(onInsert).toHaveBeenLastCalledWith('old.png');
  });

  it('reloads the active first page after archive so offset pagination cannot skip the shifted boundary row', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => attachment({
      id: `active-${index + 1}`,
      displayName: `active-${index + 1}.png`,
    }));
    const shiftedPage = [...firstPage.slice(1), attachment({ id: 'active-21', displayName: 'active-21.png' })];
    const archivedMutation = deferred<ReturnType<typeof attachment>>();
    const reconciliation = deferred<{ items: ReturnType<typeof attachment>[]; total: number; skip: number; take: number }>();
    mocks.listAttachments
      .mockResolvedValueOnce({ items: firstPage, total: 21, skip: 0, take: 20 })
      .mockReturnValueOnce(reconciliation.promise);
    mocks.archiveAttachment.mockReturnValue(archivedMutation.promise);
    renderDialog();
    const row = await screen.findByRole('listitem', { name: 'active-1.png' });
    expect(screen.getByText('21 attachments found')).toHaveAttribute('aria-live', 'polite');

    fireEvent.click(within(row).getByRole('button', { name: 'Archive active-1.png' }));

    const competingRow = screen.getByRole('listitem', { name: 'active-2.png' });
    const initialLockSnapshot = {
      insert: (within(competingRow).getByRole('button', { name: 'Insert active-2.png' }) as HTMLButtonElement).disabled,
      mutation: (within(competingRow).getByRole('button', { name: 'Archive active-2.png' }) as HTMLButtonElement).disabled,
      upload: (screen.getByLabelText('Upload image') as HTMLInputElement).disabled,
      loadMore: (screen.getByRole('button', { name: 'Load more' }) as HTMLButtonElement).disabled,
    };
    await act(async () => archivedMutation.resolve(attachment({ id: 'active-1', displayName: 'active-1.png', status: 'archived' })));
    await waitFor(() => expect(mocks.listAttachments).toHaveBeenCalledTimes(2));
    const reconciliationLockSnapshot = {
      search: (screen.getByRole('searchbox', { name: 'Search attachments' }) as HTMLInputElement).disabled,
      status: (screen.getByRole('combobox', { name: 'Attachment status' }) as HTMLSelectElement).disabled,
      upload: (screen.getByLabelText('Upload image') as HTMLInputElement).disabled,
      close: (screen.getByRole('button', { name: 'Close attachment picker' }) as HTMLButtonElement).disabled,
    };
    await act(async () => reconciliation.resolve({ items: shiftedPage, total: 20, skip: 0, take: 20 }));
    expect(initialLockSnapshot).toEqual({ insert: true, mutation: true, upload: true, loadMore: true });
    expect(reconciliationLockSnapshot).toEqual({ search: true, status: true, upload: true, close: true });
    expect(await screen.findByRole('listitem', { name: 'active-21.png' })).toBeInTheDocument();
    expect(screen.queryByRole('listitem', { name: 'active-1.png' })).not.toBeInTheDocument();
    expect(mocks.listAttachments).toHaveBeenLastCalledWith('space-1', expect.objectContaining({ status: 'active', skip: 0, take: 20 }), expect.any(AbortSignal));
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('synchronously rejects a second restore while the first restore is pending', async () => {
    const first = attachment({ id: 'old-a', displayName: 'old-a.png', status: 'archived' });
    const second = attachment({ id: 'old-b', displayName: 'old-b.png', status: 'archived' });
    const restore = deferred<ReturnType<typeof attachment>>();
    mocks.listAttachments.mockImplementation(async (_spaceId: string, params: { status: string }) => ({
      items: params.status === 'archived' ? [first, second] : [],
      total: params.status === 'archived' ? 2 : 0,
      skip: 0,
      take: 20,
    }));
    mocks.restoreAttachment.mockReturnValue(restore.promise);
    renderDialog();
    await waitFor(() => expect(mocks.listAttachments).toHaveBeenCalled());
    fireEvent.change(screen.getByRole('combobox', { name: 'Attachment status' }), { target: { value: 'archived' } });
    const firstButton = within(await screen.findByRole('listitem', { name: 'old-a.png' })).getByRole('button', { name: 'Restore old-a.png' });
    const secondButton = within(screen.getByRole('listitem', { name: 'old-b.png' })).getByRole('button', { name: 'Restore old-b.png' });

    act(() => {
      fireEvent.click(firstButton);
      fireEvent.click(secondButton);
    });
    const callCount = mocks.restoreAttachment.mock.calls.length;
    await act(async () => restore.resolve(attachment({ id: 'old-a', displayName: 'old-a.png', status: 'active' })));

    expect(callCount).toBe(1);
  });

  it('synchronously rejects upload while a restore is pending', async () => {
    const archived = attachment({ id: 'old', displayName: 'old.png', status: 'archived' });
    const restore = deferred<ReturnType<typeof attachment>>();
    mocks.listAttachments.mockImplementation(async (_spaceId: string, params: { status: string }) => ({
      items: params.status === 'archived' ? [archived] : [],
      total: params.status === 'archived' ? 1 : 0,
      skip: 0,
      take: 20,
    }));
    mocks.restoreAttachment.mockReturnValue(restore.promise);
    mocks.uploadAttachment.mockResolvedValue(attachment({ id: 'uploaded', displayName: 'new.png' }));
    renderDialog();
    await waitFor(() => expect(mocks.listAttachments).toHaveBeenCalled());
    fireEvent.change(screen.getByRole('combobox', { name: 'Attachment status' }), { target: { value: 'archived' } });
    const restoreButton = within(await screen.findByRole('listitem', { name: 'old.png' })).getByRole('button', { name: 'Restore old.png' });
    const input = screen.getByLabelText('Upload image');

    act(() => {
      fireEvent.click(restoreButton);
      fireEvent.change(input, { target: { files: [new File(['png'], 'new.png', { type: 'image/png' })] } });
    });
    const uploadCount = mocks.uploadAttachment.mock.calls.length;
    await act(async () => restore.resolve(attachment({ id: 'old', displayName: 'old.png', status: 'active' })));

    expect(uploadCount).toBe(0);
  });

  it('uploads only accepted images, announces progress, confirms and inserts the final suffixed server name', async () => {
    const upload = deferred<ReturnType<typeof attachment>>();
    mocks.uploadAttachment.mockImplementation((_spaceId: string, _file: File, options: { onProgress: (value: number) => void }) => {
      options.onProgress(42);
      return upload.promise;
    });
    const { onInsert } = renderDialog();
    await screen.findByText('diagram.png');
    const input = screen.getByLabelText('Upload image') as HTMLInputElement;
    expect(input.accept).toBe('.png,.jpg,.jpeg,.webp,.gif');
    fireEvent.change(input, { target: { files: [new File(['png'], 'diagram.png', { type: 'image/png' })] } });

    expect(await screen.findByRole('status')).toHaveTextContent('Uploading 42%');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    await act(async () => upload.resolve(attachment({ id: 'uploaded', displayName: 'diagram (2).png' })));
    await waitFor(() => expect(onInsert).toHaveBeenCalledWith('diagram (2).png'));
    expect(screen.getByText('Uploaded as diagram (2).png')).toHaveAttribute('aria-live', 'polite');
  });

  it('reloads the current archived search after upload instead of exposing the nonmatching active result', async () => {
    const archived = attachment({ id: 'old', displayName: 'old.png', status: 'archived' });
    mocks.listAttachments.mockImplementation(async (_spaceId: string, params: { q?: string; status: string; skip: number; take: number }) => ({
      items: params.status === 'archived' && params.q === 'old' ? [archived] : [],
      total: params.status === 'archived' && params.q === 'old' ? 1 : 0,
      skip: params.skip,
      take: params.take,
    }));
    mocks.uploadAttachment.mockResolvedValue(attachment({ id: 'uploaded', displayName: 'new (2).png' }));
    const { onInsert } = renderDialog();
    await waitFor(() => expect(mocks.listAttachments).toHaveBeenCalled());
    fireEvent.change(screen.getByRole('combobox', { name: 'Attachment status' }), { target: { value: 'archived' } });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search attachments' }), { target: { value: 'old' } });
    await screen.findByRole('listitem', { name: 'old.png' });
    const callsBeforeUpload = mocks.listAttachments.mock.calls.length;

    fireEvent.change(screen.getByLabelText('Upload image'), { target: { files: [new File(['png'], 'new.png', { type: 'image/png' })] } });

    await waitFor(() => expect(onInsert).toHaveBeenCalledWith('new (2).png'));
    await waitFor(() => expect(mocks.listAttachments.mock.calls.length).toBeGreaterThan(callsBeforeUpload));
    expect(mocks.listAttachments).toHaveBeenLastCalledWith('space-1', expect.objectContaining({ q: 'old', status: 'archived', skip: 0 }), expect.any(AbortSignal));
    expect(screen.queryByRole('listitem', { name: 'new (2).png' })).not.toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'old.png' })).toBeInTheDocument();
  });

  it.each([
    ['failed replacement search', () => fireEvent.change(screen.getByRole('searchbox', { name: 'Search attachments' }), { target: { value: 'broken' } })],
    ['failed replacement status filter', () => fireEvent.change(screen.getByRole('combobox', { name: 'Attachment status' }), { target: { value: 'archived' } })],
  ])('hides prior actionable results after a %s', async (_name, changeCriteria) => {
    mocks.listAttachments
      .mockResolvedValueOnce({ items: [attachment()], total: 1, skip: 0, take: 20 })
      .mockRejectedValueOnce(new Error('replacement failed'));
    renderDialog();
    await screen.findByRole('listitem', { name: 'diagram.png' });

    changeCriteria();

    expect(await screen.findByRole('alert')).toHaveTextContent('Network connection failed');
    expect(screen.queryByRole('listitem', { name: 'diagram.png' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Insert diagram.png' })).not.toBeInTheDocument();
  });

  it('uses current timestamps for archive and surfaces mutation failures without insertion or optimistic state', async () => {
    mocks.archiveAttachment.mockRejectedValue({ response: { status: 409, data: { code: 'RESOURCE_CONFLICT' } } });
    const { onInsert } = renderDialog();
    const row = await screen.findByRole('listitem', { name: 'diagram.png' });
    fireEvent.click(within(row).getByRole('button', { name: 'Archive diagram.png' }));
    expect(mocks.archiveAttachment).toHaveBeenCalledWith('space-1', 'attachment-1', '2026-08-27T01:01:00Z');
    expect(await screen.findByRole('alert')).toHaveTextContent('This attachment changed or the Space attachment quota was exceeded.');
    expect(within(row).getByRole('button', { name: 'Insert diagram.png' })).toBeInTheDocument();
    expect(onInsert).not.toHaveBeenCalled();
  });

  it.each([
    [{ response: { status: 403, data: { code: 'SPACE_ACCESS_DENIED' } } }, 'You do not have permission to perform this action.'],
    [{ response: { status: 400, data: {} } }, 'The selected image is not valid or exceeds an attachment limit.'],
  ])('announces permission and validation failures without changing the row', async (failure, expected) => {
    mocks.archiveAttachment.mockRejectedValue(failure);
    renderDialog();
    const row = await screen.findByRole('listitem', { name: 'diagram.png' });

    fireEvent.click(within(row).getByRole('button', { name: 'Archive diagram.png' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    expect(within(row).getByRole('button', { name: 'Insert diagram.png' })).toBeInTheDocument();
  });

  it('prevents duplicate upload submissions and does not insert after a failed upload', async () => {
    const upload = deferred<ReturnType<typeof attachment>>();
    mocks.uploadAttachment.mockReturnValue(upload.promise);
    const { onInsert } = renderDialog();
    await screen.findByText('diagram.png');
    const input = screen.getByLabelText('Upload image') as HTMLInputElement;
    const file = new File(['png'], 'new.png', { type: 'image/png' });
    act(() => {
      fireEvent.change(input, { target: { files: [file] } });
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(mocks.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('searchbox', { name: 'Search attachments' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Attachment status' })).toBeDisabled();
    await act(async () => upload.resolve(Promise.reject(new Error('network')) as never));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network connection failed');
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('prevents a batched duplicate archive submission before React disables the row', async () => {
    const archived = deferred<ReturnType<typeof attachment>>();
    mocks.archiveAttachment.mockReturnValue(archived.promise);
    renderDialog();
    const button = within(await screen.findByRole('listitem', { name: 'diagram.png' }))
      .getByRole('button', { name: 'Archive diagram.png' });

    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(mocks.archiveAttachment).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('searchbox', { name: 'Search attachments' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Attachment status' })).toBeDisabled();
    await act(async () => archived.resolve(attachment({ status: 'archived' })));
  });

  it('inherits focus trap, Escape and focus restoration from ModalDialog', async () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    opener.textContent = 'Open attachments';
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<LanguageProvider><AttachmentPickerDialog spaceId="space-1" onClose={onClose} onInsert={vi.fn()} /></LanguageProvider>);
    expect(screen.getByRole('searchbox', { name: 'Search attachments' })).toHaveFocus();
    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close attachment picker' });
    close.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(screen.getByLabelText('Upload image')).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  });

  it('aborts a pending list and ignores its completion after close', async () => {
    const pending = deferred<{ items: ReturnType<typeof attachment>[]; total: number; skip: number; take: number }>();
    mocks.listAttachments.mockReturnValue(pending.promise);
    const { onClose } = renderDialog();
    await waitFor(() => expect(mocks.listAttachments).toHaveBeenCalledTimes(1));
    const signal = mocks.listAttachments.mock.calls[0][2] as AbortSignal;

    fireEvent.click(screen.getByRole('button', { name: 'Close attachment picker' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve({ items: [attachment({ displayName: 'late.png' })], total: 1, skip: 0, take: 20 }));
    expect(screen.queryByText('late.png')).not.toBeInTheDocument();
  });

  it('remains live after the development StrictMode effect cleanup replay', async () => {
    const onInsert = vi.fn();
    render(<StrictMode><LanguageProvider><AttachmentPickerDialog spaceId="space-1" onClose={vi.fn()} onInsert={onInsert} /></LanguageProvider></StrictMode>);

    const row = await screen.findByRole('listitem', { name: 'diagram.png' });
    fireEvent.click(within(row).getByRole('button', { name: 'Insert diagram.png' }));

    expect(onInsert).toHaveBeenCalledWith('diagram.png');
  });
});
