import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiErrorMessage } from '../../api/error-message';
import { ModalDialog } from '../../components/ModalDialog';
import { SpaceNav } from '../../components/SpaceNav';
import { useLanguage } from '../../context/LanguageContext';
import {
  archivePageTemplate,
  createPageTemplateVersion,
  listPageTemplateSourcePages,
  listPageTemplates,
  restorePageTemplate,
  updatePageTemplate,
} from './pageTemplateApi';
import type {
  PageTemplateCategory,
  PageTemplateListResponse,
  PageTemplateSourcePage,
  PageTemplateSummary,
} from './pageTemplateTypes';
import { truncateValidatorLength } from './validatorLength';

type PendingDialog =
  | { type: 'metadata'; template: PageTemplateSummary }
  | { type: 'version'; template: PageTemplateSummary }
  | null;

const EMPTY_TEMPLATES: PageTemplateListResponse = {
  system: [],
  space: [],
  totalSpace: 0,
  skip: 0,
  take: 50,
  capabilities: { canManage: false },
};

const CATEGORIES: PageTemplateCategory[] = ['planning', 'reporting', 'knowledge', 'other'];
const TEMPLATE_NAME_LIMIT = 80;
const TEMPLATE_DESCRIPTION_LIMIT = 240;
const TEMPLATE_DEFAULT_TITLE_LIMIT = 200;
const TEMPLATE_SEARCH_LIMIT = 80;

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
  const [sourcePages, setSourcePages] = useState<PageTemplateSourcePage[]>([]);
  const [sourcePagesLoading, setSourcePagesLoading] = useState(false);
  const [sourcePageId, setSourcePageId] = useState('');
  const [pendingArchiveKeys, setPendingArchiveKeys] = useState<Set<string>>(() => new Set());
  const requestIdRef = useRef(0);
  const sourceRequestIdRef = useRef(0);
  const templatesRef = useRef(EMPTY_TEMPLATES);
  const spaceIdRef = useRef(id);
  const archiveOperationRef = useRef(new Set<string>());
  const fallbackFocusRef = useRef<HTMLInputElement>(null);
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
        const markdownPages: PageTemplateSourcePage[] = [];
        const seen = new Set<string>();
        let skip = 0;
        while (true) {
          const response = await listPageTemplateSourcePages(id, { skip, take: 100 });
          if (requestId !== sourceRequestIdRef.current) return;
          const batch = response.data;
          for (const page of batch) {
            if (page.format === 'markdown' && !seen.has(page.id)) {
              seen.add(page.id);
              markdownPages.push(page);
            }
          }
          const total = response.total;
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
    const operationKey = `${id ?? ''}\u0000${template.id}`;
    if (!visibleTemplates.capabilities.canManage || archiveOperationRef.current.has(operationKey)) return;
    setMetadataName(truncateValidatorLength(template.name, TEMPLATE_NAME_LIMIT));
    setMetadataDescription(truncateValidatorLength(template.description, TEMPLATE_DESCRIPTION_LIMIT));
    setMetadataCategory(template.category);
    setMetadataDefaultTitle(truncateValidatorLength(template.defaultTitle, TEMPLATE_DEFAULT_TITLE_LIMIT));
    setDialogError(null);
    setPendingDialog({ type: 'metadata', template });
  };

  const openVersion = (template: PageTemplateSummary) => {
    const operationKey = `${id ?? ''}\u0000${template.id}`;
    if (!visibleTemplates.capabilities.canManage || archiveOperationRef.current.has(operationKey)) return;
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
    const name = truncateValidatorLength(metadataName.trim(), TEMPLATE_NAME_LIMIT);
    const description = truncateValidatorLength(metadataDescription.trim(), TEMPLATE_DESCRIPTION_LIMIT);
    const defaultTitle = truncateValidatorLength(metadataDefaultTitle.trim(), TEMPLATE_DEFAULT_TITLE_LIMIT);
    if (!name || !defaultTitle) return;
    setSubmitting(true);
    setDialogError(null);
    try {
      await updatePageTemplate(id, template.id, {
        name,
        description: description || undefined,
        category: metadataCategory,
        defaultTitle,
        expectedUpdatedAt: template.updatedAt,
      });
      if (spaceIdRef.current !== operationSpaceId) return;
      invalidateCatalog();
      queueMicrotask(() => fallbackFocusRef.current?.focus());
      await latestLoadRef.current(true);
    } catch (caught) {
      if (identityRef.current === operationIdentity) {
        setDialogError(apiErrorMessage(caught, t, 'pageTemplate.updateMetadataFailed'));
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
      queueMicrotask(() => fallbackFocusRef.current?.focus());
      await latestLoadRef.current(true);
    } catch (caught) {
      if (identityRef.current === operationIdentity) {
        setDialogError(apiErrorMessage(caught, t, 'pageTemplate.createVersionFailed'));
      }
    } finally {
      if (identityRef.current === operationIdentity) setSubmitting(false);
    }
  };

  const changeArchiveState = async (template: PageTemplateSummary, restore: boolean) => {
    if (!id || !visibleTemplates.capabilities.canManage) return;
    const operationKey = `${id}\u0000${template.id}`;
    if (archiveOperationRef.current.has(operationKey)
      || !window.confirm(`${t(restore ? 'pageTemplate.restore' : 'pageTemplate.archive')} ${template.name}?`)) return;
    archiveOperationRef.current.add(operationKey);
    setPendingArchiveKeys((current) => new Set(current).add(operationKey));
    const operationIdentity = identityRef.current;
    const operationSpaceId = id;
    setError(null);
    try {
      if (restore) await restorePageTemplate(id, template.id, template.updatedAt);
      else await archivePageTemplate(id, template.id, template.updatedAt);
      if (spaceIdRef.current === operationSpaceId) {
        invalidateCatalog();
        queueMicrotask(() => fallbackFocusRef.current?.focus());
        await latestLoadRef.current(true);
      }
    } catch (caught) {
      if (identityRef.current === operationIdentity) {
        setError(apiErrorMessage(caught, t, restore ? 'pageTemplate.restoreFailed' : 'pageTemplate.archiveFailed'));
      }
    } finally {
      archiveOperationRef.current.delete(operationKey);
      setPendingArchiveKeys((current) => {
        const next = new Set(current);
        next.delete(operationKey);
        return next;
      });
    }
  };

  const renderTemplate = (template: PageTemplateSummary, mutable: boolean) => {
    const archivePending = pendingArchiveKeys.has(`${id ?? ''}\u0000${template.id}`);
    return (
    <article key={template.id} className="rounded-[14px] border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 break-words">
          <h3 className="break-all font-medium [overflow-wrap:anywhere]">{template.name}</h3>
          <p className="mt-1 break-words text-sm text-gray-500">{template.description}</p>
          <p className="mt-2 text-xs text-gray-400">
            {t(`pageTemplate.scope.${template.scope}`)} · {t(`pageTemplate.category.${template.category}`)} · v{template.currentVersion}
          </p>
        </div>
        {mutable && visibleTemplates.capabilities.canManage ? (
          <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto">
            {!template.archivedAt ? (
              <>
                <button type="button" disabled={archivePending} className="min-h-10 max-w-full whitespace-normal rounded-lg border px-3 py-2 text-sm break-all [overflow-wrap:anywhere] disabled:opacity-50" onClick={() => openMetadata(template)}>
                  {t('common.edit')} {template.name}
                </button>
                <button type="button" disabled={archivePending} className="min-h-10 max-w-full whitespace-normal rounded-lg border px-3 py-2 text-sm break-all [overflow-wrap:anywhere] disabled:opacity-50" onClick={() => openVersion(template)}>
                  {t('pageTemplate.updateFromPage')} {template.name}
                </button>
                <button type="button" disabled={archivePending} className="min-h-10 max-w-full whitespace-normal rounded-lg border px-3 py-2 text-sm text-red-600 break-all [overflow-wrap:anywhere] disabled:opacity-50" onClick={() => void changeArchiveState(template, false)}>
                  {t('pageTemplate.archive')} {template.name}
                </button>
              </>
            ) : (
              <button type="button" disabled={archivePending} className="min-h-10 max-w-full whitespace-normal rounded-lg border px-3 py-2 text-sm break-all [overflow-wrap:anywhere] disabled:opacity-50" onClick={() => void changeArchiveState(template, true)}>
                {t('pageTemplate.restore')} {template.name}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </article>
    );
  };

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
            ref={fallbackFocusRef}
            type="search"
            value={search}
            onChange={(event) => setSearch(truncateValidatorLength(event.target.value, TEMPLATE_SEARCH_LIMIT))}
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
      {!loading && !error && visibleTemplates.system.length === 0 && visibleTemplates.space.length === 0 ? (
        <p role="status" className="mt-6 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
          {search.trim() || category || showArchived
            ? t('pageTemplate.emptySearch')
            : t('pageTemplate.emptyCatalog')}
        </p>
      ) : null}

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
        <ModalDialog labelledBy="metadata-dialog-title" onRequestClose={closeDialog} closeDisabled={submitting} fallbackFocusRef={fallbackFocusRef} className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-[14px] bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id="metadata-dialog-title" className="min-w-0 break-all text-xl font-semibold [overflow-wrap:anywhere]">{t('common.edit')} {pendingDialog.template.name}</h2>
            <button type="button" aria-label={t('common.close')} disabled={submitting} onClick={closeDialog} className="h-8 w-8 shrink-0 rounded-lg border disabled:opacity-50">×</button>
          </div>
          <form className="mt-5 space-y-4" onSubmit={submitMetadata}>
            <label className="block text-sm font-medium">
              {t('pageTemplate.name')}
              <input data-modal-autofocus className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" value={metadataName} onChange={(event) => setMetadataName(truncateValidatorLength(event.target.value, TEMPLATE_NAME_LIMIT))} required />
            </label>
            <label className="block text-sm font-medium">
              {t('pageTemplate.description')}
              <textarea className="mt-1 w-full rounded-lg border px-3 py-2 font-normal" rows={3} value={metadataDescription} onChange={(event) => setMetadataDescription(truncateValidatorLength(event.target.value, TEMPLATE_DESCRIPTION_LIMIT))} />
            </label>
            <label className="block text-sm font-medium">
              {t('pageTemplate.category')}
              <select className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" value={metadataCategory} onChange={(event) => setMetadataCategory(event.target.value as PageTemplateCategory)}>
                {CATEGORIES.map((value) => <option key={value} value={value}>{t(`pageTemplate.category.${value}`)}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">
              {t('pageTemplate.defaultTitle')}
              <input className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" value={metadataDefaultTitle} onChange={(event) => setMetadataDefaultTitle(truncateValidatorLength(event.target.value, TEMPLATE_DEFAULT_TITLE_LIMIT))} required />
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
        <ModalDialog labelledBy="version-dialog-title" onRequestClose={closeDialog} closeDisabled={submitting} fallbackFocusRef={fallbackFocusRef} className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-[14px] bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id="version-dialog-title" className="min-w-0 break-all text-xl font-semibold [overflow-wrap:anywhere]">{t('pageTemplate.updateFromPage')} {pendingDialog.template.name}</h2>
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
