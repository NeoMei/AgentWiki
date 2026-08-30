import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { ModalDialog } from '../../components/ModalDialog';

export interface FolderDialogProps {
  mode: 'create' | 'rename';
  initialName?: string;
  submitDisabled?: boolean;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}

const FOLDER_NAME_LIMIT = 200;

export const FolderDialog: React.FC<FolderDialogProps> = ({
  mode,
  initialName = '',
  submitDisabled = false,
  returnFocusTo,
  onClose,
  onSubmit,
}) => {
  const { t } = useLanguage();
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionActiveRef = useRef(true);

  useEffect(() => {
    sessionActiveRef.current = true;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      sessionActiveRef.current = false;
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || submitting || submitDisabled) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(truncateFolderName(trimmed));
      if (sessionActiveRef.current) onClose();
    } catch (err) {
      if (sessionActiveRef.current) {
        setError(errorMessage(err, t('folder.saveFailed')));
        setSubmitting(false);
      }
    }
  };

  return (
    <ModalDialog
      labelledBy={mode === 'create' ? 'folder-dialog-title' : 'folder-dialog-title'}
      onRequestClose={() => { if (!submitting) onClose(); }}
      closeDisabled={submitting}
      returnFocusTo={returnFocusTo}
      className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-[14px] bg-white shadow-xl"
    >
      <div className="p-6" data-testid="folder-dialog">
        <div className="flex items-center justify-between">
          <h2 id="folder-dialog-title" className="text-xl font-semibold text-gray-900">
            {mode === 'create' ? t('folder.createTitle') : t('folder.renameTitle')}
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
        <form onSubmit={submit} className="mt-5">
          <label htmlFor="folder-dialog-name" className="block text-sm font-medium text-gray-700">
            {t('folder.nameLabel')}
          </label>
          <input
            id="folder-dialog-name"
            ref={inputRef}
            type="text"
            value={name}
            maxLength={FOLDER_NAME_LIMIT}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('folder.namePlaceholder')}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {error ? (
            <p className="mt-2 text-sm text-red-600" data-testid="folder-dialog-error">{error}</p>
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
              type="submit"
              disabled={submitting || submitDisabled || !name.trim()}
              data-testid="folder-dialog-submit"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mode === 'create' ? t('folder.create') : t('folder.rename')}
            </button>
          </div>
        </form>
      </div>
    </ModalDialog>
  );
};

const truncateFolderName = (value: string): string => {
  let length = 0;
  let result = '';
  for (const char of value) {
    if (length + char.length > FOLDER_NAME_LIMIT) break;
    result += char;
    length += char.length;
  }
  return result;
};

const errorMessage = (err: unknown, fallback: string): string => {
  const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof message === 'string' && message ? message : fallback;
};
