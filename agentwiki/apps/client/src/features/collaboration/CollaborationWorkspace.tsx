import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { apiErrorMessage } from '../../api/error-message';
import { ModalDialog } from '../../components/ModalDialog';
import { SpaceNav } from '../../components/SpaceNav';
import { Toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { collaborationApi } from './api';
import { RunList } from './components/RunList';
import { TemplateCard } from './components/TemplateCard';
import type { RunListKind, RunSummary, TemplateSummary } from './types';

type Tab = 'templates' | RunListKind;
type LoadState = 'loading' | 'ready' | 'error';

const SYSTEM_TEMPLATE_SLUGS = new Set(['coding', 'bid-writing', 'paper-writing', 'video-script-writing', 'novel-writing']);

export const CollaborationWorkspace: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [tab, setTab] = useState<Tab>('templates');
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [nextRunCursor, setNextRunCursor] = useState<string | null>(null);
  const [loadingMoreRuns, setLoadingMoreRuns] = useState(false);
  const [state, setState] = useState<LoadState>('loading');
  const [canManage, setCanManage] = useState(false);
  const [canStart, setCanStart] = useState(false);
  const [copySource, setCopySource] = useState<TemplateSummary | null>(null);
  const [copyName, setCopyName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const loadTemplates = useCallback(async () => {
    if (!id) return;
    setState('loading');
    try {
      const [nextTemplates, members] = await Promise.all([
        collaborationApi.listTemplates(id),
        collaborationApi.listMembers(id),
      ]);
      setTemplates(nextTemplates);
      const myRole = user?.platformRole === 'super_admin'
        ? 'owner'
        : members.find((member) => member.type === 'human' && member.userId === user?.id)?.role;
      setCanManage(myRole === 'owner' || myRole === 'admin');
      setCanStart(myRole === 'owner' || myRole === 'admin' || myRole === 'editor');
      setState('ready');
    } catch (error) {
      setToast({ kind: 'error', message: apiErrorMessage(error, t, 'collaboration.loadFailed') });
      setState('error');
    }
  }, [id, t, user?.id, user?.platformRole]);

  const loadRuns = useCallback(async (kind: RunListKind) => {
    if (!id) return;
    setState('loading');
    try {
      const page = await collaborationApi.listRuns(id, kind);
      setRuns(page.items);
      setNextRunCursor(page.nextCursor);
      setState('ready');
    } catch (error) {
      setToast({ kind: 'error', message: apiErrorMessage(error, t, 'collaboration.loadFailed') });
      setState('error');
    }
  }, [id, t]);

  const loadMoreRuns = useCallback(async () => {
    if (!id || tab === 'templates' || !nextRunCursor || loadingMoreRuns) return;
    setLoadingMoreRuns(true);
    try {
      const page = await collaborationApi.listRuns(id, tab, nextRunCursor);
      setRuns((current) => [...current, ...page.items]);
      setNextRunCursor(page.nextCursor);
    } catch (error) {
      setToast({ kind: 'error', message: apiErrorMessage(error, t, 'collaboration.loadFailed') });
    } finally {
      setLoadingMoreRuns(false);
    }
  }, [id, loadingMoreRuns, nextRunCursor, t, tab]);

  useEffect(() => {
    if (tab === 'templates') void loadTemplates();
    else void loadRuns(tab);
  }, [loadRuns, loadTemplates, tab]);

  const labels = useMemo(() => ({
    system: t('collaboration.systemTemplate'), space: t('collaboration.spaceTemplate'),
    copy: t('collaboration.copyTemplate'), edit: t('common.edit'), archive: t('collaboration.archive'),
    start: t('collaboration.start'),
  }), [t]);

  const openCopy = (template: TemplateSummary) => {
    setCopySource(template);
    setCopyName(localizedTemplateName(template, t));
  };

  const copyTemplate = async () => {
    if (!copySource || !copyName.trim() || !id) return;
    setSubmitting(true);
    try {
      const copy = await collaborationApi.copyTemplate(id, copySource.id, copyName.trim());
      setTemplates((current) => [...current, copy]);
      setCopySource(null);
      setToast({ kind: 'success', message: t('collaboration.copySuccess') });
    } catch (error) {
      setToast({ kind: 'error', message: apiErrorMessage(error, t, 'collaboration.copyFailed') });
    } finally {
      setSubmitting(false);
    }
  };

  const archiveTemplate = async (template: TemplateSummary) => {
    if (!id || !window.confirm(t('collaboration.archiveConfirm', { name: template.name }))) return;
    try {
      await collaborationApi.archiveTemplate(id, template.id, template.version);
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      setToast({ kind: 'success', message: t('collaboration.archiveSuccess') });
    } catch (error) {
      setToast({ kind: 'error', message: apiErrorMessage(error, t, 'collaboration.archiveFailed') });
    }
  };

  const retry = () => tab === 'templates' ? void loadTemplates() : void loadRuns(tab);

  return (
    <div className="mx-auto max-w-6xl min-w-0">
      <SpaceNav spaceId={id} />
      <section aria-labelledby="collaboration-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 id="collaboration-title" className="text-2xl font-semibold text-gray-900">{t('collaboration.title')}</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('collaboration.subtitle')}</p>
          </div>
          {canManage && tab === 'templates' ? (
            <Link to={`/spaces/${id}/collaboration/templates/new`} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white">
              <Plus size={16} aria-hidden="true" />{t('collaboration.createTemplate')}
            </Link>
          ) : null}
        </div>

        <div role="tablist" aria-label={t('collaboration.sections')} className="mt-6 flex overflow-x-auto border-b">
          {(['templates', 'active', 'history'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`min-h-11 whitespace-nowrap border-b-2 px-4 text-sm ${tab === value ? 'border-blue-600 font-medium text-blue-700' : 'border-transparent text-gray-500'}`}
            >{t(`collaboration.${value}`)}</button>
          ))}
        </div>

        <div className="mt-5" role="tabpanel">
          {state === 'loading' ? <div data-testid="collaboration-loading" className="rounded-xl border bg-white py-14 text-center text-sm text-gray-500">{t('common.loading')}</div> : null}
          {state === 'error' ? (
            <div data-testid="collaboration-error" className="rounded-xl border border-red-200 bg-red-50 py-12 text-center">
              <p className="text-sm text-red-700">{t('collaboration.loadFailed')}</p>
              <button type="button" onClick={retry} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm"><RefreshCw size={15} />{t('common.retry')}</button>
            </div>
          ) : null}
          {state === 'ready' && tab === 'templates' ? (
            templates.length ? (
              <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {templates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    spaceId={id}
                    template={template}
                    name={localizedTemplateName(template, t)}
                    description={localizedTemplateDescription(template, t)}
                    canManage={canManage}
                    canStart={canStart}
                    labels={labels}
                    onCopy={openCopy}
                    onArchive={(item) => void archiveTemplate(item)}
                  />
                ))}
              </div>
            ) : <div data-testid="collaboration-empty" className="rounded-xl border bg-white py-14 text-center text-sm text-gray-500">{t('collaboration.templatesEmpty')}</div>
          ) : null}
          {state === 'ready' && tab !== 'templates' ? (
            <>
              <RunList
                spaceId={id}
                runs={runs}
                emptyLabel={t(tab === 'active' ? 'collaboration.activeEmpty' : 'collaboration.historyEmpty')}
                statusLabel={(status) => t(`collaboration.status.${status}`)}
                locale={language}
              />
              {nextRunCursor ? (
                <div className="mt-4 text-center">
                  <button type="button" disabled={loadingMoreRuns} onClick={() => void loadMoreRuns()} className="min-h-10 rounded-lg border bg-white px-4 text-sm disabled:opacity-50">
                    {loadingMoreRuns ? t('common.loading') : t('dashboard.loadMore')}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </section>

      {copySource ? (
        <ModalDialog labelledBy="copy-template-title" onRequestClose={() => setCopySource(null)} closeDisabled={submitting} className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
          <h2 id="copy-template-title" className="text-lg font-semibold">{t('collaboration.copyDialogTitle')}</h2>
          <p className="mt-2 text-sm text-gray-600">{t('collaboration.copyDialogDescription')}</p>
          <label htmlFor="copy-template-name" className="mt-5 block text-sm font-medium">{t('collaboration.templateName')}</label>
          <input id="copy-template-name" data-modal-autofocus value={copyName} onChange={(event) => setCopyName(event.target.value)} className="mt-2 h-10 w-full rounded-lg border px-3" />
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" disabled={submitting} onClick={() => setCopySource(null)} className="min-h-10 rounded-lg border px-4 text-sm">{t('common.cancel')}</button>
            <button type="button" disabled={submitting || !copyName.trim()} onClick={() => void copyTemplate()} className="min-h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-50">{submitting ? t('collaboration.copying') : t('common.copy')}</button>
          </div>
        </ModalDialog>
      ) : null}
      {toast ? <Toast kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}
    </div>
  );
};

function localizedTemplateName(template: TemplateSummary, t: (key: string) => string): string {
  return template.system && SYSTEM_TEMPLATE_SLUGS.has(template.slug)
    ? t(`collaboration.template.${template.slug}.name`)
    : template.name;
}

function localizedTemplateDescription(template: TemplateSummary, t: (key: string) => string): string {
  return template.system && SYSTEM_TEMPLATE_SLUGS.has(template.slug)
    ? t(`collaboration.template.${template.slug}.description`)
    : template.description;
}
