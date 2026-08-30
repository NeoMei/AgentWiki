import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { ModalDialog } from '../../components/ModalDialog';
import { getDeleteImpact } from './contentTreeApi';
import type { DeleteImpactResponse } from './contentTreeTypes';

export interface FolderDeleteDialogProps {
  spaceId: string;
  folderId: string;
  folderName: string;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  onConfirm: (impact: DeleteImpactResponse) => Promise<void>;
}

export const FolderDeleteDialog: React.FC<FolderDeleteDialogProps> = ({
  spaceId,
  folderId,
  folderName,
  returnFocusTo,
  onClose,
  onConfirm,
}) => {
  const { t } = useLanguage();
  const [impact, setImpact] = useState<DeleteImpactResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionActiveRef = useRef(true);

  useEffect(() => {
    sessionActiveRef.current = true;
    const controller = new AbortController();
    getDeleteImpact(spaceId, folderId, controller.signal)
      .then((value) => {
        if (sessionActiveRef.current && !controller.signal.aborted) setImpact(value);
      })
      .catch((err) => {
        if (sessionActiveRef.current && !controller.signal.aborted) {
          setLoadError(errorMessage(err, t('folder.deleteImpactFailed')));
        }
      });
    return () => {
      sessionActiveRef.current = false;
      controller.abort();
    };
  }, [spaceId, folderId]);

  const confirm = async () => {
    if (!impact || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(impact);
      if (sessionActiveRef.current) onClose();
    } catch (err) {
      if (sessionActiveRef.current) {
        setError(errorMessage(err, t('folder.deleteFailed')));
        setSubmitting(false);
      }
    }
  };

  return (
    <ModalDialog
      labelledBy="folder-delete-dialog-title"
      onRequestClose={() => { if (!submitting) onClose(); }}
      closeDisabled={submitting}
      returnFocusTo={returnFocusTo}
      className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-[14px] bg-white shadow-xl"
    >
      <div className="p-6" data-testid="folder-delete-dialog">
        <div className="flex items-center justify-between">
          <h2 id="folder-delete-dialog-title" className="text-xl font-semibold text-gray-900">
            {t('folder.deleteTitle')}
          </h2>
          <button
            type="button"
            onClick={() => { if (!submitting) onClose(); }}
            aria-label={t('common.cancel')}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>
        {loadError ? (
          <p className="mt-4 text-sm text-red-600" data-testid="folder-delete-load-error">{loadError}</p>
        ) : impact ? (
          <div className="mt-4 text-sm text-gray-600">
            <p data-testid="folder-delete-impact">
            {t('folder.deleteImpact', {
              name: folderName,
              folders: Math.max(0, impact.folderCount - 1),
              pages: impact.pageCount,
            })}
            </p>
            <p className="mt-2 text-gray-500">{t('folder.deleteRecoverable')}</p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-500">{t('common.loading')}</p>
        )}
        {error ? (
          <p className="mt-2 text-sm text-red-600" data-testid="folder-delete-error">{error}</p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!impact || submitting}
            onClick={confirm}
            data-testid="folder-delete-confirm"
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('folder.delete')}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
};

const errorMessage = (err: unknown, fallback: string): string => {
  const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof message === 'string' && message ? message : fallback;
};
