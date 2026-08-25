import React, { useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '../../api/error-message';
import { ModalDialog } from '../../components/ModalDialog';
import { useLanguage } from '../../context/LanguageContext';
import { createPageTemplate } from './pageTemplateApi';
import type { PageTemplateCategory, PageTemplateDetail } from './pageTemplateTypes';

const CATEGORIES: PageTemplateCategory[] = ['planning', 'reporting', 'knowledge', 'other'];

export interface SavePageAsTemplateDialogProps {
  spaceId: string;
  pageId: string;
  pageTitle: string;
  pageUpdatedAt: string;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  onSaved: (template: PageTemplateDetail) => void;
}

export const SavePageAsTemplateDialog: React.FC<SavePageAsTemplateDialogProps> = ({
  spaceId,
  pageId,
  pageTitle,
  pageUpdatedAt,
  returnFocusTo,
  onClose,
  onSaved,
}) => {
  const { language, t } = useLanguage();
  const [draft, setDraft] = useState({
    name: pageTitle,
    description: '',
    category: 'other' as PageTemplateCategory,
    defaultTitle: pageTitle,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim() || !draft.defaultTitle.trim() || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createPageTemplate(spaceId, {
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        category: draft.category,
        defaultTitle: draft.defaultTitle.trim(),
        locale: language,
        sourcePageId: pageId,
        expectedSourceUpdatedAt: pageUpdatedAt,
      });
      if (mountedRef.current) onSaved(result);
    } catch (caught) {
      if (mountedRef.current) setError(apiErrorMessage(caught, t, 'pageTemplate.createFailed'));
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <ModalDialog
      labelledBy="save-page-template-title"
      onRequestClose={onClose}
      closeDisabled={submitting}
      returnFocusTo={returnFocusTo}
      className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-[14px] bg-white p-4 shadow-xl sm:p-6"
    >
      <form onSubmit={submit} className="space-y-4">
        <h2 id="save-page-template-title" className="text-xl font-semibold">
          {t('pageTemplate.saveAs')}
        </h2>
        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <label htmlFor="page-template-name" className="block space-y-1 text-sm font-medium">
          <span>{t('pageTemplate.name')}</span>
          <input
            id="page-template-name"
            data-modal-autofocus
            required
            maxLength={80}
            value={draft.name}
            onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>

        <label htmlFor="page-template-description" className="block space-y-1 text-sm font-medium">
          <span>{t('pageTemplate.description')}</span>
          <textarea
            id="page-template-description"
            maxLength={240}
            value={draft.description}
            onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))}
            className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>

        <label htmlFor="page-template-category" className="block space-y-1 text-sm font-medium">
          <span>{t('pageTemplate.category')}</span>
          <select
            id="page-template-category"
            value={draft.category}
            onChange={(event) => setDraft((value) => ({
              ...value,
              category: event.target.value as PageTemplateCategory,
            }))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          >
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>{t(`pageTemplate.category.${category}`)}</option>
            ))}
          </select>
        </label>

        <label htmlFor="page-template-default-title" className="block space-y-1 text-sm font-medium">
          <span>{t('pageTemplate.defaultTitle')}</span>
          <input
            id="page-template-default-title"
            required
            maxLength={160}
            value={draft.defaultTitle}
            onChange={(event) => setDraft((value) => ({ ...value, defaultTitle: event.target.value }))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={submitting || !draft.name.trim() || !draft.defaultTitle.trim()}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('pageTemplate.saveTemplate')}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
};
