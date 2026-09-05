import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiErrorCode, apiErrorMessage } from '../../api/error-message';
import { ModalDialog } from '../../components/ModalDialog';
import { useLanguage } from '../../context/LanguageContext';
import { listTreeChildren } from '../content-tree/contentTreeApi';
import type { ContentTreeFolderNode } from '../content-tree/contentTreeTypes';
import type { TemplateSummary } from '../collaboration/types';
import { CompositeDefinitionEditor, definitionReferenceIssues } from './CompositeDefinitionEditor';
import {
  getLegacyWorkflowUpgradeSource,
  previewFolderTemplate,
  previewLegacyWorkflowUpgrade,
  upgradeLegacyWorkflow,
} from './compositeTemplateApi';
import type {
  CompositeTemplateDefinition,
  CompositeTemplateWriteResult,
  LegacyWorkflowUpgradeInput,
  LegacyWorkflowUpgradePreview,
  LegacyWorkflowUpgradeSource,
} from './compositeTemplateTypes';
import { truncateValidatorLength } from './validatorLength';

const CATEGORIES = ['planning', 'reporting', 'knowledge', 'other'] as const;
const NAME_LIMIT = 80;
const DESCRIPTION_LIMIT = 240;
const TITLE_LIMIT = 200;

export interface UpgradeWorkflowTemplateDialogProps {
  spaceId: string;
  legacyTemplate: TemplateSummary;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  onUpgraded: (template: CompositeTemplateWriteResult & { resultVersion: number }) => void;
}

export const UpgradeWorkflowTemplateDialog: React.FC<UpgradeWorkflowTemplateDialogProps> = ({
  spaceId, legacyTemplate, returnFocusTo, onClose, onUpgraded,
}) => {
  const { language, t } = useLanguage();
  const [source, setSource] = useState<LegacyWorkflowUpgradeSource | null>(null);
  const [folders, setFolders] = useState<ContentTreeFolderNode[]>([]);
  const [folderId, setFolderId] = useState('');
  const [definition, setDefinition] = useState<CompositeTemplateDefinition | null>(null);
  const [validated, setValidated] = useState<LegacyWorkflowUpgradePreview | null>(null);
  const [result, setResult] = useState<(CompositeTemplateWriteResult & { resultVersion: number }) | null>(null);
  const [draft, setDraft] = useState(() => ({
    name: truncateValidatorLength(legacyTemplate.name, NAME_LIMIT),
    description: truncateValidatorLength(legacyTemplate.description, DESCRIPTION_LIMIT),
    defaultTitle: truncateValidatorLength(legacyTemplate.name, TITLE_LIMIT),
    category: 'other' as typeof CATEGORIES[number],
  }));
  const [loading, setLoading] = useState(true);
  const [loadingFolder, setLoadingFolder] = useState(false);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceConflict, setSourceConflict] = useState(false);
  const [canonicalChanges, setCanonicalChanges] = useState<{ added: string[]; removed: string[] }>({ added: [], removed: [] });
  const epochRef = useRef(0);
  const sourceRef = useRef<LegacyWorkflowUpgradeSource | null>(null);
  const definitionRef = useRef<CompositeTemplateDefinition | null>(null);
  const scopeRef = useRef(`${spaceId}\u0000${legacyTemplate.id}\u0000${language}`);
  scopeRef.current = `${spaceId}\u0000${legacyTemplate.id}\u0000${language}`;
  sourceRef.current = source;
  definitionRef.current = definition;

  const loadCanonicalSource = useCallback(async (preserveDraft = true) => {
    const scope = scopeRef.current;
    const epoch = ++epochRef.current;
    setLoading(true);
    setError(null);
    setSourceConflict(false);
    try {
      const [nextSource, tree] = await Promise.all([
        getLegacyWorkflowUpgradeSource(spaceId, legacyTemplate.id),
        listTreeChildren(spaceId, null),
      ]);
      if (epoch !== epochRef.current || scope !== scopeRef.current) return;
      const previousSource = sourceRef.current;
      const previousDefinition = definitionRef.current;
      setSource(nextSource);
      setFolders(tree.data.filter((node): node is ContentTreeFolderNode => node.kind === 'folder'));
      if (!preserveDraft) {
        setDraft({
          name: truncateValidatorLength(legacyTemplate.name, NAME_LIMIT),
          description: truncateValidatorLength(legacyTemplate.description, DESCRIPTION_LIMIT),
          defaultTitle: truncateValidatorLength(legacyTemplate.name, TITLE_LIMIT), category: 'other',
        });
        setFolderId('');
        setDefinition(null);
        setCanonicalChanges({ added: [], removed: [] });
      } else if (previousDefinition) {
        const nextTaskIds = new Set(canonicalMappingTasks(nextSource).map((task) => task.id));
        const nextTargets = (previousDefinition.collaboration?.taskTargets ?? [])
          .filter((target) => nextTaskIds.has(target.taskNodeId));
        setDefinition({
          ...previousDefinition,
          collaboration: { workflow: nextSource.definition, taskTargets: nextTargets },
        });
        const previousTasks = previousSource ? canonicalMappingTasks(previousSource) : [];
        const previousTaskIds = new Set(previousTasks.map((task) => task.id));
        setCanonicalChanges({
          added: canonicalMappingTasks(nextSource).filter((task) => !previousTaskIds.has(task.id)).map(taskLabel),
          removed: previousTasks.filter((task) => !nextTaskIds.has(task.id)).map(taskLabel),
        });
      }
      setValidated(null);
    } catch (caught) {
      if (epoch === epochRef.current && scope === scopeRef.current) {
        setError(apiErrorMessage(caught, t, 'pageTemplate.upgrade.loadFailed'));
      }
    } finally {
      if (epoch === epochRef.current && scope === scopeRef.current) setLoading(false);
    }
  }, [legacyTemplate.description, legacyTemplate.id, legacyTemplate.name, spaceId, t]);

  useEffect(() => {
    void loadCanonicalSource(false);
    return () => { epochRef.current += 1; };
  }, [loadCanonicalSource]);

  const changeDefinition = (next: CompositeTemplateDefinition) => {
    setDefinition(next);
    setValidated(null);
  };

  const loadFolder = async () => {
    if (!folderId || !source || loadingFolder) return;
    const scope = scopeRef.current;
    setLoadingFolder(true);
    setError(null);
    try {
      const snapshot = await previewFolderTemplate(spaceId, folderId, {
        excludedFolderIds: [], excludedPageIds: [], locale: language,
        source: { kind: 'structure_only' },
      });
      if (scope !== scopeRef.current) return;
      setDefinition({
        ...snapshot.definition,
        collaboration: { workflow: source.definition, taskTargets: [] },
      });
      setValidated(null);
    } catch (caught) {
      if (scope === scopeRef.current) setError(apiErrorMessage(caught, t, 'pageTemplate.upgrade.folderFailed'));
    } finally {
      if (scope === scopeRef.current) setLoadingFolder(false);
    }
  };

  const input = useMemo<LegacyWorkflowUpgradeInput | null>(() => {
    if (!source || !definition) return null;
    return {
      expectedLegacyVersion: source.version,
      expectedLegacyDefinitionHash: source.definitionHash,
      name: truncateValidatorLength(draft.name.trim(), NAME_LIMIT),
      description: truncateValidatorLength(draft.description.trim(), DESCRIPTION_LIMIT) || undefined,
      defaultTitle: truncateValidatorLength(draft.defaultTitle.trim(), TITLE_LIMIT),
      category: draft.category,
      locale: language,
      nodes: definition.nodes,
      taskTargets: definition.collaboration?.taskTargets ?? [],
    };
  }, [definition, draft, language, source]);

  const localIssues = definition ? definitionReferenceIssues(definition) : [];
  const mappingsComplete = definition?.collaboration?.workflow.nodes
    .filter((node) => node.kind === 'agent_task' && node.output.kind === 'markdown')
    .every((task) => definition.collaboration!.taskTargets.some((target) => target.taskNodeId === task.id)) ?? false;
  const canValidate = !!input && !!draft.name.trim() && !!draft.defaultTitle.trim()
    && mappingsComplete && localIssues.length === 0 && !loading && !loadingFolder && !validating;

  const validate = async () => {
    if (!canValidate || !input) return;
    setValidating(true);
    setError(null);
    setSourceConflict(false);
    try {
      const next = await previewLegacyWorkflowUpgrade(spaceId, legacyTemplate.id, input);
      setValidated(next);
    } catch (caught) {
      const conflict = apiErrorCode(caught) === 'COLLABORATION_TEMPLATE_VERSION_CONFLICT';
      setSourceConflict(conflict);
      setError(apiErrorMessage(caught, t, 'pageTemplate.upgrade.validateFailed'));
    } finally {
      setValidating(false);
    }
  };

  const submit = async () => {
    if (!input || !validated || validated.issues.length || submitting) return;
    setSubmitting(true);
    setError(null);
    setSourceConflict(false);
    try {
      const created = await upgradeLegacyWorkflow(spaceId, legacyTemplate.id, input);
      setResult(created);
      onUpgraded(created);
    } catch (caught) {
      const conflict = apiErrorCode(caught) === 'COLLABORATION_TEMPLATE_VERSION_CONFLICT'
        || apiErrorCode(caught) === 'PAGE_TEMPLATE_UPGRADE_CONFLICT';
      setSourceConflict(conflict);
      setError(apiErrorMessage(caught, t, 'pageTemplate.upgrade.commitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return <ModalDialog
    labelledBy="upgrade-workflow-template-title" onRequestClose={onClose}
    closeDisabled={submitting} returnFocusTo={returnFocusTo}
    className="max-h-[calc(100vh-2rem)] w-full max-w-5xl overflow-y-auto rounded-[14px] bg-white p-4 shadow-xl sm:p-6"
  >
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h2 id="upgrade-workflow-template-title" className="break-words text-xl font-semibold">{t('pageTemplate.upgrade.title', { name: legacyTemplate.name })}</h2><p className="mt-1 text-sm text-gray-600">{t('pageTemplate.upgrade.subtitle')}</p></div>
        <button type="button" aria-label={t('common.close')} disabled={submitting} onClick={onClose} className="h-9 w-9 shrink-0 rounded-lg border">×</button>
      </div>

      {loading ? <p className="text-sm text-gray-500">{t('common.loading')}</p> : null}
      {source ? <section className="rounded-[14px] border bg-gray-50 p-4 text-sm"><p className="font-medium">{t('pageTemplate.upgrade.canonical', { version: source.version })}</p><p className="mt-1 break-all text-xs text-gray-500">{source.definitionHash}</p></section> : null}
      {canonicalChanges.added.length || canonicalChanges.removed.length ? <section role="status" className="rounded-[14px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        {canonicalChanges.added.length ? <p>{t('pageTemplate.upgrade.tasksAdded', { tasks: canonicalChanges.added.join(', ') })}</p> : null}
        {canonicalChanges.removed.length ? <p className={canonicalChanges.added.length ? 'mt-1' : ''}>{t('pageTemplate.upgrade.tasksRemoved', { tasks: canonicalChanges.removed.join(', ') })}</p> : null}
      </section> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">{t('pageTemplate.name')}<input data-modal-autofocus value={draft.name} onChange={(event) => { setDraft((value) => ({ ...value, name: truncateValidatorLength(event.target.value, NAME_LIMIT) })); setValidated(null); }} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" /></label>
        <label className="text-sm font-medium">{t('pageTemplate.defaultTitle')}<input value={draft.defaultTitle} onChange={(event) => { setDraft((value) => ({ ...value, defaultTitle: truncateValidatorLength(event.target.value, TITLE_LIMIT) })); setValidated(null); }} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" /></label>
        <label className="text-sm font-medium sm:col-span-2">{t('pageTemplate.description')}<textarea value={draft.description} onChange={(event) => { setDraft((value) => ({ ...value, description: truncateValidatorLength(event.target.value, DESCRIPTION_LIMIT) })); setValidated(null); }} className="mt-1 min-h-20 w-full rounded-lg border p-3 font-normal" /></label>
        <label className="text-sm font-medium">{t('pageTemplate.category')}<select value={draft.category} onChange={(event) => { setDraft((value) => ({ ...value, category: event.target.value as typeof CATEGORIES[number] })); setValidated(null); }} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal">{CATEGORIES.map((category) => <option key={category} value={category}>{t(`pageTemplate.category.${category}`)}</option>)}</select></label>
      </div>

      <section className="rounded-[14px] border p-4">
        <h3 className="font-semibold">{t('pageTemplate.upgrade.folderHeading')}</h3>
        <p className="mt-1 text-sm text-gray-600">{t('pageTemplate.upgrade.folderHelp')}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-sm font-medium">{t('pageTemplate.upgrade.sourceFolder')}<select value={folderId} onChange={(event) => { setFolderId(event.target.value); setDefinition(null); setValidated(null); }} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal"><option value="">{t('pageTemplate.upgrade.chooseFolder')}</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
          <button type="button" disabled={!folderId || loadingFolder || !source} onClick={() => void loadFolder()} className="min-h-10 rounded-lg border px-4 text-sm">{loadingFolder ? t('common.loading') : t('pageTemplate.upgrade.loadFolder')}</button>
        </div>
        {!folders.length && !loading ? <p className="mt-3 text-sm text-amber-700">{t('pageTemplate.upgrade.noFolders')}</p> : null}
      </section>

      {definition ? <CompositeDefinitionEditor definition={definition} locale={language} workflowReadOnly onChange={changeDefinition} /> : null}

      {validated ? validated.issues.length ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><p className="font-medium">{t('pageTemplate.upgrade.invalid')}</p><ul className="mt-2 list-disc pl-5">{validated.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.code}{issue.nodeId ? ` · ${issue.nodeId}` : ''}</li>)}</ul></div> : <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{t('pageTemplate.upgrade.valid')}</p> : null}
      {result ? <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{t('pageTemplate.upgrade.resultVersion', { version: result.resultVersion })}</p> : null}
      {error ? <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700"><p>{error}</p>{sourceConflict ? <button type="button" onClick={() => void loadCanonicalSource(true)} className="mt-2 min-h-10 rounded-lg border border-red-200 bg-white px-3">{t('pageTemplate.upgrade.reloadSource')}</button> : null}</div> : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" disabled={submitting} onClick={onClose} className="min-h-10 rounded-lg border px-4 text-sm">{t('common.cancel')}</button>
        <button type="button" disabled={!canValidate || submitting} onClick={() => void validate()} className="min-h-10 rounded-lg border px-4 text-sm">{validating ? t('common.loading') : t('pageTemplate.upgrade.validate')}</button>
        <button type="button" disabled={!validated || validated.issues.length > 0 || submitting} onClick={() => void submit()} className="min-h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-50">{submitting ? t('common.saving') : t('pageTemplate.upgrade.commit')}</button>
      </div>
    </div>
  </ModalDialog>;
};

function canonicalMappingTasks(source: LegacyWorkflowUpgradeSource) {
  return source.definition.nodes.filter((node) => node.kind === 'agent_task' && node.output.kind === 'markdown');
}

function taskLabel(task: ReturnType<typeof canonicalMappingTasks>[number]): string {
  return `${task.name} (${task.id})`;
}
