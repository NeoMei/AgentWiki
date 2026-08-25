import React, { useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '../../api/error-message';
import { ModalDialog } from '../../components/ModalDialog';
import { useLanguage } from '../../context/LanguageContext';
import { createPageTemplate } from './pageTemplateApi';
import type { PageTemplateCategory, PageTemplateDetail } from './pageTemplateTypes';

const CATEGORIES: PageTemplateCategory[] = ['planning', 'reporting', 'knowledge', 'other'];
const TEMPLATE_NAME_LIMIT = 80;
const TEMPLATE_DEFAULT_TITLE_LIMIT = 200;

// Match validator.js isLength: surrogate pairs count as one, and a variation
// selector is discounted only when it follows a non-selector UTF-16 code unit.
const truncateValidatorLength = (value: string, maxLength: number) => {
  let result = '';
  let offset = 0;
  let length = 0;
  while (offset < value.length && length < maxLength) {
    let end = offset + 1;
    const first = value.charCodeAt(offset);
    if (first >= 0xd800 && first <= 0xdbff && end < value.length) {
      const second = value.charCodeAt(end);
      if (second >= 0xdc00 && second <= 0xdfff) end += 1;
    }
    if (first !== 0xfe0e && first !== 0xfe0f && end < value.length) {
      const next = value.charCodeAt(end);
      if (next === 0xfe0e || next === 0xfe0f) end += 1;
    }
    result += value.slice(offset, end);
    offset = end;
    length += 1;
  }
  return result;
};

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
    name: truncateValidatorLength(pageTitle, TEMPLATE_NAME_LIMIT),
    description: '',
    category: 'other' as PageTemplateCategory,
    defaultTitle: truncateValidatorLength(pageTitle, TEMPLATE_DEFAULT_TITLE_LIMIT),
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
    const name = truncateValidatorLength(draft.name.trim(), TEMPLATE_NAME_LIMIT);
    const defaultTitle = truncateValidatorLength(draft.defaultTitle.trim(), TEMPLATE_DEFAULT_TITLE_LIMIT);
    if (!name || !defaultTitle || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createPageTemplate(spaceId, {
        name,
        description: draft.description.trim() || undefined,
        category: draft.category,
        defaultTitle,
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
            value={draft.name}
            onChange={(event) => setDraft((value) => ({
              ...value,
              name: truncateValidatorLength(event.target.value, TEMPLATE_NAME_LIMIT),
            }))}
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
            value={draft.defaultTitle}
            onChange={(event) => setDraft((value) => ({
              ...value,
              defaultTitle: truncateValidatorLength(event.target.value, TEMPLATE_DEFAULT_TITLE_LIMIT),
            }))}
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
