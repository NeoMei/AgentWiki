import React, { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDirtyNavigationGuard } from '../space-workspace/workspaceNavigation';
import { ArrowLeft, ArrowRight, Check, FilePlus2, Files, FileText, Folder, LayoutTemplate, Copy, Search, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { getContentTreeRevision } from '../../api/content-tree';
import { apiErrorMessage } from '../../api/error-message';
import { ModalDialog } from '../../components/ModalDialog';
import { Toast } from '../../components/Toast';
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
import './template-creation.css';

export interface NewPageCreationTarget {
  firstPageId: string | null;
  rootFolderId: string | null;
  pageIds: string[];
  runId: string | null;
}

export interface NewPageDialogProps {
  spaceId: string;
  folderId?: string | null;
  targetLocation?: string;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  onCreated: (target: string | NewPageCreationTarget) => void;
  now?: Date;
  presentation?: 'dialog' | 'page';
  initialKind?: 'blank' | 'single_page' | 'page_group';
}

type ScopeFilter = 'all' | 'system' | 'space';
type KindFilter = 'all' | CompositeTemplateKind;
type Phase = 'select' | 'legacy-details' | 'preview' | 'configure' | 'submitting' | 'result';
type PhaseAction =
  | { type: 'open'; source: 'legacy' | 'composite' }
  | { type: 'reset'; blank: boolean }
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
  | { generation: number; status: 'legacy'; value: PageTemplateListResponse; compositeDisabled: boolean }
  | { generation: number; status: 'composite'; value: CompositeTemplateCatalog };

const PAGE_TITLE_LIMIT = 200;
const MARKDOWN_IMPORT_MAX_CHARS = 200_000;

const readMarkdownFile = (file: File): Promise<string> => {
  const text = (file as File & { text?: unknown }).text;
  if (typeof text === 'function') return (text as () => Promise<string>).call(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(typeof reader.result === 'string' ? reader.result : ''));
    reader.addEventListener('error', () => reject(reader.error ?? new Error('MARKDOWN_FILE_READ_FAILED')));
    reader.readAsText(file);
  });
};
const SCOPE_FILTERS: ScopeFilter[] = ['all', 'system', 'space'];
const KIND_FILTERS: KindFilter[] = ['all', 'single_page', 'page_group'];

function phaseReducer(phase: Phase, action: PhaseAction): Phase {
  switch (action.type) {
    case 'reset': return action.blank ? 'legacy-details' : 'select';
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
  targetLocation,
  returnFocusTo,
  onClose,
  onCreated,
  now = new Date(),
  presentation = 'dialog',
  initialKind = 'blank',
}) => {
  const { language, t } = useLanguage();
  const pageMode = presentation === 'page';
  const [method, setMethod] = useState(initialKind);
  const [search, setSearch] = useState('');
  const [completed, setCompleted] = useState(false);
  const [phase, dispatchPhase] = useReducer(phaseReducer, pageMode && initialKind === 'blank' ? 'legacy-details' : 'select');
  const [selected, setSelected] = useState<SelectedTemplate>({ source: 'blank' });
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>(pageMode && initialKind !== 'blank' ? initialKind : 'all');
  const [title, setTitle] = useState('');
  const [rootName, setRootName] = useState('');
  const [collaborationEnabled, setCollaborationEnabled] = useState(false);
  const [collaboration, setCollaboration] = useState<CollaborationSettingsValue>({
    bindings: [], inputValues: {}, enabledTaskNodeIds: [],
  });
  const [preview, setPreview] = useState<CompositeTemplatePreview | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [members, setMembers] = useState<SpaceMemberSummary[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationToast, setValidationToast] = useState<string | null>(null);
  const configureRef = useRef<HTMLElement>(null);
  const configureIssuesRef = useRef<HTMLDivElement>(null);
  const [legacyCreating, setLegacyCreating] = useState(false);
  const [markdownImporting, setMarkdownImporting] = useState(false);
  const [result, setResult] = useState<CompositeInstantiationResult | null>(null);
  const [instructions, setInstructions] = useState<AgentInstruction[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [catalogOffset, setCatalogOffset] = useState(0);
  const [nextCatalogOffset, setNextCatalogOffset] = useState(0);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [catalogState, setCatalogState] = useState<CatalogState>({ generation: 0, status: 'loading' });
  const previewNameRef = useRef<HTMLInputElement>(null);
  const markdownInputRef = useRef<HTMLInputElement>(null);
  const previewEntryFocusRef = useRef(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const refreshParticipantsButtonRef = useRef<HTMLButtonElement>(null);
  const restoreRefreshFocusRef = useRef(false);
  const focusCloseAfterBackRef = useRef(false);
  const sessionActiveRef = useRef(true);
  const operationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const submittingRef = useRef(false);
  const idempotencyRef = useRef<{
    signature: string; inputSignature: string; unknownResult: boolean;
    request: Parameters<typeof instantiateCompositeTemplate>[2];
  } | null>(null);
  const taskSelectionInitializedRef = useRef(false);
  const userEditedRef = useRef(false);

  useDirtyNavigationGuard(pageMode && !completed && phase !== 'result'
    && Boolean(title.trim() || rootName.trim() || collaborationEnabled || legacyCreating || markdownImporting || phase === 'submitting'),
    t('creation.unsaved'));

  const finish = (target: string | NewPageCreationTarget) => {
    flushSync(() => setCompleted(true));
    onCreated(target);
  };

  useEffect(() => {
    sessionActiveRef.current = true;
    return () => {
      sessionActiveRef.current = false;
      operationRef.current += 1;
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => { setValidationToast(null); }, [phase]);

  // Each page preview entry gets one focus attempt, after its disabled input is ready.
  // An explicit focus choice during loading cancels that intent.
  useLayoutEffect(() => {
    if (!pageMode || phase !== 'preview') return;
    previewEntryFocusRef.current = true;
    const cancelEntryFocus = () => { previewEntryFocusRef.current = false; };
    document.addEventListener('focusin', cancelEntryFocus);
    return () => {
      previewEntryFocusRef.current = false;
      document.removeEventListener('focusin', cancelEntryFocus);
    };
  }, [pageMode, phase]);

  useLayoutEffect(() => {
    if (phase !== 'preview' || previewLoading || !preview || !previewEntryFocusRef.current) return;
    previewEntryFocusRef.current = false;
    previewNameRef.current?.focus();
  }, [phase, previewLoading, preview]);

  useLayoutEffect(() => {
    if (phase !== 'select') return;
    // Returning to the catalog invalidates the preview before another template can open.
    operationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setPreviewLoading(false);
  }, [phase]);

  useEffect(() => {
    const button = refreshParticipantsButtonRef.current;
    if (!previewLoading && phase === 'configure' && sessionActiveRef.current
      && restoreRefreshFocusRef.current && button?.isConnected && !button.disabled) {
      restoreRefreshFocusRef.current = false;
      button.focus();
    }
    if (phase !== 'configure') restoreRefreshFocusRef.current = false;
  }, [phase, previewLoading]);

  useEffect(() => {
    if (pageMode && method === 'blank') return;
    let active = true;
    const controller = new AbortController();
    const appending = catalogOffset > 0;
    if (appending) setCatalogLoadingMore(true);
    else setCatalogState({ generation: reloadKey, status: 'loading' });
    void listCompositeTemplates(spaceId, {
      locale: language,
      scope: scopeFilter,
      ...(search.trim() ? { q: search.trim() } : {}),
      ...(kindFilter === 'all' ? {} : { kind: kindFilter }),
      skip: catalogOffset,
      take: 100,
      signal: controller.signal,
    })
      .then(async (value) => {
        if (!active) return;
        if (!value.capabilities.canCreate) {
          if (appending) return;
          const legacy = await listPageTemplates(spaceId, { locale: language, ...(pageMode ? { q: search.trim(), scope: scopeFilter } : {}) });
          if (active) setCatalogState({
            generation: reloadKey, status: 'legacy', value: legacy, compositeDisabled: true,
          });
          return;
        }
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
          const value = await listPageTemplates(spaceId, { locale: language, ...(pageMode ? { q: search.trim(), scope: scopeFilter } : {}) });
          if (active) setCatalogState({
            generation: reloadKey, status: 'legacy', value, compositeDisabled: false,
          });
        } catch {
          if (active) setCatalogState({ generation: reloadKey, status: 'error' });
        }
      })
      .finally(() => {
        if (active && appending) setCatalogLoadingMore(false);
      });
    return () => { active = false; controller.abort(); };
  }, [catalogOffset, kindFilter, language, reloadKey, scopeFilter, spaceId, search, pageMode, method]);

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
    const candidates = scopeFilter === 'system' ? legacyCatalog.system
      : scopeFilter === 'space' ? legacyCatalog.space : [...legacyCatalog.system, ...legacyCatalog.space];
    return candidates.filter((template) => !search.trim()
      || `${template.name} ${template.description}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  }, [kindFilter, legacyCatalog, scopeFilter, search]);
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
    setRootName(truncateValidatorLength(template.scope === 'system' && template.kind === 'single_page'
      ? interpolateDefaultPageTitle(template.defaultTitle, now)
      : template.defaultTitle, PAGE_TITLE_LIMIT));
    setPreview(null);
    setPreviewStale(false);
    setCollaborationEnabled(false);
    setCollaboration({ bindings: [], inputValues: {}, enabledTaskNodeIds: [] });
    taskSelectionInitializedRef.current = false;
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
        ...(taskSelectionInitializedRef.current
          ? { enabledTaskNodeIds: settings.enabledTaskNodeIds }
          : {}),
      } : {}),
    };
  };

  const loadPreview = async (enabled: boolean, settings = collaboration, force = false): Promise<CompositeTemplatePreview | null> => {
    if (!selectedComposite || (previewLoading && !force)) return null;
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
      if (!sessionActiveRef.current || controller.signal.aborted || operationRef.current !== operation) return null;
      setPreview(nextPreview);
      setPreviewStale(false);
      setMembers(nextMembers);
      if (enabled && !taskSelectionInitializedRef.current) {
        taskSelectionInitializedRef.current = true;
        setCollaboration((current) => ({ ...current, enabledTaskNodeIds: nextPreview.tasks.map((task) => task.nodeId) }));
      }
      return nextPreview;
    } catch (reason) {
      if (sessionActiveRef.current && !controller.signal.aborted && operationRef.current === operation) {
        setError(apiErrorMessage(reason, t, 'pageTemplate.composite.previewFailed'));
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (sessionActiveRef.current && operationRef.current === operation) setPreviewLoading(false);
    }
    return null;
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
        finish(response.data.id);
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

  const importMarkdown = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || markdownImporting || legacyCreating || submittingRef.current) return;
    if (!/\.(?:md|markdown)$/iu.test(file.name)) {
      setError(language === 'zh-CN' ? '请选择 .md 或 .markdown 文件。' : 'Choose a .md or .markdown file.');
      return;
    }
    setMarkdownImporting(true);
    const operation = ++operationRef.current;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setError(null);
    try {
      const content = (await readMarkdownFile(file)).replace(/^\uFEFF/u, '');
      if (content.length > MARKDOWN_IMPORT_MAX_CHARS) {
        const max = MARKDOWN_IMPORT_MAX_CHARS.toLocaleString(language === 'zh-CN' ? 'zh-CN' : 'en-US');
        setError(language === 'zh-CN' ? `Markdown 文件超过 ${max} 字符限制。` : `The Markdown file exceeds the ${max} character limit.`);
        return;
      }
      const importedTitle = truncateValidatorLength(
        file.name.replace(/\.(?:md|markdown)$/iu, '').trim(),
        PAGE_TITLE_LIMIT,
      );
      if (!importedTitle) {
        setError(language === 'zh-CN' ? '请选择 .md 或 .markdown 文件。' : 'Choose a .md or .markdown file.');
        return;
      }
      const expectedTreeRevision = await getContentTreeRevision(spaceId, controller.signal);
      if (!sessionActiveRef.current || controller.signal.aborted || operationRef.current !== operation) return;
      const response = await api.post('/pages', {
        title: importedTitle,
        content,
        spaceId,
        expectedTreeRevision,
        folderId: folderId ?? null,
      }, { signal: controller.signal });
      if (sessionActiveRef.current && !controller.signal.aborted && operationRef.current === operation) finish(response.data.id);
    } catch (reason) {
      if (sessionActiveRef.current && !controller.signal.aborted && operationRef.current === operation) {
        setError(apiErrorMessage(reason, t, 'page.createFailed'));
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (sessionActiveRef.current && operationRef.current === operation) setMarkdownImporting(false);
    }
  };

  const showConfigurationError = (message: string, controlId?: string) => {
    setError(message);
    setValidationToast(message);
    const control = controlId ? Array.from(configureRef.current?.querySelectorAll<HTMLElement>('input, textarea, select') ?? [])
      .find((element) => element.id === controlId) : null;
    const target = control ?? configureIssuesRef.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };

  const cancelPendingOperation = () => {
    operationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setPreviewLoading(false);
  };

  const createComposite = async () => {
    if (!selectedComposite || !preview || submittingRef.current) return;
    if (previewStale) {
      setError(t('pageTemplate.composite.previewStale'));
      return;
    }
    const missingInput = collaborationEnabled ? preview.inputs.find((input) => input.required
      && (collaboration.inputValues[input.key] === undefined || collaboration.inputValues[input.key] === '')) : undefined;
    if (missingInput) {
      showConfigurationError(`${t('pageTemplate.composite.requiredInputs')} ${missingInput.label}`, `collaboration-input-${missingInput.key}`);
      return;
    }
    const missingRole = collaborationEnabled ? preview.roles.find((role) => role.required
      && preview.tasks.some((task) => task.roleSlotId === role.id && collaboration.enabledTaskNodeIds.includes(task.nodeId))
      && !collaboration.bindings.some((binding) => binding.roleSlotId === role.id && binding.agentId)) : undefined;
    if (missingRole) {
      showConfigurationError(`${t('pageTemplate.composite.issue.ROLE_BINDING_REQUIRED')} ${missingRole.name}`, `role-binding-${missingRole.id}`);
      return;
    }
    // Own the whole preflight + write, including early returns and failed previews.
    submittingRef.current = true;
    let controller: AbortController | null = null;
    let operation: number | null = null;
    try {
      const input = previewPayload(collaborationEnabled);
      const inputSignature = JSON.stringify([spaceId, selectedComposite.id, input]);
      let attempt = idempotencyRef.current;
      // An interrupted response may have committed. Reuse its exact body and key,
      // even if a later preview would observe the revision created by that write.
      if (!attempt?.unknownResult || attempt.inputSignature !== inputSignature) {
        let currentPreview = preview;
        if (collaborationEnabled) {
          const pendingPreview = loadPreview(true, collaboration, true);
          const preflightOperation = operationRef.current;
          const refreshed = await pendingPreview;
          if (!refreshed || !sessionActiveRef.current || operationRef.current !== preflightOperation) return;
          currentPreview = refreshed;
        }
        const currentMissingInput = collaborationEnabled ? currentPreview.inputs.find((field) => field.required
          && (collaboration.inputValues[field.key] === undefined || collaboration.inputValues[field.key] === '')) : undefined;
        if (currentMissingInput) {
          showConfigurationError(`${t('pageTemplate.composite.requiredInputs')} ${currentMissingInput.label}`, `collaboration-input-${currentMissingInput.key}`);
          return;
        }
        if (collaborationEnabled && currentPreview.issues.length) {
          const issue = currentPreview.issues[0];
          const field = currentPreview.inputs.find((item) => item.key === issue.inputKey);
          const role = currentPreview.roles.find((item) => item.id === issue.roleSlotId);
          const label = field?.label ?? role?.name;
          const message = t(`pageTemplate.composite.issue.${issue.code}`);
          showConfigurationError(label ? `${message} ${label}` : message,
            field ? `collaboration-input-${field.key}` : role ? `role-binding-${role.id}` : undefined);
          return;
        }
        const signature = JSON.stringify([inputSignature, currentPreview.treeRevision]);
        if (attempt?.signature !== signature) {
          attempt = {
            signature, inputSignature, unknownResult: false,
            request: { ...input, expectedTreeRevision: currentPreview.treeRevision, idempotencyKey: `instantiate-${safeUuid()}` },
          };
          idempotencyRef.current = attempt;
        }
      }
      if (!sessionActiveRef.current) return;
      operation = ++operationRef.current;
      controller = new AbortController();
      controllerRef.current = controller;
      dispatchPhase({ type: 'submit' });
      setError(null);
      const created = await instantiateCompositeTemplate(spaceId, selectedComposite.id, attempt.request, controller.signal);
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
      if (sessionActiveRef.current && controller && !controller.signal.aborted && operationRef.current === operation) {
        const response = (reason as { response?: unknown } | null)?.response;
        if (idempotencyRef.current) idempotencyRef.current.unknownResult = !response;
        setError(response
          ? apiErrorMessage(reason, t, 'pageTemplate.composite.createFailed')
          : t('pageTemplate.composite.unknownResult'));
        dispatchPhase({ type: 'fail', collaborationEnabled });
      }
    } finally {
      if (controller && controllerRef.current === controller) controllerRef.current = null;
      submittingRef.current = false;
    }
  };

  const close = () => {
    if (legacyCreating || markdownImporting) return;
    if (!pageMode || submittingRef.current) cancelPendingOperation();
    onClose();
  };

  const phaseLabel = phase === 'select' ? t('pageTemplate.step.choose')
    : phase === 'legacy-details' ? t('pageTemplate.step.details')
      : phase === 'configure' ? t('pageTemplate.composite.configure')
        : phase === 'submitting' ? t('pageTemplate.composite.submitting')
      : phase === 'result' ? t('pageTemplate.composite.result')
            : t('pageTemplate.composite.preview');

  const switchMethod = (next: typeof method) => {
    if (legacyCreating || phase === 'submitting' || next === method) return;
    if (userEditedRef.current && !window.confirm(t('creation.switchWarning'))) return;
    userEditedRef.current = false;
    setTitle('');
    operationRef.current += 1;
    controllerRef.current?.abort();
    setPreviewLoading(false);
    setMethod(next);
    setKindFilter(next === 'blank' ? 'all' : next);
    setCatalogOffset(0);
    setNextCatalogOffset(0);
    setSearch('');
    setRootName('');
    setSelected({ source: 'blank' });
    setCollaborationEnabled(false);
    setPreview(null);
    setError(null);
    dispatchPhase({ type: 'reset', blank: next === 'blank' });
  };
  const content = <>
    {validationToast ? <Toast kind="error" message={validationToast} onClose={() => setValidationToast(null)} /> : null}
    {pageMode ? <div className="template-context-row">
      <button ref={closeButtonRef} type="button" onClick={close} disabled={legacyCreating || markdownImporting || phase === 'submitting'}
        className="template-return"><ArrowLeft size={16} aria-hidden="true" />{t('creation.return')}</button>
      {targetLocation ? <p className="template-destination" data-testid="new-page-folder-hint">
        {t('page.createLocation', { location: targetLocation })}
      </p> : null}
    </div> : null}
    <div className="template-creation-header">
      <div className="min-w-0">{pageMode ? <>
        <h1 id="new-page-dialog-title" className="text-2xl font-semibold text-gray-900">{t('creation.title')}</h1>
        <p className="mt-2 text-sm text-gray-500">{t('creation.description')}</p>
      </> : <><h2 id="new-page-dialog-title" className="text-xl font-semibold text-gray-900">{t('page.createTitle')}</h2>
        <p className="mt-1 text-sm text-gray-500">{phaseLabel}</p></>}</div>
      {!pageMode ? <button ref={closeButtonRef} type="button" aria-label={t('common.close')} disabled={legacyCreating || markdownImporting} onClick={close}
        className="template-close"><X size={20} /></button> : null}
    </div>
    <div className="flex justify-end">
      <button type="button" className="template-button" disabled={legacyCreating || markdownImporting || phase === 'submitting' || phase === 'result'} onClick={() => markdownInputRef.current?.click()}>
        <FilePlus2 size={15} aria-hidden="true" />{markdownImporting ? t('common.loading') : `${t('source.uploadFile')} · ${t('editor.markdown')}`}
      </button>
      <input ref={markdownInputRef} type="file" accept=".md,.markdown,text/markdown" aria-label={t('source.uploadFile')} className="sr-only" onChange={(event) => void importMarkdown(event)} />
    </div>
    {!pageMode && targetLocation ? <p className="template-destination" data-testid="new-page-folder-hint">
      {t('page.createLocation', { location: targetLocation })}
    </p> : null}
    <div className={pageMode ? "template-creation-layout" : "template-dialog-body"}>
    {pageMode ? <nav aria-label={t('creation.methods')} className="template-methods">
      {([['blank', FilePlus2], ['single_page', LayoutTemplate], ['page_group', Files]] as const).map(([value, Icon]) => <button key={value}
        type="button" aria-pressed={method === value} onClick={() => switchMethod(value)} disabled={legacyCreating || phase === 'submitting' || phase === 'result'}
        className="template-method">
        <Icon size={16} aria-hidden="true" />{t(`creation.method.${value}`)}</button>)}
    </nav> : null}
    <div className="min-w-0">
    {phase === 'select' ? <SelectPhase
      pageMode={pageMode}
      search={search}
      onSearch={(value) => { setCatalogOffset(0); setNextCatalogOffset(0); setSearch(value); }}
      selected={selected}
      scopeFilter={scopeFilter}
      kindFilter={kindFilter}
      loading={currentCatalog.status === 'loading'}
      failed={currentCatalog.status === 'error'}
      canManage={canManage}
      compositeDisabled={currentCatalog.status === 'legacy' && currentCatalog.compositeDisabled}
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
      canContinue={canContinueFromSelect && (!pageMode || selected.source !== 'blank')}
      onNext={nextFromSelect}
    /> : null}

    {phase === 'legacy-details' ? <form onSubmit={createLegacy} className="template-details">
      <div className="template-details-layout">
      <SelectedSummary name={selectedLegacy?.name ?? t('pageTemplate.blank.name')}
        description={selectedLegacy?.description ?? t('pageTemplate.blank.description')}
        version={selectedLegacy?.currentVersion} />
      <div className="template-details-main">
      <label className="mt-4 block text-sm font-medium text-gray-800">{t('common.title')}
        <input data-modal-autofocus autoFocus type="text" required value={title}
          onChange={(event) => { userEditedRef.current = true; setTitle(truncateValidatorLength(event.target.value, PAGE_TITLE_LIMIT)); }}
          placeholder={t('page.titlePlaceholder')}
          className="template-name-input" />
      </label>
      {folderId && !targetLocation ? <p className="mt-4 text-xs text-gray-500" data-testid="new-page-folder-hint">
        {t('page.intoCurrentFolder')}
      </p> : null}
      <ErrorNotice message={error} />
      </div></div>
      <WizardActions hideBack={pageMode && method === 'blank'} backDisabled={legacyCreating} onBack={() => { focusCloseAfterBackRef.current = true; dispatchPhase({ type: 'back' }); }}>
        <button type="button" disabled={legacyCreating} onClick={onClose} className="template-button">{t('common.cancel')}</button>
        <button type="submit" disabled={legacyCreating || !title.trim()} className="template-button template-button-primary">
          {legacyCreating ? t('common.creating') : t('common.create')}</button>
      </WizardActions>
    </form> : null}

    {phase === 'preview' ? <section className="template-details">
      <div className="template-details-layout">
      <SelectedSummary name={selectedComposite?.name ?? ''} description={selectedComposite?.description ?? ''} version={selectedComposite?.currentVersion} />
      <div className="template-details-main">
      <label className="block text-sm font-medium text-gray-800">{t(pageMode ? (selectedComposite?.kind === 'page_group' ? 'creation.groupName' : 'common.title') : 'pageTemplate.composite.rootName')}
        <input ref={previewNameRef} type="text" value={rootName} disabled={previewLoading}
          onChange={(event) => {
            userEditedRef.current = true;
            setRootName(truncateValidatorLength(event.target.value, PAGE_TITLE_LIMIT));
            setPreviewStale(true);
            idempotencyRef.current = null;
          }}
          onBlur={() => { if (previewStale && !previewLoading) void loadPreview(collaborationEnabled); }}
          className="template-name-input" />
      </label>
      <div className="template-structure">
      <h3 className="template-section-label">{language === 'zh-CN' ? '内容结构' : 'Content structure'}</h3>
      {previewLoading ? <p role="status" className="text-sm text-gray-500">{t('common.loading')}</p>
        : preview ? <TemplateTreePreview nodes={preview.nodes} emptyLabel={t('pageTemplate.composite.treeEmpty')} /> : null}
      </div>
      {previewStale ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('pageTemplate.composite.previewStale')}</p> : null}
      {(!pageMode || selectedComposite?.effectiveSupportsCollaboration) ? <label className="template-collaboration-option">
        <input type="checkbox" aria-label={t('pageTemplate.composite.enable')} checked={collaborationEnabled} disabled={!selectedComposite?.effectiveSupportsCollaboration || previewLoading || previewStale}
          onChange={(event) => {
            userEditedRef.current = true;
            const enabled = event.target.checked;
            setCollaborationEnabled(enabled);
            idempotencyRef.current = null;
            void loadPreview(enabled);
          }} />
        <span>{t('pageTemplate.composite.enable')}<small>{language === 'zh-CN' ? '继续配置参与者与协作任务' : 'Configure participants and tasks in the next step'}</small></span>
      </label> : null}
      <IssueList issues={(preview?.issues ?? []).filter((issue) => !/^(ROLE_BINDING_|COLLABORATION_|PAGE_ROLE_)/.test(issue.code))} />
      <ErrorNotice message={error} />
      </div></div>
      <WizardActions onBack={() => { focusCloseAfterBackRef.current = true; dispatchPhase({ type: 'back' }); }}>
        <button type="button" onClick={onClose} className="template-button">{t('common.cancel')}</button>
        {collaborationEnabled ? <button type="button" disabled={!preview || previewStale} onClick={() => dispatchPhase({ type: 'configure' })}
          className="template-button template-button-primary">{t('pageTemplate.next')}</button>
          : <button type="button" disabled={!preview || previewLoading || previewStale} onClick={() => void createComposite()}
            className="template-button template-button-primary">{selectedComposite?.kind === 'page_group' ? t('pageTemplate.composite.createGroup') : t('common.create')}</button>}
      </WizardActions>
    </section> : null}

    {phase === 'configure' && preview ? <section ref={configureRef} className="template-configure">
      <div className="template-configure-heading"><h2>{t('pageTemplate.composite.configure')}</h2><p>{selectedComposite?.name}</p></div>
      <CollaborationSettingsPanel spaceId={spaceId} roles={preview.roles} inputs={preview.inputs} tasks={preview.tasks}
        agents={members} bindings={collaboration.bindings} inputValues={collaboration.inputValues}
        enabledTaskNodeIds={collaboration.enabledTaskNodeIds} participants={preview.participants}
        onRefreshAgents={async () => {
          const nextMembers = await collaborationApi.listMembers(spaceId);
          if (sessionActiveRef.current) setMembers(nextMembers);
          return nextMembers;
        }}
        onChange={(value) => { if (submittingRef.current) cancelPendingOperation(); userEditedRef.current = true; setCollaboration(value); setError(null); setValidationToast(null); idempotencyRef.current = null; }} />
      <div ref={configureIssuesRef} tabIndex={-1}><IssueList issues={preview.issues} /></div>
      <ErrorNotice message={error} />
      <WizardActions onBack={() => { cancelPendingOperation(); setError(null); dispatchPhase({ type: 'back' }); }}>
        <button ref={refreshParticipantsButtonRef} type="button" disabled={previewLoading} onClick={() => {
          restoreRefreshFocusRef.current = true;
          void loadPreview(true);
        }} className="template-button">
          {previewLoading ? t('common.loading') : t('pageTemplate.composite.refreshParticipants')}</button>
        <button type="button" onClick={() => void createComposite()} disabled={previewLoading}
          className="template-button template-button-primary">{t('pageTemplate.composite.createAndStart')}</button>
      </WizardActions>
    </section> : null}

    {phase === 'submitting' ? <div className="mt-8 rounded-[14px] border bg-gray-50 p-6 text-center"><p role="status" className="text-sm text-gray-700">{t('pageTemplate.composite.submitting')}</p></div> : null}

    {phase === 'result' && result && selectedComposite ? <ResultPhase spaceId={spaceId} result={result} template={selectedComposite}
      instructions={instructions} error={error} onOpen={() => finish({
        firstPageId: result.pageIds[0] ?? null,
        rootFolderId: result.rootFolderId,
        pageIds: result.pageIds,
        runId: result.runId,
      })} /> : null}
    </div></div>
  </>;
  return pageMode ? <div className="creation-page template-creation template-creation-page">{content}</div> : <ModalDialog
    labelledBy="new-page-dialog-title" onRequestClose={close} closeDisabled={legacyCreating} returnFocusTo={returnFocusTo}
    className="template-creation template-creation-dialog">
    {content}
  </ModalDialog>;
};

const SelectPhase: React.FC<{
  pageMode?: boolean;
  search: string;
  onSearch: (value: string) => void;
  selected: SelectedTemplate;
  scopeFilter: ScopeFilter;
  kindFilter: KindFilter;
  loading: boolean;
  failed: boolean;
  canManage: boolean;
  compositeDisabled: boolean;
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
}> = ({ pageMode = false, search, onSearch, selected, scopeFilter, kindFilter, loading, failed, canManage, compositeDisabled, spaceId, compositeTemplates, legacyTemplates,
  hasMore, loadingMore, onScopeFilter, onKindFilter, onLoadMore, onBlank, onComposite, onLegacy, onRetry, onClose, canContinue, onNext }) => {
  const { t } = useLanguage();
  const selectedTemplate = selected.source !== 'blank' && canContinue ? selected.value
    : !pageMode && selected.source === 'blank' && canContinue ? {
      name: t('pageTemplate.blank.name'), description: t('pageTemplate.blank.description'), currentVersion: undefined,
    } : null;
  const hasTemplates = compositeTemplates.length > 0 || legacyTemplates.length > 0;
  return <>
    <div className="template-catalog-toolbar">
      <label className="template-search"><span className="sr-only">{t('pageTemplate.search')}</span>
        <Search size={16} aria-hidden="true" />
        <input type="search" value={search} placeholder={t('pageTemplate.search')} onChange={(event) => onSearch(event.target.value)} />
      </label>
      {pageMode ? <label className="template-source"><span className="sr-only">{t('creation.source')}</span>
        <select aria-label={t('creation.source')} value={scopeFilter} onChange={(event) => onScopeFilter(event.target.value as ScopeFilter)}>
          {SCOPE_FILTERS.map((scope) => <option key={scope} value={scope}>{t(`creation.source.${scope}`)}</option>)}
        </select>
      </label> : <div role="group" aria-label={t('pageTemplate.step.choose')} className="template-filter-group">
        {SCOPE_FILTERS.map((filter) => <FilterButton key={filter} active={scopeFilter === filter}
          onClick={() => onScopeFilter(filter)}>{t(`pageTemplate.filter.${filter}`)}</FilterButton>)}
      </div>}
    </div>
    {!pageMode ? <div role="group" aria-label={t('pageTemplate.composite.kind.all')} className="template-kind-tabs">
      {KIND_FILTERS.map((filter) => <FilterButton key={filter} active={kindFilter === filter}
        onClick={() => onKindFilter(filter)}>{t(`pageTemplate.composite.kind.${filter}`)}</FilterButton>)}
    </div> : null}
    {failed ? <div role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><span>{t('pageTemplate.loadFailed')}</span>{' '}
      <button type="button" onClick={onRetry} className="min-h-9 px-2 font-medium underline">{t('pageTemplate.retry')}</button></div> : null}
    {compositeDisabled ? <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
      {t('pageTemplate.composite.rolloutFallback')}
    </p> : null}
    {loading ? <p role="status" className="template-loading">{t('common.loading')}</p> : null}
    <div className="template-catalog-layout">
      <div className="template-catalog-main">
        <div role="group" aria-label={t('pageTemplate.step.choose')} className="template-catalog-list">
          {!pageMode && kindFilter !== 'page_group' ? <TemplateButton name={t('pageTemplate.blank.name')} description={t('pageTemplate.blank.description')}
            scopeLabel={t('pageTemplate.scope.blank')} selected={selected.source === 'blank'} foundation onClick={onBlank} /> : null}
          {compositeTemplates.map((template) => <TemplateButton key={template.id} name={template.name} description={template.description}
            category={t(`pageTemplate.category.${template.category}`)} scopeLabel={t(pageMode && template.scope === 'space' ? 'creation.source.space' : `pageTemplate.scope.${template.scope}`)}
            selected={selected.source === 'composite' && selected.value.id === template.id} kind={template.kind}
            meta={`${t('pageTemplate.composite.pages', { count: template.pageCount })} · ${t('pageTemplate.composite.folders', { count: template.folderCount })}`}
            onClick={() => onComposite(template)} />)}
          {legacyTemplates.map((template) => <TemplateButton key={template.id} name={template.name} description={template.description}
            category={t(`pageTemplate.category.${template.category}`)} scopeLabel={t(pageMode && template.scope === 'space' ? 'creation.source.space' : `pageTemplate.scope.${template.scope}`)}
            selected={selected.source === 'legacy' && selected.value.id === template.id} onClick={() => onLegacy(template)} />)}
        </div>
        {!loading && !failed && !hasTemplates ? <p className="template-empty">{t(scopeFilter === 'space' ? 'creation.emptySpace' : 'creation.empty')}</p> : null}
        {hasMore ? <button type="button" disabled={loadingMore} onClick={onLoadMore}
          className="template-load-more">{loadingMore ? t('common.loading') : t('pageTemplate.composite.loadMore')}</button> : null}
      </div>
      <aside className={`template-selection ${selectedTemplate ? 'has-selection' : ''}`}>
        <h2 className="template-section-label">{t('creation.selection')}</h2>
        {selectedTemplate ? <>
          <span className="template-selection-icon" aria-hidden="true">{selected.source === 'composite' && selected.value.kind === 'page_group' ? <Files size={22} /> : <FileText size={22} />}</span>
          <p className="template-selection-title">{selectedTemplate.name}</p>
          <p className="template-selection-description">{selectedTemplate.description}</p>
          {selected.source === 'composite' ? <div className="template-selection-stats">
            <span><FileText size={14} aria-hidden="true" />{t('pageTemplate.composite.pages', { count: selected.value.pageCount })}</span>
            <span><Folder size={14} aria-hidden="true" />{t('pageTemplate.composite.folders', { count: selected.value.folderCount })}</span>
          </div> : null}
          <p className="template-selection-version">{selectedTemplate.currentVersion ? t('pageTemplate.version.number', { version: selectedTemplate.currentVersion }) : t('pageTemplate.version.blank')}</p>
        </> : <div className="template-selection-placeholder"><LayoutTemplate size={28} strokeWidth={1.3} aria-hidden="true" /><p>{t('creation.selectHint')}</p></div>}
      </aside>
    </div>
    <div className="creation-actions template-actions">
      {canManage ? <Link to={`/spaces/${spaceId}/settings/page-templates`} className="template-manage-link">{t('pageTemplate.manage')}</Link> : <span />}
      <div className="template-action-buttons"><button type="button" onClick={onClose} className="template-button">{t('common.cancel')}</button>
        <button type="button" disabled={!canContinue} onClick={onNext} className="template-button template-button-primary">{t('pageTemplate.next')}<ArrowRight size={14} aria-hidden="true" /></button></div>
    </div>
  </>;
};

const FilterButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => <button
  type="button" aria-pressed={active} onClick={onClick} className="template-filter">{children}</button>;

const TemplateButton: React.FC<{
  name: string; description: string; category?: string; scopeLabel: string; selected: boolean; meta?: string; foundation?: boolean; kind?: CompositeTemplateKind; onClick: () => void;
}> = ({ name, description, category, scopeLabel, selected, meta, foundation = false, kind = 'single_page', onClick }) => {
  const { t } = useLanguage();
  const Icon = foundation ? FilePlus2 : kind === 'page_group' ? Files : FileText;
  return <button type="button" aria-pressed={selected} onClick={onClick} className="template-catalog-item">
    <span className="template-item-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.6} /></span>
    <span className="template-item-content">
      <span className="template-item-heading"><span className="template-item-name">{name}</span><span className="template-item-scope">{scopeLabel}</span></span>
      <span className="template-item-description">{description}</span>
      <span className="template-item-meta">{category ? <span>{category}</span> : null}{meta ? <span>{meta}</span> : null}</span>
    </span>
    <span className="template-item-check">{selected ? <><Check size={16} aria-hidden="true" /><span className="sr-only">{t('pageTemplate.selected')}</span></> : null}</span>
  </button>;
};

const SelectedSummary: React.FC<{ name: string; description: string; version?: number }> = ({ name, description, version }) => {
  const { t } = useLanguage();
  return <aside className="template-summary"><p className="template-section-label">{t('pageTemplate.selected')}</p>
    <p className="template-selection-title">{name}</p><p className="template-selection-description">{description}</p>
    <p className="template-selection-version">{version ? t('pageTemplate.version.number', { version }) : t('pageTemplate.version.blank')}</p></aside>;
};

const WizardActions: React.FC<{ hideBack?: boolean; backDisabled?: boolean; onBack: () => void; children: React.ReactNode }> = ({ hideBack = false, backDisabled = false, onBack, children }) => {
  const { t } = useLanguage();
  return <div className="creation-actions template-actions">{hideBack ? <span /> : <button type="button" disabled={backDisabled} onClick={onBack}
    className="template-button"><ArrowLeft size={14} aria-hidden="true" />{t('pageTemplate.back')}</button>}<div className="template-action-buttons">{children}</div></div>;
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
      className="template-button template-button-primary">{template.kind === 'page_group' ? t('pageTemplate.composite.openGroup') : t('pageTemplate.composite.openPage')}</button></div>
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
