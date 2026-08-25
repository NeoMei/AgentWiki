import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import api from '../../api/client';
import { apiErrorMessage } from '../../api/error-message';
import { ModalDialog } from '../../components/ModalDialog';
import { useLanguage } from '../../context/LanguageContext';
import { interpolateDefaultPageTitle } from './defaultPageTitle';
import { listPageTemplates } from './pageTemplateApi';
import type { PageTemplateListResponse, PageTemplateSummary } from './pageTemplateTypes';

export interface NewPageDialogProps {
  spaceId: string;
  parentOptions: Array<{ id: string; title: string }>;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  onCreated: (pageId: string) => void;
  now?: Date;
}

type TemplateFilter = 'all' | 'system' | 'space';

type CatalogLoadState =
  | { generation: number; status: 'loading' }
  | { generation: number; status: 'success'; value: PageTemplateListResponse }
  | { generation: number; status: 'error' };

const FILTERS: TemplateFilter[] = ['all', 'system', 'space'];

export const NewPageDialog: React.FC<NewPageDialogProps> = ({
  spaceId,
  ...props
}) => {
  const { language } = useLanguage();
  return <NewPageDialogSession
    key={JSON.stringify([spaceId, language])}
    spaceId={spaceId}
    {...props}
  />;
};

const NewPageDialogSession: React.FC<NewPageDialogProps> = ({
  spaceId,
  parentOptions,
  returnFocusTo,
  onClose,
  onCreated,
  now = new Date(),
}) => {
  const { language, t } = useLanguage();
  const [step, setStep] = useState<1 | 2>(1);
  const [selected, setSelected] = useState<PageTemplateSummary | null>(null);
  const [filter, setFilter] = useState<TemplateFilter>('all');
  const [title, setTitle] = useState('');
  const [parentId, setParentId] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [catalogState, setCatalogState] = useState<CatalogLoadState>({
    generation: 0,
    status: 'loading',
  });

  const currentCatalogState: CatalogLoadState = catalogState.generation === reloadKey
    ? catalogState
    : { generation: reloadKey, status: 'loading' };
  const catalog = currentCatalogState.status === 'success' ? currentCatalogState.value : null;
  const catalogError = currentCatalogState.status === 'error';
  const loading = currentCatalogState.status === 'loading';

  useEffect(() => {
    let active = true;
    setCatalogState({ generation: reloadKey, status: 'loading' });
    void listPageTemplates(spaceId, { locale: language })
      .then((result) => {
        if (active) setCatalogState({ generation: reloadKey, status: 'success', value: result });
      })
      .catch(() => {
        if (active) setCatalogState({ generation: reloadKey, status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [language, reloadKey, spaceId]);

  const visibleTemplates = useMemo(() => {
    if (!catalog) return [];
    if (filter === 'system') return catalog.system;
    if (filter === 'space') return catalog.space;
    return [...catalog.system, ...catalog.space];
  }, [catalog, filter]);

  const choose = (template: PageTemplateSummary | null) => {
    setSelected(template);
    setTitle(template
      ? template.scope === 'system'
        ? interpolateDefaultPageTitle(template.defaultTitle, now)
        : template.defaultTitle
      : '');
    setCreateError(null);
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const payload = {
        title: normalizedTitle,
        spaceId,
        ...(parentId ? { parentId } : {}),
        ...(selected ? {
          templateId: selected.id,
          templateVersion: selected.currentVersion,
          templateLocale: language,
        } : {}),
      };
      const response = await api.post('/pages', payload);
      onCreated(response.data.id);
    } catch (error) {
      setCreateError(apiErrorMessage(error, t, 'page.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <ModalDialog
      labelledBy="new-page-dialog-title"
      onRequestClose={onClose}
      closeDisabled={creating}
      returnFocusTo={returnFocusTo}
      className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[14px] bg-white p-4 shadow-xl sm:p-6"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="new-page-dialog-title" className="text-xl font-semibold text-gray-900">
            {t('page.createTitle')}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {step === 1 ? t('pageTemplate.step.choose') : t('pageTemplate.step.details')}
          </p>
        </div>
        <button
          type="button"
          aria-label={t('common.close')}
          disabled={creating}
          onClick={onClose}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50"
        >
          <X size={20} />
        </button>
      </div>

      {step === 1 ? (
        <>
          <div role="group" aria-label={t('pageTemplate.step.choose')} className="mt-5 flex flex-wrap gap-2">
            {FILTERS.map((scope) => (
              <button
                key={scope}
                type="button"
                aria-pressed={filter === scope}
                onClick={() => setFilter(scope)}
                className={`min-h-10 rounded-full border px-4 text-sm ${
                  filter === scope ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'
                }`}
              >
                {t(`pageTemplate.filter.${scope}`)}
              </button>
            ))}
          </div>

          {catalogError ? (
            <div role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <span>{t('pageTemplate.loadFailed')}</span>{' '}
              <button
                type="button"
                onClick={() => setReloadKey((current) => current + 1)}
                className="min-h-10 px-2 font-medium underline"
              >
                {t('pageTemplate.retry')}
              </button>
            </div>
          ) : null}
          {loading ? <p role="status" className="mt-4 text-sm text-gray-500">{t('common.loading')}</p> : null}

          <div role="group" aria-label={t('pageTemplate.step.choose')} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TemplateButton
              name={t('pageTemplate.blank.name')}
              description={t('pageTemplate.blank.description')}
              selected={selected === null}
              onClick={() => choose(null)}
            />
            {visibleTemplates.map((template) => (
              <TemplateButton
                key={template.id}
                name={template.name}
                description={template.description}
                category={t(`pageTemplate.category.${template.category}`)}
                selected={selected?.id === template.id}
                onClick={() => choose(template)}
              />
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            {catalog?.capabilities.canManage ? (
              <Link
                to={`/spaces/${spaceId}/settings/page-templates`}
                className="inline-flex min-h-10 items-center text-sm font-medium text-blue-700 hover:underline"
              >
                {t('pageTemplate.manage')}
              </Link>
            ) : <span />}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={onClose} className="min-h-10 rounded-lg border px-4 text-sm">
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="min-h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white"
              >
                {t('pageTemplate.next')}
              </button>
            </div>
          </div>
        </>
      ) : (
        <form onSubmit={create} className="mt-5">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{t('pageTemplate.selected')}</p>
            <p className="mt-1 break-words text-sm font-medium text-gray-900">
              {selected?.name ?? t('pageTemplate.blank.name')}
            </p>
            <p className="mt-1 break-words text-sm text-gray-600">
              {selected?.description ?? t('pageTemplate.blank.description')}
            </p>
          </div>

          <label className="mt-4 block text-sm font-medium text-gray-800">
            {t('common.title')}
            <input
              data-modal-autofocus
              autoFocus
              type="text"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('page.titlePlaceholder')}
              className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          <label className="mt-4 block text-sm font-medium text-gray-800">
            {t('page.parent')}
            <select
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
              className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t('page.noParent')}</option>
              {parentOptions.map((parent) => (
                <option key={parent.id} value={parent.id}>{parent.title}</option>
              ))}
            </select>
          </label>

          {createError ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{createError}</p> : null}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <button
              type="button"
              disabled={creating}
              onClick={() => setStep(1)}
              className="min-h-10 rounded-lg border px-4 text-sm disabled:opacity-50"
            >
              {t('pageTemplate.back')}
            </button>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={creating}
                onClick={onClose}
                className="min-h-10 rounded-lg border px-4 text-sm disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={creating || !title.trim()}
                className="min-h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white disabled:opacity-50"
              >
                {creating ? t('common.creating') : t('common.create')}
              </button>
            </div>
          </div>
        </form>
      )}
    </ModalDialog>
  );
};

interface TemplateButtonProps {
  name: string;
  description: string;
  category?: string;
  selected: boolean;
  onClick: () => void;
}

const TemplateButton: React.FC<TemplateButtonProps> = ({ name, description, category, selected, onClick }) => (
  <button
    type="button"
    aria-pressed={selected}
    onClick={onClick}
    className={`min-w-0 rounded-xl border p-4 text-left transition ${
      selected ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-gray-200 hover:border-blue-300'
    }`}
  >
    <span className="block break-words text-sm font-semibold text-gray-900">{name}</span>
    {category ? <span className="mt-1 block text-xs text-blue-700">{category}</span> : null}
    <span className="mt-2 block break-words text-sm text-gray-600">{description}</span>
  </button>
);
