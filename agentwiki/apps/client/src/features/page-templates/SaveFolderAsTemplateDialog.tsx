import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Folder, RefreshCw } from 'lucide-react';
import { apiErrorCode, apiErrorMessage } from '../../api/error-message';
import { ModalDialog } from '../../components/ModalDialog';
import { useLanguage } from '../../context/LanguageContext';
import { collaborationApi } from '../collaboration/api';
import type { TemplateSummary } from '../collaboration/types';
import {
  discoverFolderCollaborationSource,
  getLegacyWorkflowUpgradeSource,
  previewFolderTemplate,
  saveFolderTemplate,
} from './compositeTemplateApi';
import type {
  CompositeTemplateWriteResult,
  FolderCollaborationSource,
  FolderSnapshotPreview,
  FolderSnapshotSelection,
  FolderSourceNode,
  FolderWorkflowSource,
  LegacyWorkflowUpgradeSource,
} from './compositeTemplateTypes';
import { truncateValidatorLength } from './validatorLength';

const CATEGORIES = ['planning', 'reporting', 'knowledge', 'other'] as const;
const NAME_LIMIT = 80;
const DESCRIPTION_LIMIT = 240;
const TITLE_LIMIT = 200;

type SourceKind = FolderWorkflowSource['kind'];

export interface SaveFolderAsTemplateDialogProps {
  spaceId: string;
  folderId: string;
  folderName: string;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  onSaved: (template: CompositeTemplateWriteResult) => void;
}

export const SaveFolderAsTemplateDialog: React.FC<SaveFolderAsTemplateDialogProps> = ({
  spaceId, folderId, folderName, returnFocusTo, onClose, onSaved,
}) => {
  const { language, t } = useLanguage();
  const [draft, setDraft] = useState(() => ({
    name: truncateValidatorLength(folderName, NAME_LIMIT), description: '',
    category: 'other' as typeof CATEGORIES[number],
    defaultTitle: truncateValidatorLength(folderName, TITLE_LIMIT),
  }));
  const [sourceKind, setSourceKind] = useState<SourceKind>('structure_only');
  const [exactSource, setExactSource] = useState<NonNullable<FolderCollaborationSource['source']> | null>(null);
  const [exactSourceChecked, setExactSourceChecked] = useState(false);
  const [legacyTemplates, setLegacyTemplates] = useState<TemplateSummary[]>([]);
  const [legacySource, setLegacySource] = useState<LegacyWorkflowUpgradeSource | null>(null);
  const [legacyTargets, setLegacyTargets] = useState<Record<string, string>>({});
  const [excludedFolderIds, setExcludedFolderIds] = useState<Set<string>>(() => new Set());
  const [excludedPageIds, setExcludedPageIds] = useState<Set<string>>(() => new Set());
  const [duties, setDuties] = useState<Record<string, string>>({});
  const [authoritativeNodes, setAuthoritativeNodes] = useState<FolderSourceNode[]>([]);
  const [preview, setPreview] = useState<FolderSnapshotPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceChanged, setSourceChanged] = useState(false);
  const [disappearedIds, setDisappearedIds] = useState<string[]>([]);
  const [attachmentAcknowledged, setAttachmentAcknowledged] = useState(false);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const scopeRef = useRef(`${spaceId}\u0000${folderId}\u0000${language}`);
  scopeRef.current = `${spaceId}\u0000${folderId}\u0000${language}`;

  const source = useMemo<FolderWorkflowSource>(() => {
    if (sourceKind === 'template') return { kind: 'template', versionId: exactSource?.compositeTemplateVersionId ?? '' };
    if (sourceKind === 'legacy_workflow') return {
      kind: 'legacy_workflow', templateId: legacySource?.legacyId ?? '', version: legacySource?.version ?? 0,
      taskTargets: Object.entries(legacyTargets).filter(([, pageId]) => pageId).map(([taskNodeId, pageId]) => ({ taskNodeId, pageId })),
    };
    return { kind: sourceKind };
  }, [exactSource, legacySource, legacyTargets, sourceKind]);

  const buildSelection = useCallback((
    overrides: Partial<FolderSnapshotSelection> = {},
    dutyDrafts = duties,
    nodes = authoritativeNodes,
  ): FolderSnapshotSelection => {
    const selection = {
      excludedFolderIds: [...excludedFolderIds],
      excludedPageIds: [...excludedPageIds],
      locale: language,
      source,
      ...overrides,
    };
    const retained = retainedPageIdsFor(nodes, new Set(selection.excludedFolderIds), new Set(selection.excludedPageIds));
    return {
      ...selection,
      roleSlotsByPage: selection.source.kind === 'simple_pages'
        ? Object.entries(dutyDrafts).filter(([pageId]) => retained.has(pageId))
          .map(([pageId, role]) => ({ pageId, roleSlotKey: role.trim() || null }))
        : undefined,
    };
  }, [authoritativeNodes, duties, excludedFolderIds, excludedPageIds, language, source]);

  const requestPreview = useCallback(async (
    selection: FolderSnapshotSelection,
    options: { authoritative?: boolean; currentScope?: string } = {},
  ): Promise<FolderSnapshotPreview | null> => {
    const scope = options.currentScope ?? scopeRef.current;
    const request = ++requestRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const result = await previewFolderTemplate(spaceId, folderId, selection, controller.signal);
      if (!mountedRef.current || controller.signal.aborted || request !== requestRef.current || scope !== scopeRef.current) return null;
      setPreview(result);
      if (options.authoritative) setAuthoritativeNodes(result.sourceNodes);
      setSourceChanged(false);
      return result;
    } catch (caught) {
      if (!controller.signal.aborted && request === requestRef.current && scope === scopeRef.current) {
        setPreview(null);
        setError(apiErrorMessage(caught, t, 'pageTemplate.folderSave.previewFailed'));
      }
      return null;
    } finally {
      if (request === requestRef.current && scope === scopeRef.current) setLoading(false);
    }
  }, [folderId, spaceId, t]);

  useEffect(() => {
    mountedRef.current = true;
    const scope = `${spaceId}\u0000${folderId}\u0000${language}`;
    requestRef.current += 1;
    abortRef.current?.abort();
    setDraft({
      name: truncateValidatorLength(folderName, NAME_LIMIT), description: '', category: 'other',
      defaultTitle: truncateValidatorLength(folderName, TITLE_LIMIT),
    });
    setSourceKind('structure_only');
    setExactSource(null);
    setExactSourceChecked(false);
    setLegacyTemplates([]);
    setLegacySource(null);
    setLegacyTargets({});
    setExcludedFolderIds(new Set());
    setExcludedPageIds(new Set());
    setDuties({});
    setAuthoritativeNodes([]);
    setPreview(null);
    setDisappearedIds([]);
    setAttachmentAcknowledged(false);
    setSourceChanged(false);
    void requestPreview({
      excludedFolderIds: [], excludedPageIds: [], locale: language, source: { kind: 'structure_only' },
    }, { authoritative: true, currentScope: scope });
    void discoverFolderCollaborationSource(spaceId, folderId).then((found) => {
      if (!mountedRef.current || scope !== scopeRef.current) return;
      setExactSource(found.source);
      setExactSourceChecked(true);
    }).catch(() => {
      if (!mountedRef.current || scope !== scopeRef.current) return;
      setExactSource(null);
      setExactSourceChecked(true);
    });
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      abortRef.current?.abort();
    };
  }, [folderId, folderName, language, requestPreview, spaceId]);

  const previewSelection = (selection: FolderSnapshotSelection) => {
    setSourceChanged(false);
    void requestPreview(selection);
  };

  const changeSourceKind = async (nextKind: SourceKind) => {
    setSourceKind(nextKind);
    setError(null);
    setSourceChanged(false);
    setPreview(null);
    if (nextKind === 'structure_only' || nextKind === 'simple_pages') {
      previewSelection(buildSelection({ source: { kind: nextKind }, ...(nextKind === 'structure_only' ? { roleSlotsByPage: undefined } : {}) }));
      return;
    }
    const scope = scopeRef.current;
    setLoading(true);
    try {
      if (nextKind === 'template') {
        if (exactSource) {
          previewSelection(buildSelection({ source: { kind: 'template', versionId: exactSource.compositeTemplateVersionId } }));
        }
      } else {
        const items = await collaborationApi.listTemplates(spaceId);
        if (scope !== scopeRef.current || sourceKind === nextKind) return;
        setLegacyTemplates(items.filter((item) => !item.system && !item.archivedAt));
        setLegacySource(null);
        setLegacyTargets({});
      }
    } catch (caught) {
      if (scope === scopeRef.current) setError(apiErrorMessage(caught, t, 'pageTemplate.folderSave.sourceLoadFailed'));
    } finally {
      if (scope === scopeRef.current) setLoading(false);
    }
  };

  const chooseLegacyTemplate = async (legacyId: string) => {
    setLegacySource(null);
    setLegacyTargets({});
    setPreview(null);
    if (!legacyId) return;
    const scope = scopeRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await getLegacyWorkflowUpgradeSource(spaceId, legacyId);
      if (scope !== scopeRef.current) return;
      setLegacySource(next);
    } catch (caught) {
      if (scope === scopeRef.current) setError(apiErrorMessage(caught, t, 'pageTemplate.folderSave.sourceLoadFailed'));
    } finally {
      if (scope === scopeRef.current) setLoading(false);
    }
  };

  const changeLegacyTarget = (taskNodeId: string, pageId: string) => {
    if (!legacySource) return;
    const nextTargets = { ...legacyTargets, [taskNodeId]: pageId };
    setLegacyTargets(nextTargets);
    const markdownTasks = legacySource.definition.nodes.filter((node) => node.kind === 'agent_task' && node.output.kind === 'markdown');
    if (markdownTasks.every((task) => retainedPageIds.includes(nextTargets[task.id] ?? ''))) {
      previewSelection(buildSelection({ source: {
        kind: 'legacy_workflow', templateId: legacySource.legacyId, version: legacySource.version,
        taskTargets: markdownTasks.map((task) => ({ taskNodeId: task.id, pageId: nextTargets[task.id]! })),
      } }));
    } else {
      setPreview(null);
    }
  };

  const toggleNode = (node: FolderSourceNode) => {
    if (node.sourceNodeId === folderId) return;
    const nextFolders = new Set(excludedFolderIds);
    const nextPages = new Set(excludedPageIds);
    const target = node.kind === 'folder' ? nextFolders : nextPages;
    if (target.has(node.sourceNodeId)) target.delete(node.sourceNodeId);
    else target.add(node.sourceNodeId);
    setExcludedFolderIds(nextFolders);
    setExcludedPageIds(nextPages);
    const nextRetainedPageIds = retainedPageIdsFor(authoritativeNodes, nextFolders, nextPages);
    const nextLegacyTargets = Object.fromEntries(Object.entries(legacyTargets)
      .filter(([, pageId]) => nextRetainedPageIds.has(pageId)));
    setLegacyTargets(nextLegacyTargets);
    const overrides: Partial<FolderSnapshotSelection> = {
      excludedFolderIds: [...nextFolders], excludedPageIds: [...nextPages],
    };
    if (sourceKind === 'legacy_workflow' && legacySource) {
      const markdownTasks = legacyMarkdownTasks(legacySource);
      if (!markdownTasks.every((task) => nextRetainedPageIds.has(nextLegacyTargets[task.id] ?? ''))) {
        setPreview(null);
        setSourceChanged(false);
        setError(null);
        return;
      }
      overrides.source = legacySelectionSource(legacySource, nextLegacyTargets);
    }
    previewSelection(buildSelection(overrides));
  };

  const changeDuty = (pageId: string, role: string) => {
    const next = { ...duties, [pageId]: role };
    setDuties(next);
    previewSelection(buildSelection({}, next));
  };

  const refreshAuthoritative = async () => {
    const oldNodes = authoritativeNodes;
    const scope = scopeRef.current;
    const request = ++requestRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setPreview(null);
    let full: FolderSnapshotPreview;
    try {
      full = await previewFolderTemplate(spaceId, folderId, {
        excludedFolderIds: [], excludedPageIds: [], locale: language, source: { kind: 'structure_only' },
      }, controller.signal);
      if (!mountedRef.current || controller.signal.aborted || request !== requestRef.current || scope !== scopeRef.current) return;
    } catch (caught) {
      if (!controller.signal.aborted && request === requestRef.current && scope === scopeRef.current) {
        setError(apiErrorMessage(caught, t, 'pageTemplate.folderSave.previewFailed'));
      }
      return;
    } finally {
      if (request === requestRef.current && scope === scopeRef.current) setLoading(false);
    }
    setAuthoritativeNodes(full.sourceNodes);
    setSourceChanged(false);
    const currentIds = new Set(full.sourceNodes.map((node) => node.sourceNodeId));
    setDisappearedIds(oldNodes.map((node) => node.sourceNodeId).filter((id) => !currentIds.has(id)));
    const nextFolders = new Set([...excludedFolderIds].filter((id) => currentIds.has(id)));
    const nextPages = new Set([...excludedPageIds].filter((id) => currentIds.has(id)));
    const nextDuties = Object.fromEntries(Object.entries(duties).filter(([id]) => currentIds.has(id)));
    setExcludedFolderIds(nextFolders);
    setExcludedPageIds(nextPages);
    setDuties(nextDuties);
    const nextRetainedPageIds = retainedPageIdsFor(full.sourceNodes, nextFolders, nextPages);
    const nextLegacyTargets = Object.fromEntries(Object.entries(legacyTargets)
      .filter(([, pageId]) => nextRetainedPageIds.has(pageId)));
    setLegacyTargets(nextLegacyTargets);
    if (sourceKind === 'legacy_workflow' && legacySource
      && !legacyMarkdownTasks(legacySource).every((task) => nextRetainedPageIds.has(nextLegacyTargets[task.id] ?? ''))) {
      return;
    }
    await requestPreview(buildSelection({
      excludedFolderIds: [...nextFolders], excludedPageIds: [...nextPages], locale: language,
      source: sourceKind === 'legacy_workflow' && legacySource
        ? legacySelectionSource(legacySource, nextLegacyTargets)
        : source,
    }, nextDuties, full.sourceNodes));
  };

  const retainedPageIds = useMemo(() => authoritativeNodes.filter((node) => node.kind === 'page'
    && !excludedPageIds.has(node.sourceNodeId)
    && !hasExcludedAncestor(node, authoritativeNodes, excludedFolderIds))
    .map((node) => node.sourceNodeId), [authoritativeNodes, excludedFolderIds, excludedPageIds]);
  const advancedSourceComplete = sourceKind === 'template'
    ? !!exactSource
    : sourceKind === 'legacy_workflow'
      ? !!legacySource && legacyMarkdownTasks(legacySource).every((task) => retainedPageIds.includes(legacyTargets[task.id] ?? ''))
      : true;
  const attachmentWarning = preview?.warnings.some((warning) => warning.code === 'ATTACHMENTS_NOT_COPIED') ?? false;
  const canSave = !!preview && !loading && !submitting && !sourceChanged && draft.name.trim() && draft.defaultTitle.trim()
    && advancedSourceComplete && (!attachmentWarning || attachmentAcknowledged);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave || !preview) return;
    setSubmitting(true);
    setError(null);
    const currentScope = scopeRef.current;
    try {
      const result = await saveFolderTemplate(spaceId, {
        rootFolderId: folderId,
        selection: buildSelection(),
        sourceToken: preview.sourceToken,
        acknowledgedWarnings: attachmentAcknowledged ? ['ATTACHMENTS_NOT_COPIED'] : [],
        name: truncateValidatorLength(draft.name.trim(), NAME_LIMIT),
        description: truncateValidatorLength(draft.description.trim(), DESCRIPTION_LIMIT) || undefined,
        defaultTitle: truncateValidatorLength(draft.defaultTitle.trim(), TITLE_LIMIT),
        category: draft.category,
        locale: language,
      });
      if (mountedRef.current && currentScope === scopeRef.current) onSaved(result);
    } catch (caught) {
      if (mountedRef.current && currentScope === scopeRef.current) {
        const changed = apiErrorCode(caught) === 'SOURCE_CHANGED';
        setSourceChanged(changed);
        setError(apiErrorMessage(caught, t, 'pageTemplate.folderSave.saveFailed'));
      }
    } finally {
      if (mountedRef.current && currentScope === scopeRef.current) setSubmitting(false);
    }
  };

  return <ModalDialog
    labelledBy="save-folder-template-title" onRequestClose={onClose} closeDisabled={submitting}
    returnFocusTo={returnFocusTo}
    className="max-h-[calc(100vh-2rem)] w-full max-w-4xl overflow-y-auto rounded-[14px] bg-white p-4 shadow-xl sm:p-6"
  >
    <form onSubmit={submit} className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="save-folder-template-title" className="break-words text-xl font-semibold">{t('pageTemplate.folderSave.title')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('pageTemplate.folderSave.subtitle')}</p>
        </div>
        <button type="button" aria-label={t('common.close')} disabled={submitting} onClick={onClose} className="h-9 w-9 shrink-0 rounded-lg border">×</button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium">{t('pageTemplate.name')}<input data-modal-autofocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: truncateValidatorLength(event.target.value, NAME_LIMIT) }))} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" /></label>
        <label className="text-sm font-medium">{t('pageTemplate.defaultTitle')}<input value={draft.defaultTitle} onChange={(event) => setDraft((value) => ({ ...value, defaultTitle: truncateValidatorLength(event.target.value, TITLE_LIMIT) }))} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" /></label>
        <label className="text-sm font-medium md:col-span-2">{t('pageTemplate.description')}<textarea value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: truncateValidatorLength(event.target.value, DESCRIPTION_LIMIT) }))} className="mt-1 min-h-20 w-full rounded-lg border p-3 font-normal" /></label>
        <label className="text-sm font-medium">{t('pageTemplate.category')}<select value={draft.category} onChange={(event) => setDraft((value) => ({ ...value, category: event.target.value as typeof CATEGORIES[number] }))} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal">{CATEGORIES.map((category) => <option key={category} value={category}>{t(`pageTemplate.category.${category}`)}</option>)}</select></label>
      </div>

      <section aria-labelledby="folder-template-source-heading" className="rounded-[14px] border p-4">
        <h3 id="folder-template-source-heading" className="font-semibold">{t('pageTemplate.folderSave.source')}</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(['structure_only', 'simple_pages', 'template', 'legacy_workflow'] as const).map((kind) => <label key={kind} className="flex min-h-10 items-center gap-2 rounded-lg border p-3 text-sm"><input type="radio" name="folder-template-source" checked={sourceKind === kind} disabled={!authoritativeNodes.length || (kind === 'template' && (!exactSourceChecked || !exactSource))} onChange={() => void changeSourceKind(kind)} />{t(`pageTemplate.folderSave.source.${kind}`)}</label>)}
        </div>
        {exactSourceChecked && !exactSource ? <p className="mt-2 text-sm text-amber-700">{t('pageTemplate.folderSave.exactSourceMissing')}</p> : null}
        {sourceKind === 'template' ? <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm">{exactSource
          ? <p>{t('pageTemplate.folderSave.exactSourceFound', { version: exactSource.templateVersion })}</p>
          : <p className="text-amber-700">{t('pageTemplate.folderSave.exactSourceMissing')}</p>}</div> : null}
        {sourceKind === 'legacy_workflow' ? <div className="mt-3 space-y-3">
          <label className="block text-sm font-medium">{t('pageTemplate.folderSave.legacyTemplate')}<select value={legacySource?.legacyId ?? ''} onChange={(event) => void chooseLegacyTemplate(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal"><option value="">{t('pageTemplate.folderSave.chooseLegacy')}</option>{legacyTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
          {legacySource ? <div className="grid gap-3 sm:grid-cols-2">{legacySource.definition.nodes.filter((node) => node.kind === 'agent_task' && node.output.kind === 'markdown').map((task) => <label key={task.id} className="text-sm font-medium">{t('pageTemplate.folderSave.pageForTask', { name: task.name })}<select aria-label={t('pageTemplate.folderSave.pageForTask', { name: task.name })} value={legacyTargets[task.id] ?? ''} onChange={(event) => changeLegacyTarget(task.id, event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal"><option value="">{t('common.none')}</option>{authoritativeNodes.filter(isSourcePage).filter((node) => retainedPageIds.includes(node.sourceNodeId)).map((node) => <option key={node.sourceNodeId} value={node.sourceNodeId}>{node.title}</option>)}</select></label>)}</div> : null}
        </div> : null}
      </section>

      <section aria-labelledby="folder-template-tree-heading" className="rounded-[14px] border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="folder-template-tree-heading" className="font-semibold">{t('pageTemplate.folderSave.tree')}</h3>
          <button type="button" disabled={loading || submitting} onClick={() => void refreshAuthoritative()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm"><RefreshCw size={14} />{t('pageTemplate.folderSave.refresh')}</button>
        </div>
        {loading && !authoritativeNodes.length ? <p className="mt-3 text-sm text-gray-500">{t('common.loading')}</p> : null}
        <SourceTree nodes={authoritativeNodes} rootFolderId={folderId} excludedFolderIds={excludedFolderIds} excludedPageIds={excludedPageIds} onToggle={toggleNode} t={t} />
      </section>

      {sourceKind === 'simple_pages' ? <section aria-labelledby="folder-template-duties-heading" className="rounded-[14px] border p-4">
        <h3 id="folder-template-duties-heading" className="font-semibold">{t('pageTemplate.folderSave.duties')}</h3>
        <p className="mt-1 text-sm text-gray-600">{t('pageTemplate.folderSave.dutiesHelp')}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{authoritativeNodes.filter(isSourcePage).filter((node) => retainedPageIds.includes(node.sourceNodeId)).map((node) => <div key={node.sourceNodeId}>
          <label className="text-sm font-medium">{t('pageTemplate.folderSave.dutyFor', { name: node.title, id: node.sourceNodeId })}<input aria-label={t('pageTemplate.folderSave.dutyFor', { name: node.title, id: node.sourceNodeId })} value={duties[node.sourceNodeId] ?? ''} onChange={(event) => changeDuty(node.sourceNodeId, event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" /></label>
          <button type="button" aria-label={t('pageTemplate.folderSave.noDuty', { name: node.title, id: node.sourceNodeId })} aria-pressed={duties[node.sourceNodeId] === ''} onClick={() => changeDuty(node.sourceNodeId, '')} className="mt-1 rounded-lg border px-3 py-2 text-sm">{t('pageTemplate.folderSave.noDutyButton')}</button>
        </div>)}</div>
      </section> : null}

      <div className="space-y-2 rounded-[14px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p>{t('pageTemplate.folderSave.persistedNotice')}</p>
        <p>{t('pageTemplate.folderSave.unsavedNotice')}</p>
        <p>{t('pageTemplate.folderSave.sensitiveNotice')}</p>
        {attachmentWarning ? <label className="flex items-start gap-2 font-medium"><input type="checkbox" checked={attachmentAcknowledged} onChange={(event) => setAttachmentAcknowledged(event.target.checked)} className="mt-1" />{t('pageTemplate.folderSave.attachmentAck')}</label> : null}
      </div>

      {disappearedIds.length ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{t('pageTemplate.folderSave.disappeared', { ids: disappearedIds.join(', ') })}</p> : null}
      {error ? <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700"><p>{error}</p>{sourceChanged ? <button type="button" onClick={() => void refreshAuthoritative()} className="mt-2 min-h-10 rounded-lg border border-red-200 bg-white px-3">{t('pageTemplate.folderSave.refreshChanged')}</button> : null}</div> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" disabled={submitting} onClick={onClose} className="min-h-10 rounded-lg border px-4 text-sm">{t('common.cancel')}</button>
        <button type="submit" disabled={!canSave} className="min-h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-50">{submitting ? t('common.saving') : t('pageTemplate.saveTemplate')}</button>
      </div>
    </form>
  </ModalDialog>;
};

const SourceTree: React.FC<{
  nodes: FolderSourceNode[];
  rootFolderId: string;
  excludedFolderIds: Set<string>;
  excludedPageIds: Set<string>;
  onToggle: (node: FolderSourceNode) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}> = ({ nodes, rootFolderId, excludedFolderIds, excludedPageIds, onToggle, t }) => {
  const children = new Map<string | null, FolderSourceNode[]>();
  for (const node of nodes) children.set(node.parentSourceNodeId, [...(children.get(node.parentSourceNodeId) ?? []), node]);
  const render = (parentId: string | null, level: number, parentExcluded: boolean): React.ReactNode => <ul role={level === 1 ? 'tree' : 'group'} className={level === 1 ? 'mt-3 space-y-1' : 'ml-5 space-y-1 border-l pl-3'}>{(children.get(parentId) ?? []).map((node) => {
    const selfExcluded = node.kind === 'folder' ? excludedFolderIds.has(node.sourceNodeId) : excludedPageIds.has(node.sourceNodeId);
    const excluded = parentExcluded || selfExcluded;
    const name = node.kind === 'folder' ? node.name : node.title;
    const label = t(`pageTemplate.folderSave.include.${node.kind}`, { name, id: node.sourceNodeId });
    return <li key={node.sourceNodeId} role="treeitem" aria-level={level} className="min-w-0">
      <label className={`flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm ${excluded ? 'text-gray-400' : 'text-gray-700'}`}>
        <input type="checkbox" aria-label={label} checked={!excluded} disabled={node.sourceNodeId === rootFolderId || parentExcluded} onChange={() => onToggle(node)} />
        {node.kind === 'folder' ? <Folder size={14} className="text-amber-500" /> : <FileText size={14} className="text-gray-400" />}
        <span className="break-words">{name}</span><span className="break-all text-xs text-gray-400">{node.sourceNodeId}</span>
      </label>
      {children.has(node.sourceNodeId) ? render(node.sourceNodeId, level + 1, excluded) : null}
    </li>;
  })}</ul>;
  return nodes.length ? <div className="min-w-0">{render(null, 1, false)}</div> : null;
};

function hasExcludedAncestor(node: FolderSourceNode, nodes: FolderSourceNode[], excluded: Set<string>): boolean {
  const byId = new Map(nodes.map((item) => [item.sourceNodeId, item]));
  let parentId = node.parentSourceNodeId;
  while (parentId !== null) {
    if (excluded.has(parentId)) return true;
    parentId = byId.get(parentId)?.parentSourceNodeId ?? null;
  }
  return false;
}

function retainedPageIdsFor(
  nodes: FolderSourceNode[],
  excludedFolderIds: Set<string>,
  excludedPageIds: Set<string>,
): Set<string> {
  return new Set(nodes.filter((node) => node.kind === 'page'
    && !excludedPageIds.has(node.sourceNodeId)
    && !hasExcludedAncestor(node, nodes, excludedFolderIds))
    .map((node) => node.sourceNodeId));
}

function legacyMarkdownTasks(source: LegacyWorkflowUpgradeSource) {
  return source.definition.nodes.filter((node) => node.kind === 'agent_task' && node.output.kind === 'markdown');
}

function legacySelectionSource(
  source: LegacyWorkflowUpgradeSource,
  targets: Record<string, string>,
): FolderWorkflowSource {
  return {
    kind: 'legacy_workflow', templateId: source.legacyId, version: source.version,
    taskTargets: legacyMarkdownTasks(source).flatMap((task) => targets[task.id]
      ? [{ taskNodeId: task.id, pageId: targets[task.id]! }]
      : []),
  };
}

function isSourcePage(node: FolderSourceNode): node is Extract<FolderSourceNode, { kind: 'page' }> {
  return node.kind === 'page';
}
