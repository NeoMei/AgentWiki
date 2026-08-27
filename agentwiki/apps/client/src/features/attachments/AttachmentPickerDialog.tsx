import React, { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { apiErrorCode, apiErrorMessage } from '../../api/error-message';
import { ModalDialog } from '../../components/ModalDialog';
import { useLanguage } from '../../context/LanguageContext';
import {
  archiveAttachment,
  listAttachments,
  restoreAttachment,
  uploadAttachment,
} from './attachmentApi';
import type { AttachmentListStatus, AttachmentSummary } from './attachmentTypes';

const PAGE_SIZE = 20;
const ACCEPTED_IMAGES = '.png,.jpg,.jpeg,.webp,.gif';

export interface AttachmentPickerDialogProps {
  spaceId: string;
  onClose: () => void;
  onInsert: (displayName: string) => void;
  returnFocusTo?: HTMLElement | null;
}

export const AttachmentPickerDialog: React.FC<AttachmentPickerDialogProps> = ({
  spaceId,
  onClose,
  onInsert,
  returnFocusTo,
}) => {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AttachmentListStatus>('active');
  const [items, setItems] = useState<AttachmentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [nextSkip, setNextSkip] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const uploadingRef = useRef(false);
  const busyIdsRef = useRef<Set<string>>(new Set());
  const aliveRef = useRef(true);
  const listSequenceRef = useRef(0);
  const listAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      listAbortRef.current?.abort();
    };
  }, []);

  const translatedError = useCallback((caught: unknown, fallbackKey: string) => {
    const code = apiErrorCode(caught);
    if (code === 'RESOURCE_CONFLICT') return t('attachment.conflict');
    const statusCode = (caught as { response?: { status?: number } })?.response?.status;
    if (statusCode === 400) return t('attachment.validationFailed');
    return apiErrorMessage(caught, t, fallbackKey);
  }, [t]);

  const load = useCallback(async (skip: number, append: boolean) => {
    const sequence = ++listSequenceRef.current;
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await listAttachments(spaceId, {
        q: query.trim() || undefined,
        status,
        skip,
        take: PAGE_SIZE,
      }, controller.signal);
      if (!aliveRef.current || controller.signal.aborted || sequence !== listSequenceRef.current) return;
      setItems((current) => append ? [...current, ...result.items] : result.items);
      setTotal(result.total);
      setNextSkip(result.skip + result.take);
      setAnnouncement(t('attachment.loaded', { count: result.total }));
    } catch (caught) {
      if (!aliveRef.current || controller.signal.aborted || sequence !== listSequenceRef.current) return;
      const message = translatedError(caught, 'attachment.loadFailed');
      setError(message);
      setAnnouncement(message);
    } finally {
      if (aliveRef.current && sequence === listSequenceRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [query, spaceId, status, t, translatedError]);

  useEffect(() => {
    void load(0, false);
    return () => listAbortRef.current?.abort();
  }, [load]);

  const replaceItem = (next: AttachmentSummary) => {
    setItems((current) => current.map((item) => item.id === next.id ? next : item));
  };

  const mutate = async (item: AttachmentSummary, action: 'archive' | 'restore') => {
    if (busyIdsRef.current.has(item.id)) return;
    busyIdsRef.current.add(item.id);
    setBusyIds(new Set(busyIdsRef.current));
    setError(null);
    try {
      const next = action === 'archive'
        ? await archiveAttachment(spaceId, item.id, item.updatedAt)
        : await restoreAttachment(spaceId, item.id, item.updatedAt);
      if (!aliveRef.current) return;
      replaceItem(next);
      const message = t(action === 'archive' ? 'attachment.archived' : 'attachment.restored', { name: next.displayName });
      setAnnouncement(message);
    } catch (caught) {
      if (!aliveRef.current) return;
      const message = translatedError(caught, action === 'archive' ? 'attachment.archiveFailed' : 'attachment.restoreFailed');
      setError(message);
      setAnnouncement(message);
    } finally {
      busyIdsRef.current.delete(item.id);
      if (aliveRef.current) setBusyIds(new Set(busyIdsRef.current));
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    setUploadProgress(0);
    setError(null);
    try {
      const uploaded = await uploadAttachment(spaceId, file, {
        onProgress: (progress) => {
          if (!aliveRef.current) return;
          setUploadProgress(progress);
          setAnnouncement(t('attachment.uploading', { progress }));
        },
      });
      if (!aliveRef.current) return;
      const message = t('attachment.uploadedAs', { name: uploaded.displayName });
      // Make a suffixed authoritative name visible to assistive tech before the
      // consumer may close the picker in response to insertion.
      flushSync(() => {
        setItems((current) => [uploaded, ...current.filter((item) => item.id !== uploaded.id)]);
        setAnnouncement(message);
        setUploadProgress(null);
      });
      onInsert(uploaded.displayName);
    } catch (caught) {
      if (!aliveRef.current) return;
      const message = translatedError(caught, 'attachment.uploadFailed');
      setError(message);
      setAnnouncement(message);
      setUploadProgress(null);
    } finally {
      uploadingRef.current = false;
      if (aliveRef.current) setUploading(false);
    }
  };

  const requestClose = () => {
    aliveRef.current = false;
    listAbortRef.current?.abort();
    onClose();
  };

  return <ModalDialog labelledBy="attachment-picker-title" onRequestClose={requestClose} closeDisabled={uploading || busyIds.size > 0} returnFocusTo={returnFocusTo} className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 id="attachment-picker-title" className="text-lg font-semibold">{t('attachment.title')}</h2>
        <p className="mt-1 text-sm text-gray-600">{t('attachment.description')}</p>
      </div>
      <button type="button" aria-label={t('attachment.close')} onClick={requestClose} disabled={uploading || busyIds.size > 0} className="min-h-10 rounded-lg border px-3 disabled:opacity-50">{t('common.close')}</button>
    </div>

    <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
      <label className="text-sm font-medium">{t('attachment.search')}
        <input data-modal-autofocus type="search" aria-label={t('attachment.search')} value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3" />
      </label>
      <label className="text-sm font-medium">{t('attachment.status')}
        <select aria-label={t('attachment.status')} value={status} onChange={(event) => setStatus(event.target.value as AttachmentListStatus)} className="mt-1 h-10 w-full rounded-lg border px-3">
          <option value="active">{t('attachment.statusActive')}</option>
          <option value="archived">{t('attachment.statusArchived')}</option>
          <option value="all">{t('attachment.statusAll')}</option>
        </select>
      </label>
    </div>

    <label className="mt-4 flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-dashed px-4 text-sm font-medium">
      {t('attachment.upload')}
      <input type="file" accept={ACCEPTED_IMAGES} aria-label={t('attachment.upload')} disabled={uploading} onChange={(event) => void handleUpload(event)} className="sr-only" />
    </label>

    {uploadProgress !== null ? <p aria-live="polite" role="status" className="mt-2 text-sm text-blue-700">{t('attachment.uploading', { progress: uploadProgress })}</p> : null}
    <p aria-live="polite" className="sr-only">{announcement}</p>
    {error ? <p role="alert" aria-live="assertive" className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

    {loading ? <p role="status" aria-live="polite" className="mt-5 text-sm text-gray-500">{t('common.loading')}</p> : items.length ? <ul className="mt-5 space-y-2">
      {items.map((item) => {
        const busy = busyIds.has(item.id);
        return <li key={item.id} aria-label={item.displayName} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{item.displayName}</p>
            <p className="text-xs text-gray-500">{t(item.status === 'active' ? 'attachment.statusActive' : 'attachment.statusArchived')}</p>
          </div>
          {item.status === 'active' ? <button type="button" disabled={busy || uploading} aria-label={t('attachment.insertNamed', { name: item.displayName })} onClick={() => onInsert(item.displayName)} className="min-h-10 rounded-lg bg-blue-600 px-3 text-sm text-white disabled:opacity-50">{t('attachment.insert')}</button> : null}
          <button type="button" disabled={busy || uploading} aria-label={t(item.status === 'active' ? 'attachment.archiveNamed' : 'attachment.restoreNamed', { name: item.displayName })} onClick={() => void mutate(item, item.status === 'active' ? 'archive' : 'restore')} className="min-h-10 rounded-lg border px-3 text-sm disabled:opacity-50">{busy ? t('common.loading') : t(item.status === 'active' ? 'attachment.archive' : 'attachment.restore')}</button>
        </li>;
      })}
    </ul> : <p className="mt-5 text-sm text-gray-500">{t('attachment.empty')}</p>}

    {items.length < total ? <button type="button" disabled={loadingMore} onClick={() => void load(nextSkip, true)} className="mt-4 min-h-10 rounded-lg border px-4 text-sm disabled:opacity-50">{loadingMore ? t('common.loading') : t('attachment.loadMore')}</button> : null}
  </ModalDialog>;
};
