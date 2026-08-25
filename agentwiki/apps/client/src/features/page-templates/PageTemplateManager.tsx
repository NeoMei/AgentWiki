import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../api/client';
import { apiErrorMessage } from '../../api/error-message';
import { ModalDialog } from '../../components/ModalDialog';
import { SpaceNav } from '../../components/SpaceNav';
import { useLanguage } from '../../context/LanguageContext';
import {
  archivePageTemplate,
  createPageTemplateVersion,
  listPageTemplates,
  restorePageTemplate,
  updatePageTemplate,
} from './pageTemplateApi';
import type {
  PageTemplateCategory,
  PageTemplateListResponse,
  PageTemplateSummary,
} from './pageTemplateTypes';

type PendingDialog =
  | { type: 'metadata'; template: PageTemplateSummary }
  | { type: 'version'; template: PageTemplateSummary }
  | null;

interface SourcePage {
  id: string;
  title: string;
  format: string;
  updatedAt: string;
}

const EMPTY_TEMPLATES: PageTemplateListResponse = {
  system: [],
  space: [],
  totalSpace: 0,
  skip: 0,
  take: 50,
  capabilities: { canManage: false },
};

const CATEGORIES: PageTemplateCategory[] = ['planning', 'reporting', 'knowledge', 'other'];

export const PageTemplateManager: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { language, t } = useLanguage();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<PageTemplateCategory | ''>('');
  const [showArchived, setShowArchived] = useState(false);
  const [templates, setTemplatesState] = useState<PageTemplateListResponse>(EMPTY_TEMPLATES);
  const [templatesIdentity, setTemplatesIdentity] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDialog, setPendingDialog] = useState<PendingDialog>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [metadataName, setMetadataName] = useState('');
  const [metadataDescription, setMetadataDescription] = useState('');
  const [metadataCategory, setMetadataCategory] = useState<PageTemplateCategory>('other');
  const [metadataDefaultTitle, setMetadataDefaultTitle] = useState('');
  const [sourcePages, setSourcePages] = useState<SourcePage[]>([]);
  const [sourcePagesLoading, setSourcePagesLoading] = useState(false);
  const [sourcePageId, setSourcePageId] = useState('');
  const requestIdRef = useRef(0);
  const sourceRequestIdRef = useRef(0);
  const templatesRef = useRef(EMPTY_TEMPLATES);
  const spaceIdRef = useRef(id);
  spaceIdRef.current = id;
  const identity = `${id ?? ''}\u0000${language}\u0000${search}\u0000${category}\u0000${showArchived ? 'all' : 'active'}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const visibleTemplates = templatesIdentity === identity ? templates : EMPTY_TEMPLATES;

  const invalidateCatalog = useCallback(() => {
    templatesRef.current = EMPTY_TEMPLATES;
    setTemplatesState(EMPTY_TEMPLATES);
    setTemplatesIdentity(null);
    setPendingDialog(null);
  }, []);

  const load = useCallback(async (reset = true) => {
    if (!id) return;
    const requestId = ++requestIdRef.current;
    const requestIdentity = identity;
    if (reset) {
      setLoading(true);
      setLoadingMore(false);
    } else {
      setLoadingMore(true);
    }
    setError(null);
    try {
      const result = await listPageTemplates(id, {
        locale: language,
        scope: 'all',
        archived: showArchived ? 'all' : 'active',
        category: category || undefined,
        q: search || undefined,
        skip: reset ? 0 : templatesRef.current.space.length,
        take: 50,
      });
      if (requestId !== requestIdRef.current || requestIdentity !== identityRef.current) return;
      const next = reset ? result : {
        ...result,
        space: [
          ...templatesRef.current.space,
          ...result.space.filter((item) => !templatesRef.current.space.some((old) => old.id === item.id)),
        ],
      };
      templatesRef.current = next;
      setTemplatesState(next);
      setTemplatesIdentity(requestIdentity);
    } catch (caught) {
      if (requestId === requestIdRef.current && requestIdentity === identityRef.current) {
        setError(apiErrorMessage(caught, t, 'pageTemplate.loadFailed'));
      }
    } finally {
      if (requestId === requestIdRef.current && requestIdentity === identityRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [category, id, identity, language, search, showArchived, t]);
  const latestLoadRef = useRef(load);
  latestLoadRef.current = load;

  useEffect(() => {
    requestIdRef.current += 1;
    sourceRequestIdRef.current += 1;
    templatesRef.current = EMPTY_TEMPLATES;
    setTemplatesState(EMPTY_TEMPLATES);
    setTemplatesIdentity(null);
    setPendingDialog(null);
    setSubmitting(false);
    setDialogError(null);
    void load(true);
  }, [load]);

  useEffect(() => {
    if (!visibleTemplates.capabilities.canManage) setPendingDialog(null);
  }, [visibleTemplates.capabilities.canManage]);

  useEffect(() => {
    if (pendingDialog?.type !== 'version' || !id) return;
    const requestId = ++sourceRequestIdRef.current;
    setSourcePages([]);
    setSourcePageId('');
    setSourcePagesLoading(true);
    setDialogError(null);
    void (async () => {
      try {
        const markdownPages: SourcePage[] = [];
        const seen = new Set<string>();
        let skip = 0;
        while (true) {
          const response = await api.get(`/pages?spaceId=${encodeURIComponent(id)}&skip=${skip}&take=100`);
          if (requestId !== sourceRequestIdRef.current) return;
          const batch = Array.isArray(response.data?.data) ? response.data.data as SourcePage[] : [];
          for (const page of batch) {
            if (page.format === 'markdown' && !seen.has(page.id)) {
              seen.add(page.id);
              markdownPages.push(page);
            }
          }
          const total = typeof response.data?.total === 'number' ? response.data.total : batch.length;
          skip += batch.length;
          if (!batch.length || skip >= total) break;
        }
        if (requestId === sourceRequestIdRef.current) setSourcePages(markdownPages);
      } catch (caught) {
        if (requestId === sourceRequestIdRef.current) {
          setDialogError(apiErrorMessage(caught, t, 'pageTemplate.loadFailed'));
        }
      } finally {
        if (requestId === sourceRequestIdRef.current) setSourcePagesLoading(false);
      }
    })();
    return () => {
      if (sourceRequestIdRef.current === requestId) sourceRequestIdRef.current += 1;
    };
  }, [id, pendingDialog, t]);

  const openMetadata = (template: PageTemplateSummary) => {
    if (!visibleTemplates.capabilities.canManage) return;
    setMetadataName(template.name);
    setMetadataDescription(template.description);
    setMetadataCategory(template.category);
    setMetadataDefaultTitle(template.defaultTitle);
    setDialogError(null);
    setPendingDialog({ type: 'metadata', template });
  };

  const openVersion = (template: PageTemplateSummary) => {
    if (!visibleTemplates.capabilities.canManage) return;
    setDialogError(null);
    setPendingDialog({ type: 'version', template });
  };

  const closeDialog = () => {
    if (!submitting) setPendingDialog(null);
  };

  const submitMetadata = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!id || pendingDialog?.type !== 'metadata' || submitting || !visibleTemplates.capabilities.canManage) return;
    const operationIdentity = identityRef.current;
    const operationSpaceId = id;
    const template = pendingDialog.template;
    setSubmitting(true);
    setDialogError(null);
    try {
      await updatePageTemplate(id, template.id, {
        name: metadataName.trim(),
        description: metadataDescription.trim() || undefined,
        category: metadataCategory,
        defaultTitle: metadataDefaultTitle.trim(),
        expectedUpdatedAt: template.updatedAt,
      });
      if (spaceIdRef.current !== operationSpaceId) return;
      invalidateCatalog();
      await latestLoadRef.current(true);
    } catch (caught) {
      if (identityRef.current === operationIdentity) {
        setDialogError(apiErrorMessage(caught, t, 'pageTemplate.createFailed'));
      }
    } finally {
      if (identityRef.current === operationIdentity) setSubmitting(false);
    }
  };

  const submitVersion = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!id || pendingDialog?.type !== 'version' || submitting || !visibleTemplates.capabilities.canManage) return;
    const sourcePage = sourcePages.find((page) => page.id === sourcePageId);
    if (!sourcePage) return;
    const operationIdentity = identityRef.current;
    const operationSpaceId = id;
    const template = pendingDialog.template;
    setSubmitting(true);
    setDialogError(null);
    try {
      const result = await createPageTemplateVersion(id, template.id, {
        sourcePageId: sourcePage.id,
        expectedSourceUpdatedAt: sourcePage.updatedAt,
        expectedCurrentVersion: template.currentVersion,
      });
      if (spaceIdRef.current !== operationSpaceId) return;
      if (result.noChange) {
        setDialogError(t('pageTemplate.noChange'));
        return;
      }
      invalidateCatalog();
      await latestLoadRef.current(true);
    } catch (caught) {
      if (identityRef.current === operationIdentity) {
        setDialogError(apiErrorMessage(caught, t, 'pageTemplate.createFailed'));
      }
    } finally {
      if (identityRef.current === operationIdentity) setSubmitting(false);
    }
  };

  const changeArchiveState = async (template: PageTemplateSummary, restore: boolean) => {
    if (!id || !visibleTemplates.capabilities.canManage || !window.confirm(`${t(restore ? 'pageTemplate.restore' : 'pageTemplate.archive')} ${template.name}?`)) return;
    const operationIdentity = identityRef.current;
    const operationSpaceId = id;
    setError(null);
    try {
      if (restore) await restorePageTemplate(id, template.id, template.updatedAt);
      else await archivePageTemplate(id, template.id, template.updatedAt);
      if (spaceIdRef.current === operationSpaceId) {
        invalidateCatalog();
        await latestLoadRef.current(true);
      }
    } catch (caught) {
      if (identityRef.current === operationIdentity) {
        setError(apiErrorMessage(caught, t, 'pageTemplate.createFailed'));
      }
    }
  };

  const renderTemplate = (template: PageTemplateSummary, mutable: boolean) => (
    <article key={template.id} className="rounded-[14px] border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 break-words">
          <h3 className="break-words font-medium">{template.name}</h3>
          <p className="mt-1 break-words text-sm text-gray-500">{template.description}</p>
          <p className="mt-2 text-xs text-gray-400">
            {t(`pageTemplate.category.${template.category}`)} · v{template.currentVersion}
          </p>
        </div>
        {mutable && visibleTemplates.capabilities.canManage ? (
          <div className="min-w-0 flex flex-wrap gap-2">
            {!template.archivedAt ? (
              <>
                <button type="button" className="min-h-10 rounded-lg border px-3 py-2 text-sm break-words" onClick={() => openMetadata(template)}>
                  {t('common.edit')} {template.name}
                </button>
                <button type="button" className="min-h-10 rounded-lg border px-3 py-2 text-sm break-words" onClick={() => openVersion(template)}>
                  {t('pageTemplate.updateFromPage')} {template.name}
                </button>
                <button type="button" className="min-h-10 rounded-lg border px-3 py-2 text-sm text-red-600 break-words" onClick={() => void changeArchiveState(template, false)}>
                  {t('pageTemplate.archive')} {template.name}
                </button>
              </>
            ) : (
              <button type="button" className="min-h-10 rounded-lg border px-3 py-2 text-sm break-words" onClick={() => void changeArchiveState(template, true)}>
                {t('pageTemplate.restore')} {template.name}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </article>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <SpaceNav spaceId={id} />
      <Link to={`/spaces/${id}/settings`} className="text-sm text-gray-500 hover:text-blue-600">
        ← {t('settings.spaceTitle')}
      </Link>
      <h1 className="mt-3 text-2xl font-semibold">{t('pageTemplate.settingsTitle')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('pageTemplate.settingsDescription')}</p>

      <div className="mt-6 grid gap-3 rounded-[14px] border bg-white p-4 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
        <label className="text-sm font-medium">
          <span className="mb-1 block">{t('pageTemplate.search')}</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-10 w-full rounded-lg border px-3 font-normal"
          />
        </label>
        <label className="text-sm font-medium">
          <span className="mb-1 block">{t('pageTemplate.category')}</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as PageTemplateCategory | '')}
            className="h-10 w-full rounded-lg border px-3 font-normal"
          >
            <option value="">{t('pageTemplate.filter.all')}</option>
            {CATEGORIES.map((value) => <option key={value} value={value}>{t(`pageTemplate.category.${value}`)}</option>)}
          </select>
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
          {t('pageTemplate.showArchived')}
        </label>
      </div>

      {error ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            className="min-h-10 rounded-lg border px-3 py-2 text-sm"
            onClick={() => {
              invalidateCatalog();
              void load(true);
            }}
          >
            {t('pageTemplate.retry')}
          </button>
        </div>
      ) : null}
      {loading ? <p className="mt-6 text-sm text-gray-500">{t('common.loading')}</p> : null}

      <section className="mt-6" aria-labelledby="system-templates-heading">
        <h2 id="system-templates-heading" className="text-xl font-semibold">{t('pageTemplate.filter.system')}</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {visibleTemplates.system.map((template) => renderTemplate(template, false))}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="space-templates-heading">
        <h2 id="space-templates-heading" className="text-xl font-semibold">{t('pageTemplate.filter.space')}</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {visibleTemplates.space.map((template) => renderTemplate(template, true))}
        </div>
        {visibleTemplates.space.length < visibleTemplates.totalSpace ? (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void load(false)}
            className="mt-4 h-10 rounded-lg border px-4 text-sm disabled:opacity-50"
          >
            {language === 'zh-CN' ? '加载更多' : 'Load more'}
          </button>
        ) : null}
      </section>

      {visibleTemplates.capabilities.canManage && pendingDialog?.type === 'metadata' ? (
        <ModalDialog labelledBy="metadata-dialog-title" onRequestClose={closeDialog} closeDisabled={submitting} className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-[14px] bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id="metadata-dialog-title" className="min-w-0 break-words text-xl font-semibold [overflow-wrap:anywhere]">{t('common.edit')} {pendingDialog.template.name}</h2>
            <button type="button" aria-label={t('common.close')} disabled={submitting} onClick={closeDialog} className="h-8 w-8 shrink-0 rounded-lg border disabled:opacity-50">×</button>
          </div>
          <form className="mt-5 space-y-4" onSubmit={submitMetadata}>
            <label className="block text-sm font-medium">
              {t('pageTemplate.name')}
              <input data-modal-autofocus className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" value={metadataName} onChange={(event) => setMetadataName(event.target.value)} required />
            </label>
            <label className="block text-sm font-medium">
              {t('pageTemplate.description')}
              <textarea className="mt-1 w-full rounded-lg border px-3 py-2 font-normal" rows={3} value={metadataDescription} onChange={(event) => setMetadataDescription(event.target.value)} />
            </label>
            <label className="block text-sm font-medium">
              {t('pageTemplate.category')}
              <select className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" value={metadataCategory} onChange={(event) => setMetadataCategory(event.target.value as PageTemplateCategory)}>
                {CATEGORIES.map((value) => <option key={value} value={value}>{t(`pageTemplate.category.${value}`)}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">
              {t('pageTemplate.defaultTitle')}
              <input className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" value={metadataDefaultTitle} onChange={(event) => setMetadataDefaultTitle(event.target.value)} required />
            </label>
            {dialogError ? <p role="alert" className="text-sm text-red-600">{dialogError}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={submitting} onClick={closeDialog} className="h-10 rounded-lg border px-4 text-sm disabled:opacity-50">{t('common.cancel')}</button>
              <button type="submit" disabled={submitting} className="h-10 rounded-lg bg-blue-600 px-4 text-sm text-white disabled:opacity-50">{t('common.save')}</button>
            </div>
          </form>
        </ModalDialog>
      ) : null}

      {visibleTemplates.capabilities.canManage && pendingDialog?.type === 'version' ? (
        <ModalDialog labelledBy="version-dialog-title" onRequestClose={closeDialog} closeDisabled={submitting} className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-[14px] bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id="version-dialog-title" className="min-w-0 break-words text-xl font-semibold [overflow-wrap:anywhere]">{t('pageTemplate.updateFromPage')} {pendingDialog.template.name}</h2>
            <button type="button" aria-label={t('common.close')} disabled={submitting} onClick={closeDialog} className="h-8 w-8 shrink-0 rounded-lg border disabled:opacity-50">×</button>
          </div>
          <form className="mt-5 space-y-4" onSubmit={submitVersion}>
            <label className="block text-sm font-medium">
              {t('pageTemplate.sourcePage')}
              <select
                data-modal-autofocus
                className="mt-1 h-10 w-full rounded-lg border px-3 font-normal"
                value={sourcePageId}
                onChange={(event) => setSourcePageId(event.target.value)}
                disabled={sourcePagesLoading || submitting}
                required
              >
                <option value="">{sourcePagesLoading ? t('common.loading') : t('pageTemplate.sourcePage')}</option>
                {sourcePages.map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}
              </select>
            </label>
            {dialogError ? <p role="alert" className="text-sm text-red-600">{dialogError}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={submitting} onClick={closeDialog} className="h-10 rounded-lg border px-4 text-sm disabled:opacity-50">{t('common.cancel')}</button>
              <button type="submit" disabled={submitting || sourcePagesLoading || !sourcePageId} className="h-10 rounded-lg bg-blue-600 px-4 text-sm text-white disabled:opacity-50">{t('pageTemplate.createVersion')}</button>
            </div>
          </form>
        </ModalDialog>
      ) : null}
    </div>
  );
};
