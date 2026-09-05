import React, { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { apiErrorCode, apiErrorMessage } from '../../api/error-message';
import { ModalDialog } from '../../components/ModalDialog';
import { useLanguage } from '../../context/LanguageContext';
import {
  archiveAttachment,
  listAttachments,
  previewAttachmentRename,
  renameAttachment,
  restoreAttachment,
  uploadAttachment,
} from './attachmentApi';
import type {
  AttachmentListStatus,
  AttachmentRenamePreview,
  AttachmentSummary,
} from './attachmentTypes';

const PAGE_SIZE = 20;
const ACCEPTED_IMAGES = '.png,.jpg,.jpeg,.webp,.gif';

export interface AttachmentPickerDialogProps {
  spaceId: string;
  onClose: () => void;
  onInsert: (canonicalPath: string) => void;
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
  const [renameItem, setRenameItem] = useState<AttachmentSummary | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renamePreview, setRenamePreview] = useState<AttachmentRenamePreview | null>(null);
  const uploadingRef = useRef(false);
  const operationRef = useRef(false);
  const busyIdsRef = useRef<Set<string>>(new Set());
  const aliveRef = useRef(true);
  const listSequenceRef = useRef(0);
  const listAbortRef = useRef<AbortController | null>(null);
  const skipNextEffectLoadRef = useRef(false);
  const renameTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      listAbortRef.current?.abort();
    };
  }, []);

  const translatedError = useCallback((caught: unknown, fallbackKey: string) => {
    const code = apiErrorCode(caught);
    if (code === 'CONTENT_TREE_CONFLICT') return t('attachment.renameStale');
    if (code === 'ATTACHMENT_NAME_CONFLICT') return t('attachment.renameConflict');
    if (code === 'ATTACHMENT_REFERENCED') {
      const rawPages = (caught as { response?: { data?: { details?: { pages?: unknown } } } })
        ?.response?.data?.details?.pages;
      const pagesById = new Map<string, string>();
      if (Array.isArray(rawPages)) for (const page of rawPages) {
        if (page && typeof page === 'object' && typeof (page as { id?: unknown }).id === 'string'
          && typeof (page as { title?: unknown }).title === 'string'
          && !pagesById.has((page as { id: string }).id)) {
          pagesById.set((page as { id: string }).id, (page as { title: string }).title);
        }
      }
      const titles = [...pagesById.values()];
      return titles.length > 0
        ? t('attachment.referencedBy', { pages: titles.join(', ') })
        : t('attachment.archiveFailed');
    }
    if (code === 'RESOURCE_CONFLICT') return t('attachment.conflict');
    const statusCode = (caught as { response?: { status?: number } })?.response?.status;
    if (statusCode === 400) return t('attachment.validationFailed');
    return apiErrorMessage(caught, t, fallbackKey);
  }, [t]);

  const load = useCallback(async (
    skip: number,
    append: boolean,
    successAnnouncement?: string,
    criteria?: { query: string; status: AttachmentListStatus },
  ) => {
    const sequence = ++listSequenceRef.current;
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    const replacementAnnouncement = append ? null : successAnnouncement ?? null;
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setError(null);
      // A replacement request belongs to different criteria or follows an
      // authoritative mutation. Never leave the previous actionable rows
      // visible while that request is pending or after it fails.
      setItems([]);
      setTotal(0);
      setNextSkip(PAGE_SIZE);
    }
    try {
      const result = await listAttachments(spaceId, {
        q: (criteria?.query ?? query).trim() || undefined,
        status: criteria?.status ?? status,
        skip,
        take: PAGE_SIZE,
      }, controller.signal);
      if (!aliveRef.current || controller.signal.aborted || sequence !== listSequenceRef.current) return;
      setItems((current) => append ? [...current, ...result.items] : result.items);
      setTotal(result.total);
      setNextSkip(result.skip + result.take);
      setAnnouncement(replacementAnnouncement ?? t('attachment.loaded', { count: result.total }));
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
    if (skipNextEffectLoadRef.current) {
      skipNextEffectLoadRef.current = false;
      return;
    }
    void load(0, false);
  }, [load]);

  const mutate = async (item: AttachmentSummary, action: 'archive' | 'restore') => {
    if (operationRef.current) return;
    operationRef.current = true;
    busyIdsRef.current.add(item.id);
    setBusyIds(new Set(busyIdsRef.current));
    setError(null);
    try {
      const next = action === 'archive'
        ? await archiveAttachment(spaceId, item.id, item.updatedAt)
        : await restoreAttachment(spaceId, item.id, item.updatedAt);
      if (!aliveRef.current) return;
      const message = t(action === 'archive' ? 'attachment.archived' : 'attachment.restored', { name: next.displayName });
      setAnnouncement(message);
      if (action === 'restore' && status === 'archived') {
        // Restored files do not belong in the archived result set. Switch to
        // the authoritative active view so insertion is offered only after a
        // successful restore and a filter-truthful reload.
        skipNextEffectLoadRef.current = true;
        setStatus('active');
        await load(0, false, message, { query, status: 'active' });
      } else {
        await load(0, false, message);
      }
    } catch (caught) {
      if (!aliveRef.current) return;
      const message = translatedError(caught, action === 'archive' ? 'attachment.archiveFailed' : 'attachment.restoreFailed');
      setError(message);
      setAnnouncement(message);
    } finally {
      operationRef.current = false;
      busyIdsRef.current.delete(item.id);
      if (aliveRef.current) setBusyIds(new Set(busyIdsRef.current));
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || operationRef.current || uploadingRef.current) return;
    operationRef.current = true;
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
        setAnnouncement(message);
        setUploadProgress(null);
      });
      const reconciliation = load(0, false, message);
      if (!uploaded.referenceable || uploaded.canonicalPath === null) {
        throw new Error('Uploaded attachment is not referenceable');
      }
      onInsert(uploaded.canonicalPath);
      await reconciliation;
    } catch (caught) {
      if (!aliveRef.current) return;
      const message = translatedError(caught, 'attachment.uploadFailed');
      setError(message);
      setAnnouncement(message);
      setUploadProgress(null);
    } finally {
      operationRef.current = false;
      uploadingRef.current = false;
      if (aliveRef.current) setUploading(false);
    }
  };

  const startRename = (item: AttachmentSummary, trigger: HTMLButtonElement) => {
    if (operationRef.current) return;
    renameTriggerRef.current = trigger;
    setError(null);
    setRenameItem(item);
    setRenameName(item.displayName);
    setRenamePreview(null);
  };

  const cancelRename = () => {
    if (operationRef.current) return;
    flushSync(() => {
      setRenameItem(null);
      setRenamePreview(null);
    });
    renameTriggerRef.current?.focus();
  };

  const runRenamePreview = async () => {
    if (!renameItem || operationRef.current) return;
    operationRef.current = true;
    setError(null);
    try {
      const preview = await previewAttachmentRename(spaceId, renameItem.id, renameName);
      if (!aliveRef.current) return;
      setRenamePreview(preview);
      setAnnouncement(t('attachment.renamePreviewReady', { count: preview.impactedPages.length }));
    } catch (caught) {
      if (!aliveRef.current) return;
      const message = translatedError(caught, 'attachment.renameFailed');
      setError(message);
      setAnnouncement(message);
    } finally {
      operationRef.current = false;
    }
  };

  const confirmRename = async () => {
    if (!renameItem || !renamePreview || operationRef.current) return;
    operationRef.current = true;
    busyIdsRef.current.add(renameItem.id);
    setBusyIds(new Set(busyIdsRef.current));
    setError(null);
    try {
      const renamed = await renameAttachment(spaceId, renameItem.id, {
        previewToken: renamePreview.previewToken,
      });
      if (!aliveRef.current) return;
      const message = t('attachment.renamed', { name: renamed.displayName });
      setAnnouncement(message);
      setRenameItem(null);
      setRenamePreview(null);
      await load(0, false, message);
    } catch (caught) {
      if (!aliveRef.current) return;
      const message = translatedError(caught, 'attachment.renameFailed');
      setError(message);
      setAnnouncement(message);
      setRenamePreview(null);
    } finally {
      operationRef.current = false;
      busyIdsRef.current.delete(renameItem.id);
      if (aliveRef.current) setBusyIds(new Set(busyIdsRef.current));
    }
  };

  const requestClose = () => {
    if (operationRef.current) return;
    aliveRef.current = false;
    listAbortRef.current?.abort();
    onClose();
  };

  const criteriaLocked = uploading || busyIds.size > 0;
  const insertExisting = (item: AttachmentSummary) => {
    if (!operationRef.current && item.referenceable && item.canonicalPath !== null) {
      onInsert(item.canonicalPath);
    }
  };

  return <ModalDialog labelledBy="attachment-picker-title" onRequestClose={requestClose} closeDisabled={criteriaLocked} returnFocusTo={returnFocusTo} className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 id="attachment-picker-title" className="text-lg font-semibold">{t('attachment.title')}</h2>
        <p className="mt-1 text-sm text-gray-600">{t('attachment.description')}</p>
      </div>
      <button type="button" aria-label={t('attachment.close')} onClick={requestClose} disabled={criteriaLocked} className="min-h-10 rounded-lg border px-3 disabled:opacity-50">{t('common.close')}</button>
    </div>

    <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
      <label className="text-sm font-medium">{t('attachment.search')}
        <input data-modal-autofocus type="search" aria-label={t('attachment.search')} value={query} disabled={criteriaLocked} onChange={(event) => {
          if (!operationRef.current) setQuery(event.target.value);
        }} className="mt-1 h-10 w-full rounded-lg border px-3 disabled:opacity-50" />
      </label>
      <label className="text-sm font-medium">{t('attachment.status')}
        <select aria-label={t('attachment.status')} value={status} disabled={criteriaLocked} onChange={(event) => {
          if (!operationRef.current) setStatus(event.target.value as AttachmentListStatus);
        }} className="mt-1 h-10 w-full rounded-lg border px-3 disabled:opacity-50">
          <option value="active">{t('attachment.statusActive')}</option>
          <option value="archived">{t('attachment.statusArchived')}</option>
          <option value="all">{t('attachment.statusAll')}</option>
        </select>
      </label>
    </div>

    <label className="mt-4 flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-dashed px-4 text-sm font-medium">
      {t('attachment.upload')}
      <input type="file" accept={ACCEPTED_IMAGES} aria-label={t('attachment.upload')} disabled={criteriaLocked} onChange={(event) => void handleUpload(event)} className="sr-only" />
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
            {item.status === 'active' && !item.referenceable ? <p className="text-xs text-amber-700">{t('attachment.renameBeforeInsert')}</p> : null}
          </div>
          {item.status === 'active' ? <button type="button" disabled={criteriaLocked || !item.referenceable || item.canonicalPath === null} aria-label={t('attachment.insertNamed', { name: item.displayName })} onClick={() => insertExisting(item)} className="min-h-10 rounded-lg bg-blue-600 px-3 text-sm text-white disabled:opacity-50">{t('attachment.insert')}</button> : null}
          {item.status === 'active' ? <button type="button" disabled={criteriaLocked} aria-label={t('attachment.renameNamed', { name: item.displayName })} onClick={(event) => startRename(item, event.currentTarget)} className="min-h-10 rounded-lg border px-3 text-sm disabled:opacity-50">{t('attachment.rename')}</button> : null}
          <button type="button" disabled={criteriaLocked} aria-label={t(item.status === 'active' ? 'attachment.archiveNamed' : 'attachment.restoreNamed', { name: item.displayName })} onClick={() => void mutate(item, item.status === 'active' ? 'archive' : 'restore')} className="min-h-10 rounded-lg border px-3 text-sm disabled:opacity-50">{busy ? t('common.loading') : t(item.status === 'active' ? 'attachment.archive' : 'attachment.restore')}</button>
          {renameItem?.id === item.id ? <div className="w-full rounded-lg bg-gray-50 p-3" onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              cancelRename();
            }
          }}>
            <label className="text-sm font-medium">{t('attachment.newName')}
              <input autoFocus type="text" aria-label={t('attachment.newName')} value={renameName} disabled={busy} onChange={(event) => {
                setRenameName(event.target.value);
                setRenamePreview(null);
              }} className="mt-1 h-10 w-full rounded-lg border px-3" />
            </label>
            {renamePreview ? <div className="mt-2 text-sm">
              <p>{renamePreview.path}</p>
              <p>{t('attachment.impactedPages')}</p>
              {renamePreview.impactedPages.length > 0 ? <ul>{renamePreview.impactedPages.map((page) => <li key={page.id}>{page.title}</li>)}</ul> : <p>{t('attachment.noImpactedPages')}</p>}
            </div> : null}
            <div className="mt-3 flex gap-2">
              {renamePreview ? <button type="button" disabled={busy} onClick={() => void confirmRename()} className="min-h-10 rounded-lg bg-blue-600 px-3 text-sm text-white">{t('attachment.confirmRename')}</button>
                : <button type="button" disabled={busy || renameName.trim().length === 0} onClick={() => void runRenamePreview()} className="min-h-10 rounded-lg bg-blue-600 px-3 text-sm text-white">{t('attachment.previewRename')}</button>}
              <button type="button" disabled={busy} onClick={cancelRename} className="min-h-10 rounded-lg border px-3 text-sm">{t('common.cancel')}</button>
            </div>
          </div> : null}
        </li>;
      })}
    </ul> : <p className="mt-5 text-sm text-gray-500">{t('attachment.empty')}</p>}

    {items.length < total ? <button type="button" disabled={loadingMore || criteriaLocked} onClick={() => {
      if (!operationRef.current) void load(nextSkip, true);
    }} className="mt-4 min-h-10 rounded-lg border px-4 text-sm disabled:opacity-50">{loadingMore ? t('common.loading') : t('attachment.loadMore')}</button> : null}
  </ModalDialog>;
};
