import React, { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Copy, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { getContentTreeRevision } from '../../api/content-tree';
import { apiErrorMessage } from '../../api/error-message';
import { ModalDialog } from '../../components/ModalDialog';
import { useLanguage } from '../../context/LanguageContext';
import { collaborationApi } from '../collaboration/api';
import { buildAgentJoinInstructions } from '../collaboration/agentJoinInstructions';
import type { AgentInstruction, RoleBinding, SpaceMemberSummary } from '../collaboration/types';
import { CollaborationSettingsPanel, type CollaborationSettingsValue } from './CollaborationSettingsPanel';
import {
  instantiateCompositeTemplate,
  listCompositeTemplates,
  previewCompositeTemplate,
} from './compositeTemplateApi';
import type {
  CompositeInstantiationResult,
  CompositePreviewInputPayload,
  CompositeTemplateCatalog,
  CompositeTemplateKind,
  CompositeTemplatePreview,
  CompositeTemplateSummary,
} from './compositeTemplateTypes';
import { interpolateDefaultPageTitle } from './defaultPageTitle';
import { listPageTemplates } from './pageTemplateApi';
import type { PageTemplateListResponse, PageTemplateSummary } from './pageTemplateTypes';
import { TemplateTreePreview } from './TemplateTreePreview';
import { truncateValidatorLength } from './validatorLength';

export interface NewPageCreationTarget {
  firstPageId: string | null;
  rootFolderId: string | null;
  pageIds: string[];
  runId: string | null;
}

export interface NewPageDialogProps {
  spaceId: string;
  folderId?: string | null;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  onCreated: (target: string | NewPageCreationTarget) => void;
  now?: Date;
}

type ScopeFilter = 'all' | 'system' | 'space';
type KindFilter = 'all' | CompositeTemplateKind;
type Phase = 'select' | 'legacy-details' | 'preview' | 'configure' | 'submitting' | 'result';
type PhaseAction =
  | { type: 'open'; source: 'legacy' | 'composite' }
  | { type: 'configure' }
  | { type: 'submit' }
  | { type: 'resolve' }
  | { type: 'fail'; collaborationEnabled: boolean }
  | { type: 'back' };
type SelectedTemplate =
  | { source: 'blank' }
  | { source: 'legacy'; value: PageTemplateSummary }
  | { source: 'composite'; value: CompositeTemplateSummary };
type CatalogState =
  | { generation: number; status: 'loading' }
  | { generation: number; status: 'error' }
  | { generation: number; status: 'legacy'; value: PageTemplateListResponse }
  | { generation: number; status: 'composite'; value: CompositeTemplateCatalog };

const PAGE_TITLE_LIMIT = 200;
const SCOPE_FILTERS: ScopeFilter[] = ['all', 'system', 'space'];
const KIND_FILTERS: KindFilter[] = ['all', 'single_page', 'page_group'];

function phaseReducer(phase: Phase, action: PhaseAction): Phase {
  switch (action.type) {
    case 'open':
      return phase === 'select' ? (action.source === 'composite' ? 'preview' : 'legacy-details') : phase;
    case 'configure':
      return phase === 'preview' ? 'configure' : phase;
    case 'submit':
      return phase === 'preview' || phase === 'configure' ? 'submitting' : phase;
    case 'resolve':
      return phase === 'submitting' ? 'result' : phase;
    case 'fail':
      return phase === 'submitting' ? (action.collaborationEnabled ? 'configure' : 'preview') : phase;
    case 'back':
      return phase === 'configure' ? 'preview'
        : phase === 'preview' || phase === 'legacy-details' ? 'select'
          : phase;
  }
}

export const NewPageDialog: React.FC<NewPageDialogProps> = ({ spaceId, ...props }) => {
  const { language } = useLanguage();
  return <NewPageDialogSession key={JSON.stringify([spaceId, language])} spaceId={spaceId} {...props} />;
};

const NewPageDialogSession: React.FC<NewPageDialogProps> = ({
  spaceId,
  folderId,
  returnFocusTo,
  onClose,
  onCreated,
  now = new Date(),
}) => {
  const { language, t } = useLanguage();
  const [phase, dispatchPhase] = useReducer(phaseReducer, 'select');
  const [selected, setSelected] = useState<SelectedTemplate>({ source: 'blank' });
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [title, setTitle] = useState('');
  const [rootName, setRootName] = useState('');
  const [collaborationEnabled, setCollaborationEnabled] = useState(false);
  const [collaboration, setCollaboration] = useState<CollaborationSettingsValue>({
    bindings: [], inputValues: {}, enabledTaskNodeIds: [],
  });
  const [preview, setPreview] = useState<CompositeTemplatePreview | null>(null);
  const [members, setMembers] = useState<SpaceMemberSummary[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legacyCreating, setLegacyCreating] = useState(false);
  const [result, setResult] = useState<CompositeInstantiationResult | null>(null);
  const [instructions, setInstructions] = useState<AgentInstruction[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [catalogOffset, setCatalogOffset] = useState(0);
  const [nextCatalogOffset, setNextCatalogOffset] = useState(0);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [catalogState, setCatalogState] = useState<CatalogState>({ generation: 0, status: 'loading' });
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const focusCloseAfterBackRef = useRef(false);
  const sessionActiveRef = useRef(true);
  const operationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const submittingRef = useRef(false);
  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    sessionActiveRef.current = true;
    return () => {
      sessionActiveRef.current = false;
      operationRef.current += 1;
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const appending = catalogOffset > 0;
    if (appending) setCatalogLoadingMore(true);
    else setCatalogState({ generation: reloadKey, status: 'loading' });
    void listCompositeTemplates(spaceId, {
      locale: language,
      scope: scopeFilter,
      ...(kindFilter === 'all' ? {} : { kind: kindFilter }),
      skip: catalogOffset,
      take: 100,
      signal: controller.signal,
    })
      .then((value) => {
        if (!active) return;
        setNextCatalogOffset(value.skip + value.take);
        setCatalogState((current) => {
          if (!appending || current.status !== 'composite') {
            return { generation: reloadKey, status: 'composite', value };
          }
          const byId = new Map(current.value.data.map((template) => [template.id, template]));
          value.data.forEach((template) => byId.set(template.id, template));
          return { generation: reloadKey, status: 'composite', value: {
            ...value,
            data: [...byId.values()],
            skip: 0,
          } };
        });
      })
      .catch(async () => {
        if (appending) return;
        try {
          const value = await listPageTemplates(spaceId, { locale: language });
          if (active) setCatalogState({ generation: reloadKey, status: 'legacy', value });
        } catch {
          if (active) setCatalogState({ generation: reloadKey, status: 'error' });
        }
      })
      .finally(() => {
        if (active && appending) setCatalogLoadingMore(false);
      });
    return () => { active = false; controller.abort(); };
  }, [catalogOffset, kindFilter, language, reloadKey, scopeFilter, spaceId]);

  useLayoutEffect(() => {
    if (phase !== 'select' || !focusCloseAfterBackRef.current) return;
    focusCloseAfterBackRef.current = false;
    closeButtonRef.current?.focus();
  }, [phase]);

  const currentCatalog: CatalogState = catalogState.generation === reloadKey
    ? catalogState
    : { generation: reloadKey, status: 'loading' };
  const compositeCatalog = currentCatalog.status === 'composite' ? currentCatalog.value : null;
  const legacyCatalog = currentCatalog.status === 'legacy' ? currentCatalog.value : null;
  const canManage = compositeCatalog?.capabilities.canManage ?? legacyCatalog?.capabilities.canManage ?? false;
  const compositeTemplates = useMemo(() => (compositeCatalog?.data ?? []).filter((template) =>
    (scopeFilter === 'all' || template.scope === scopeFilter)
    && (kindFilter === 'all' || template.kind === kindFilter)), [compositeCatalog, kindFilter, scopeFilter]);
  const legacyTemplates = useMemo(() => {
    if (!legacyCatalog || kindFilter === 'page_group') return [];
    if (scopeFilter === 'system') return legacyCatalog.system;
    if (scopeFilter === 'space') return legacyCatalog.space;
    return [...legacyCatalog.system, ...legacyCatalog.space];
  }, [kindFilter, legacyCatalog, scopeFilter]);
  const selectedComposite = selected.source === 'composite' ? selected.value : null;
  const selectedLegacy = selected.source === 'legacy' ? selected.value : null;
  const canContinueFromSelect = selected.source === 'blank'
    ? kindFilter !== 'page_group'
    : selected.source === 'composite'
      ? compositeTemplates.some((template) => template.id === selected.value.id)
      : legacyTemplates.some((template) => template.id === selected.value.id);

  const chooseBlank = () => {
    setSelected({ source: 'blank' });
    setError(null);
  };
  const chooseLegacy = (template: PageTemplateSummary) => {
    setSelected({ source: 'legacy', value: template });
    setTitle(truncateValidatorLength(template.scope === 'system'
      ? interpolateDefaultPageTitle(template.defaultTitle, now)
      : template.defaultTitle, PAGE_TITLE_LIMIT));
    setError(null);
  };
  const chooseComposite = (template: CompositeTemplateSummary) => {
    setSelected({ source: 'composite', value: template });
    setRootName(truncateValidatorLength(template.defaultTitle, PAGE_TITLE_LIMIT));
    setPreview(null);
    setCollaborationEnabled(false);
    setCollaboration({ bindings: [], inputValues: {}, enabledTaskNodeIds: [] });
    setError(null);
  };

  const previewPayload = (enabled: boolean, settings = collaboration): CompositePreviewInputPayload => {
    if (!selectedComposite) throw new Error('Composite template is not selected');
    const roleBindings = enabled ? taskBindings(preview?.tasks ?? [], settings) : [];
    return {
      templateVersion: selectedComposite.currentVersion,
      locale: language,
      rootName: rootName.trim() || selectedComposite.defaultTitle,
      variables: {},
      collaborationEnabled: enabled,
      targetParentFolderId: folderId ?? null,
      ...(enabled ? {
        collaborationInputs: settings.inputValues,
        roleBindings,
        enabledTaskNodeIds: settings.enabledTaskNodeIds,
      } : {}),
    };
  };

  const loadPreview = async (enabled: boolean, settings = collaboration) => {
    if (!selectedComposite || previewLoading) return;
    const operation = ++operationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPreviewLoading(true);
    setError(null);
    try {
      const [nextPreview, nextMembers] = await Promise.all([
        previewCompositeTemplate(spaceId, selectedComposite.id, previewPayload(enabled, settings), controller.signal),
        members.length ? Promise.resolve(members) : collaborationApi.listMembers(spaceId),
      ]);
      if (!sessionActiveRef.current || controller.signal.aborted || operationRef.current !== operation) return;
      setPreview(nextPreview);
      setMembers(nextMembers);
      if (enabled && settings.enabledTaskNodeIds.length === 0) {
        setCollaboration((current) => ({ ...current, enabledTaskNodeIds: nextPreview.tasks.map((task) => task.nodeId) }));
      }
    } catch (reason) {
      if (sessionActiveRef.current && !controller.signal.aborted && operationRef.current === operation) {
        setError(apiErrorMessage(reason, t, 'pageTemplate.composite.previewFailed'));
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (sessionActiveRef.current && operationRef.current === operation) setPreviewLoading(false);
    }
  };

  const nextFromSelect = () => {
    if (!canContinueFromSelect) return;
    setError(null);
    if (selected.source === 'composite') {
      dispatchPhase({ type: 'open', source: 'composite' });
      void loadPreview(false);
      return;
    }
    if (selected.source === 'blank' && !title) setTitle('');
    dispatchPhase({ type: 'open', source: 'legacy' });
  };

  const createLegacy = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedTitle = truncateValidatorLength(title.trim(), PAGE_TITLE_LIMIT);
    if (!normalizedTitle || submittingRef.current) return;
    submittingRef.current = true;
    const operation = ++operationRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLegacyCreating(true);
    setError(null);
    try {
      const expectedTreeRevision = await getContentTreeRevision(spaceId, controller.signal);
      if (!sessionActiveRef.current || controller.signal.aborted || operationRef.current !== operation) return;
      const response = await api.post('/pages', {
        title: normalizedTitle,
        spaceId,
        expectedTreeRevision,
        folderId: folderId ?? null,
        ...(selectedLegacy ? {
          templateId: selectedLegacy.id,
          templateVersion: selectedLegacy.currentVersion,
          templateLocale: language,
        } : {}),
      });
      if (sessionActiveRef.current && !controller.signal.aborted && operationRef.current === operation) {
        onCreated(response.data.id);
      }
    } catch (reason) {
      if (sessionActiveRef.current && !controller.signal.aborted && operationRef.current === operation) {
        setError(apiErrorMessage(reason, t, 'page.createFailed'));
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (sessionActiveRef.current && operationRef.current === operation) setLegacyCreating(false);
      submittingRef.current = false;
    }
  };

  const createComposite = async () => {
    if (!selectedComposite || !preview || submittingRef.current) return;
    if (collaborationEnabled && preview.inputs.some((input) => input.required
      && (collaboration.inputValues[input.key] === undefined || collaboration.inputValues[input.key] === ''))) {
      setError(t('pageTemplate.composite.requiredInputs'));
      return;
    }
    if (collaborationEnabled && preview.issues.length) {
      setError(t('pageTemplate.composite.resolveIssues'));
      return;
    }
    const input = previewPayload(collaborationEnabled);
    const signature = JSON.stringify([spaceId, selectedComposite.id, input, preview.treeRevision]);
    if (idempotencyRef.current?.signature !== signature) {
      idempotencyRef.current = { signature, key: `instantiate-${safeUuid()}` };
    }
    submittingRef.current = true;
    const operation = ++operationRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatchPhase({ type: 'submit' });
    setError(null);
    try {
      const created = await instantiateCompositeTemplate(spaceId, selectedComposite.id, {
        ...input,
        expectedTreeRevision: preview.treeRevision,
        idempotencyKey: idempotencyRef.current.key,
      }, controller.signal);
      if (!sessionActiveRef.current || controller.signal.aborted || operationRef.current !== operation) return;
      setResult(created);
      if (created.runId) {
        try {
          const run = await collaborationApi.getRun(spaceId, created.runId);
          if (!controller.signal.aborted && operationRef.current === operation) {
            setInstructions(buildAgentJoinInstructions(run));
          }
        } catch (reason) {
          if (!controller.signal.aborted && operationRef.current === operation) {
            setError(apiErrorMessage(reason, t, 'collaboration.loadFailed'));
          }
        }
      }
      if (!controller.signal.aborted && operationRef.current === operation) dispatchPhase({ type: 'resolve' });
    } catch (reason) {
      if (!controller.signal.aborted && operationRef.current === operation) {
        const response = (reason as { response?: unknown } | null)?.response;
        setError(response
          ? apiErrorMessage(reason, t, 'pageTemplate.composite.createFailed')
          : t('pageTemplate.composite.unknownResult'));
        dispatchPhase({ type: 'fail', collaborationEnabled });
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      submittingRef.current = false;
    }
  };

  const close = () => {
    if (legacyCreating) return;
    operationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    submittingRef.current = false;
    onClose();
  };

  const phaseLabel = phase === 'select' ? t('pageTemplate.step.choose')
    : phase === 'legacy-details' ? t('pageTemplate.step.details')
      : phase === 'configure' ? t('pageTemplate.composite.configure')
        : phase === 'submitting' ? t('pageTemplate.composite.submitting')
      : phase === 'result' ? t('pageTemplate.composite.result')
            : t('pageTemplate.composite.preview');

  return <ModalDialog
    labelledBy="new-page-dialog-title"
    onRequestClose={close}
    closeDisabled={legacyCreating}
    returnFocusTo={returnFocusTo}
    className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[14px] bg-white p-4 shadow-xl sm:p-6"
  >
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0"><h2 id="new-page-dialog-title" className="text-xl font-semibold text-gray-900">{t('page.createTitle')}</h2>
        <p className="mt-1 text-sm text-gray-500">{phaseLabel}</p></div>
      <button ref={closeButtonRef} type="button" aria-label={t('common.close')} disabled={legacyCreating} onClick={close}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50"><X size={20} /></button>
    </div>

    {phase === 'select' ? <SelectPhase
      selected={selected}
      scopeFilter={scopeFilter}
      kindFilter={kindFilter}
      loading={currentCatalog.status === 'loading'}
      failed={currentCatalog.status === 'error'}
      canManage={canManage}
      spaceId={spaceId}
      compositeTemplates={compositeTemplates}
      legacyTemplates={legacyTemplates}
      hasMore={Boolean(compositeCatalog && nextCatalogOffset < compositeCatalog.total)}
      loadingMore={catalogLoadingMore}
      onScopeFilter={(filter) => { setCatalogOffset(0); setNextCatalogOffset(0); setScopeFilter(filter); }}
      onKindFilter={(filter) => { setCatalogOffset(0); setNextCatalogOffset(0); setKindFilter(filter); }}
      onLoadMore={() => setCatalogOffset(nextCatalogOffset)}
      onBlank={chooseBlank}
      onComposite={chooseComposite}
      onLegacy={chooseLegacy}
      onRetry={() => setReloadKey((current) => current + 1)}
      onClose={onClose}
      canContinue={canContinueFromSelect}
      onNext={nextFromSelect}
    /> : null}

    {phase === 'legacy-details' ? <form onSubmit={createLegacy} className="mt-5">
      <SelectedSummary name={selectedLegacy?.name ?? t('pageTemplate.blank.name')}
        description={selectedLegacy?.description ?? t('pageTemplate.blank.description')}
        version={selectedLegacy?.currentVersion} />
      <label className="mt-4 block text-sm font-medium text-gray-800">{t('common.title')}
        <input data-modal-autofocus autoFocus type="text" required value={title}
          onChange={(event) => setTitle(truncateValidatorLength(event.target.value, PAGE_TITLE_LIMIT))}
          placeholder={t('page.titlePlaceholder')}
          className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500" />
      </label>
      {folderId ? <p className="mt-4 text-xs text-gray-500" data-testid="new-page-folder-hint">{t('page.intoCurrentFolder')}</p> : null}
      <ErrorNotice message={error} />
      <WizardActions backDisabled={legacyCreating} onBack={() => { focusCloseAfterBackRef.current = true; dispatchPhase({ type: 'back' }); }}>
        <button type="button" disabled={legacyCreating} onClick={onClose} className="min-h-10 rounded-lg border px-4 text-sm disabled:opacity-50">{t('common.cancel')}</button>
        <button type="submit" disabled={legacyCreating || !title.trim()} className="min-h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white disabled:opacity-50">
          {legacyCreating ? t('common.creating') : t('common.create')}</button>
      </WizardActions>
    </form> : null}

    {phase === 'preview' ? <section className="mt-5 space-y-4">
      <SelectedSummary name={selectedComposite?.name ?? ''} description={selectedComposite?.description ?? ''} version={selectedComposite?.currentVersion} />
      <label className="block text-sm font-medium text-gray-800">{t('pageTemplate.composite.rootName')}
        <input type="text" value={rootName} onChange={(event) => { setRootName(truncateValidatorLength(event.target.value, PAGE_TITLE_LIMIT)); idempotencyRef.current = null; }}
          className="mt-1 min-h-10 w-full rounded-lg border px-3" />
      </label>
      {previewLoading ? <p role="status" className="text-sm text-gray-500">{t('common.loading')}</p>
        : preview ? <TemplateTreePreview nodes={preview.nodes} emptyLabel={t('pageTemplate.composite.treeEmpty')} /> : null}
      <label className="flex items-start gap-3 rounded-[14px] border p-4 text-sm font-medium">
        <input type="checkbox" checked={collaborationEnabled} disabled={!selectedComposite?.effectiveSupportsCollaboration || previewLoading}
          onChange={(event) => {
            const enabled = event.target.checked;
            setCollaborationEnabled(enabled);
            idempotencyRef.current = null;
            void loadPreview(enabled);
          }} />
        <span>{t('pageTemplate.composite.enable')}</span>
      </label>
      <IssueList issues={preview?.issues ?? []} />
      <ErrorNotice message={error} />
      <WizardActions onBack={() => { focusCloseAfterBackRef.current = true; dispatchPhase({ type: 'back' }); }}>
        <button type="button" onClick={onClose} className="min-h-10 rounded-lg border px-4 text-sm">{t('common.cancel')}</button>
        {collaborationEnabled ? <button type="button" disabled={!preview} onClick={() => dispatchPhase({ type: 'configure' })}
          className="min-h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white disabled:opacity-50">{t('pageTemplate.next')}</button>
          : <button type="button" disabled={!preview || previewLoading} onClick={() => void createComposite()}
            className="min-h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white disabled:opacity-50">{selectedComposite?.kind === 'page_group' ? t('pageTemplate.composite.createGroup') : t('common.create')}</button>}
      </WizardActions>
    </section> : null}

    {phase === 'configure' && preview ? <section className="mt-5">
      <CollaborationSettingsPanel spaceId={spaceId} roles={preview.roles} inputs={preview.inputs} tasks={preview.tasks}
        agents={members} bindings={collaboration.bindings} inputValues={collaboration.inputValues}
        enabledTaskNodeIds={collaboration.enabledTaskNodeIds} participants={preview.participants}
        onChange={(value) => { setCollaboration(value); idempotencyRef.current = null; }} />
      <IssueList issues={preview.issues} />
      <ErrorNotice message={error} />
      <WizardActions onBack={() => dispatchPhase({ type: 'back' })}>
        <button type="button" disabled={previewLoading} onClick={() => void loadPreview(true)} className="min-h-10 rounded-lg border px-4 text-sm disabled:opacity-50">
          {previewLoading ? t('common.loading') : t('pageTemplate.composite.refreshParticipants')}</button>
        <button type="button" onClick={() => void createComposite()} disabled={previewLoading}
          className="min-h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white disabled:opacity-50">{t('pageTemplate.composite.createAndStart')}</button>
      </WizardActions>
    </section> : null}

    {phase === 'submitting' ? <div className="mt-8 rounded-[14px] border bg-gray-50 p-6 text-center"><p role="status" className="text-sm text-gray-700">{t('pageTemplate.composite.submitting')}</p></div> : null}

    {phase === 'result' && result && selectedComposite ? <ResultPhase spaceId={spaceId} result={result} template={selectedComposite}
      instructions={instructions} error={error} onOpen={() => onCreated({
        firstPageId: result.pageIds[0] ?? null,
        rootFolderId: result.rootFolderId,
        pageIds: result.pageIds,
        runId: result.runId,
      })} /> : null}
  </ModalDialog>;
};

const SelectPhase: React.FC<{
  selected: SelectedTemplate;
  scopeFilter: ScopeFilter;
  kindFilter: KindFilter;
  loading: boolean;
  failed: boolean;
  canManage: boolean;
  spaceId: string;
  compositeTemplates: CompositeTemplateSummary[];
  legacyTemplates: PageTemplateSummary[];
  hasMore: boolean;
  loadingMore: boolean;
  onScopeFilter: (filter: ScopeFilter) => void;
  onKindFilter: (filter: KindFilter) => void;
  onLoadMore: () => void;
  onBlank: () => void;
  onComposite: (template: CompositeTemplateSummary) => void;
  onLegacy: (template: PageTemplateSummary) => void;
  onRetry: () => void;
  onClose: () => void;
  canContinue: boolean;
  onNext: () => void;
}> = ({ selected, scopeFilter, kindFilter, loading, failed, canManage, spaceId, compositeTemplates, legacyTemplates,
  hasMore, loadingMore, onScopeFilter, onKindFilter, onLoadMore, onBlank, onComposite, onLegacy, onRetry, onClose, canContinue, onNext }) => {
  const { t } = useLanguage();
  return <>
    <div className="mt-5 space-y-3">
      <div role="group" aria-label={t('pageTemplate.step.choose')} className="flex flex-wrap gap-2">{SCOPE_FILTERS.map((filter) => <FilterButton key={filter}
        active={scopeFilter === filter} onClick={() => onScopeFilter(filter)}>{t(`pageTemplate.filter.${filter}`)}</FilterButton>)}</div>
      <div role="group" aria-label={t('pageTemplate.composite.kind.all')} className="flex flex-wrap gap-2">{KIND_FILTERS.map((filter) => <FilterButton key={filter}
        active={kindFilter === filter} onClick={() => onKindFilter(filter)}>{t(`pageTemplate.composite.kind.${filter}`)}</FilterButton>)}</div>
    </div>
    {failed ? <div role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><span>{t('pageTemplate.loadFailed')}</span>{' '}
      <button type="button" onClick={onRetry} className="min-h-10 px-2 font-medium underline">{t('pageTemplate.retry')}</button></div> : null}
    {loading ? <p role="status" className="mt-4 text-sm text-gray-500">{t('common.loading')}</p> : null}
    <div role="group" aria-label={t('pageTemplate.step.choose')} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {kindFilter !== 'page_group' ? <TemplateButton name={t('pageTemplate.blank.name')} description={t('pageTemplate.blank.description')}
        scopeLabel={t('pageTemplate.scope.blank')} selected={selected.source === 'blank'} foundation onClick={onBlank} /> : null}
      {compositeTemplates.map((template) => <TemplateButton key={template.id} name={template.name} description={template.description}
        category={t(`pageTemplate.category.${template.category}`)} scopeLabel={t(`pageTemplate.scope.${template.scope}`)}
        selected={selected.source === 'composite' && selected.value.id === template.id}
        meta={`${t('pageTemplate.composite.pages', { count: template.pageCount })} · ${t('pageTemplate.composite.folders', { count: template.folderCount })}`}
        onClick={() => onComposite(template)} />)}
      {legacyTemplates.map((template) => <TemplateButton key={template.id} name={template.name} description={template.description}
        category={t(`pageTemplate.category.${template.category}`)} scopeLabel={t(`pageTemplate.scope.${template.scope}`)}
        selected={selected.source === 'legacy' && selected.value.id === template.id} onClick={() => onLegacy(template)} />)}
    </div>
    {hasMore ? <button type="button" disabled={loadingMore} onClick={onLoadMore}
      className="mt-4 min-h-10 rounded-lg border px-4 text-sm disabled:opacity-50">{loadingMore ? t('common.loading') : t('pageTemplate.composite.loadMore')}</button> : null}
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      {canManage ? <Link to={`/spaces/${spaceId}/settings/page-templates`} className="inline-flex min-h-10 items-center text-sm font-medium text-blue-700 hover:underline">{t('pageTemplate.manage')}</Link> : <span />}
      <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={onClose} className="min-h-10 rounded-lg border px-4 text-sm">{t('common.cancel')}</button>
        <button type="button" disabled={!canContinue} onClick={onNext} className="min-h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white disabled:opacity-50">{t('pageTemplate.next')}</button></div>
    </div>
  </>;
};

const FilterButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => <button
  type="button" aria-pressed={active} onClick={onClick}
  className={`min-h-10 rounded-full border px-4 text-sm ${active ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}>{children}</button>;

const TemplateButton: React.FC<{
  name: string; description: string; category?: string; scopeLabel: string; selected: boolean; meta?: string; foundation?: boolean; onClick: () => void;
}> = ({ name, description, category, scopeLabel, selected, meta, foundation = false, onClick }) => {
  const { t } = useLanguage();
  return <button type="button" aria-pressed={selected} onClick={onClick} className={`min-w-0 rounded-xl border p-4 text-left transition ${selected
    ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600'
    : foundation ? 'border-dashed border-slate-300 bg-slate-50 hover:border-blue-300' : 'border-gray-200 hover:border-blue-300'}`}>
    <span className="flex flex-wrap items-start justify-between gap-2"><span className="min-w-0 break-words text-sm font-semibold text-gray-900">{name}</span>
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{scopeLabel}</span></span>
    {selected ? <span className="mt-2 block text-xs font-medium text-blue-700">{t('pageTemplate.selected')}</span> : null}
    {category ? <span className="mt-1 block text-xs text-blue-700">{category}</span> : null}
    {meta ? <span className="mt-1 block text-xs text-gray-500">{meta}</span> : null}
    <span className="mt-2 block break-words text-sm text-gray-600">{description}</span>
  </button>;
};

const SelectedSummary: React.FC<{ name: string; description: string; version?: number }> = ({ name, description, version }) => {
  const { t } = useLanguage();
  return <div className="rounded-lg border border-gray-200 bg-gray-50 p-3"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">{t('pageTemplate.selected')}</p>
    <p className="mt-1 break-words text-sm font-medium text-gray-900">{name}</p><p className="mt-1 break-words text-sm text-gray-600">{description}</p>
    <p className="mt-2 text-xs font-medium text-gray-500">{version ? t('pageTemplate.version.number', { version }) : t('pageTemplate.version.blank')}</p></div>;
};

const WizardActions: React.FC<{ backDisabled?: boolean; onBack: () => void; children: React.ReactNode }> = ({ backDisabled = false, onBack, children }) => {
  const { t } = useLanguage();
  return <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4"><button type="button" disabled={backDisabled} onClick={onBack}
    className="min-h-10 rounded-lg border px-4 text-sm disabled:opacity-50">{t('pageTemplate.back')}</button><div className="flex flex-wrap justify-end gap-2">{children}</div></div>;
};

const ErrorNotice: React.FC<{ message: string | null }> = ({ message }) => message
  ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{message}</p>
  : null;

const IssueList: React.FC<{ issues: Array<{ code: string }> }> = ({ issues }) => {
  const { t } = useLanguage();
  if (!issues.length) return null;
  return <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>
    {t(`pageTemplate.composite.issue.${issue.code}`)}</li>)}</ul>;
};

const ResultPhase: React.FC<{
  spaceId: string;
  result: CompositeInstantiationResult;
  template: CompositeTemplateSummary;
  instructions: AgentInstruction[];
  error: string | null;
  onOpen: () => void;
}> = ({ spaceId, result, template, instructions, error, onOpen }) => {
  const { t } = useLanguage();
  return <section className="mt-6"><h3 className="text-lg font-semibold text-gray-900">{t('pageTemplate.composite.created')}</h3>
    {result.runId ? <><p className="mt-2 text-sm text-gray-700">{t('pageTemplate.composite.runStarted')}</p>
      <p className="mt-2 text-sm text-amber-800">{t('pageTemplate.composite.agentsNeedWake')}</p>
      <div className="mt-4 space-y-3">{instructions.map((instruction) => <article key={instruction.agentId} className="rounded-lg border p-3">
        <pre className="whitespace-pre-wrap break-words text-xs">{instruction.text}</pre><button type="button" onClick={() => void navigator.clipboard.writeText(instruction.text)}
          className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm"><Copy size={14} />{t('common.copy')}</button></article>)}</div>
      <Link to={`/spaces/${spaceId}/collaboration/runs/${result.runId}`} className="mt-4 inline-flex min-h-10 items-center text-sm font-medium text-blue-700 hover:underline">{t('collaboration.wizard.openRun')}</Link></> : null}
    <ErrorNotice message={error} />
    <div className="mt-6 flex justify-end border-t pt-4"><button type="button" onClick={onOpen}
      className="min-h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white">{template.kind === 'page_group' ? t('pageTemplate.composite.openGroup') : t('pageTemplate.composite.openPage')}</button></div>
  </section>;
};

function taskBindings(tasks: CompositeTemplatePreview['tasks'], settings: CollaborationSettingsValue): CompositePreviewInputPayload['roleBindings'] {
  const bindingByRole = new Map<string, RoleBinding>(settings.bindings.map((binding) => [binding.roleSlotId, binding]));
  return tasks.flatMap((task) => {
    if (!settings.enabledTaskNodeIds.includes(task.nodeId)) return [];
    const binding = bindingByRole.get(task.roleSlotId);
    return binding ? [{ kind: 'task_default' as const, nodeId: task.nodeId, roleSlotId: task.roleSlotId, agentId: binding.agentId }] : [];
  });
}

function safeUuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
