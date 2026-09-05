import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getContentTreeRevision } from '../../api/content-tree';
import { apiErrorMessage } from '../../api/error-message';
import { ModalDialog } from '../../components/ModalDialog';
import { useLanguage } from '../../context/LanguageContext';
import { collaborationApi } from '../collaboration/api';
import { buildAgentJoinInstructions } from '../collaboration/agentJoinInstructions';
import type { AgentInstruction, SpaceMemberSummary } from '../collaboration/types';
import {
  deletePageAgentBinding,
  discoverFolderCollaborationSource,
  getPageAgentBinding,
  previewExistingFolderRun,
  previewFolderAgentBindings,
  setFolderAgentBindings,
  setPageAgentBinding,
  startExistingFolderRun,
  startExistingPageRun,
} from './compositeTemplateApi';
import type { ExistingRunPreview, FolderCollaborationSource, PageAgentBindingSnapshot } from './compositeTemplateTypes';

export type BindingDialogScope =
  | { kind: 'page'; pageId: string; title: string }
  | { kind: 'folder'; folderId: string; name: string };

export const PageAgentBindingDialog: React.FC<{
  spaceId: string;
  scope: BindingDialogScope;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  onSaved: () => void;
}> = ({ spaceId, scope, returnFocusTo, onClose, onSaved }) => {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<SpaceMemberSummary[]>([]);
  const [pages, setPages] = useState<PageAgentBindingSnapshot[]>([]);
  const [treeRevision, setTreeRevision] = useState<string | null>(null);
  const [folderSource, setFolderSource] = useState<FolderCollaborationSource['source']>(null);
  const [folderRunSource, setFolderRunSource] = useState<'template_instantiation' | 'page_selection'>('page_selection');
  const [agentId, setAgentId] = useState('');
  const [startNow, setStartNow] = useState(false);
  const [result, setResult] = useState<{ runId: string; instructions: AgentInstruction[] } | null>(null);
  const [runPreview, setRunPreview] = useState<ExistingRunPreview | null>(null);
  const [runPreviewBusy, setRunPreviewBusy] = useState(false);
  const [runPreviewSignature, setRunPreviewSignature] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const previewRequest = useRef(0);
  const signatureRef = useRef<{ value: string; key: string } | null>(null);
  const scopeKind = scope.kind;
  const scopeId = scope.kind === 'page' ? scope.pageId : scope.folderId;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true); setError(null); setResult(null); setRunPreview(null); setRunPreviewSignature(null);
    const snapshot = scopeKind === 'page'
      ? Promise.all([getPageAgentBinding(spaceId, scopeId), getContentTreeRevision(spaceId, controller.signal)])
        .then(([page, revision]) => ({ pages: [page], treeRevision: revision, source: null }))
      : discoverFolderCollaborationSource(spaceId, scopeId, controller.signal).then(async ({ source }) => {
        const sourcePageIds = source?.nodes.flatMap((node) => node.kind === 'page' && node.pageId ? [node.pageId] : []);
        const binding = await previewFolderAgentBindings(spaceId, scopeId, sourcePageIds, controller.signal);
        return { ...binding, source };
      });
    void Promise.all([snapshot, collaborationApi.listMembers(spaceId)]).then(([binding, members]) => {
      if (!active || controller.signal.aborted) return;
      setPages(binding.pages); setTreeRevision(binding.treeRevision); setFolderSource(binding.source);
      setFolderRunSource(binding.source ? 'template_instantiation' : 'page_selection'); setAgents(members);
      const existing = binding.pages.find((page) => page.agentId)?.agentId;
      setAgentId(existing ?? '');
    }).catch((reason) => {
      if (active && !controller.signal.aborted) setError(apiErrorMessage(reason, t, 'pageTemplate.binding.loadFailed'));
    }).finally(() => { if (active && !controller.signal.aborted) setLoading(false); });
    return () => { active = false; previewRequest.current += 1; controller.abort(); };
  }, [scopeId, scopeKind, spaceId, t]);

  const availability = useMemo(() => new Map(agents.flatMap((member) => member.agentId && member.agent
    ? [[member.agentId, member.agent.status === 'active' && !member.agent.revokedAt && (member.role === 'editor' || member.role === 'publisher')] as const]
    : [])), [agents]);
  const agentNames = useMemo(() => new Map(agents.flatMap((member) => member.agentId && member.agent
    ? [[member.agentId, member.agent.name] as const]
    : [])), [agents]);
  const selectedAgent = agents.find((member) => member.agentId === agentId);

  const edits = () => pages.map((page) => ({
    pageId: page.pageId, agentId: agentId || null, roleSlotKey: agentId ? 'owner' : null, expectedUpdatedAt: page.updatedAt,
  }));
  const folderRunPayload = () => ({
    source: folderSource && folderRunSource === 'template_instantiation'
      ? { kind: 'template_instantiation' as const, sourceInstantiationId: folderSource.sourceInstantiationId }
      : { kind: 'page_selection' as const },
    pageIds: uniqueIds(pages.map((page) => page.pageId)),
    collaborationInputs: {},
    bindings: [],
    bindingEdits: edits(),
    roleSlotsByPage: pages.map((page) => ({ pageId: page.pageId, roleSlotKey: agentId ? 'owner' : null })),
  });
  const currentRunPreviewSignature = () => JSON.stringify(folderRunPayload());
  const invalidateRunPreview = () => {
    previewRequest.current += 1;
    controllerRef.current?.abort();
    setRunPreviewBusy(false);
    setRunPreview(null);
    setRunPreviewSignature(null);
  };
  const previewFolderRun = async () => {
    if (scope.kind !== 'folder' || !startNow || !agentId || runPreviewBusy) return;
    const request = ++previewRequest.current;
    const requestedSignature = currentRunPreviewSignature();
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setRunPreviewBusy(true);
    setError(null);
    try {
      const preview = await previewExistingFolderRun(
        spaceId, scope.folderId, folderRunPayload(), controller.signal,
      );
      if (controller.signal.aborted || previewRequest.current !== request) return;
      setRunPreview(preview);
      setRunPreviewSignature(requestedSignature);
    } catch (reason) {
      if (!controller.signal.aborted && previewRequest.current === request) {
        setError(apiErrorMessage(reason, t, 'pageTemplate.binding.previewFailed'));
      }
    } finally {
      if (!controller.signal.aborted && previewRequest.current === request) setRunPreviewBusy(false);
    }
  };
  const idempotencyKey = () => {
    const signature = JSON.stringify([spaceId, scope, pages, agentId, startNow, folderRunSource]);
    if (signatureRef.current?.value !== signature) signatureRef.current = { value: signature, key: `bind-${safeUuid()}` };
    return signatureRef.current.key;
  };

  const submit = async () => {
    if (busy || !treeRevision || (!agentId && startNow)
      || (scope.kind === 'folder' && startNow
        && (!runPreview || runPreviewSignature !== currentRunPreviewSignature() || runPreview.issues.length > 0))) return;
    const controller = new AbortController(); controllerRef.current = controller;
    setBusy(true); setError(null);
    try {
      if (startNow) {
        const name = scope.kind === 'page' ? scope.title : scope.name;
        const run = scope.kind === 'page'
          ? await startExistingPageRun(spaceId, scope.pageId, {
            name, collaborationInputs: {}, bindings: [], bindingEdits: edits(), roleSlotKey: 'owner',
            expectedTreeRevision: treeRevision, idempotencyKey: idempotencyKey(),
          }, controller.signal)
          : await startExistingFolderRun(spaceId, scope.folderId, {
            ...folderRunPayload(),
            name, expectedTreeRevision: treeRevision, idempotencyKey: idempotencyKey(),
          }, controller.signal);
        const detail = await collaborationApi.getRun(spaceId, run.runId);
        if (!controller.signal.aborted) setResult({ runId: run.runId, instructions: buildAgentJoinInstructions(detail) });
      } else if (scope.kind === 'page') {
        const current = pages[0]!;
        if (agentId) await setPageAgentBinding(spaceId, scope.pageId, {
          agentId, roleSlotKey: 'owner', expectedUpdatedAt: current.updatedAt, expectedTreeRevision: treeRevision,
        });
        else await deletePageAgentBinding(spaceId, scope.pageId, { expectedUpdatedAt: current.updatedAt, expectedTreeRevision: treeRevision });
        onSaved(); onClose();
      } else {
        await setFolderAgentBindings(spaceId, scope.folderId, {
          pageIds: pages.map((page) => page.pageId), expectedTreeRevision: treeRevision, edits: edits(),
        });
        onSaved(); onClose();
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(apiErrorMessage(reason, t, 'pageTemplate.binding.saveFailed'));
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };

  const close = () => { controllerRef.current?.abort(); onClose(); };
  const titleId = 'page-agent-binding-dialog-title';
  return <ModalDialog labelledBy={titleId} onRequestClose={close} returnFocusTo={returnFocusTo}
    className="max-h-[calc(100vh-2rem)] w-full min-w-0 max-w-2xl overflow-y-auto rounded-[14px] bg-white p-4 shadow-xl sm:p-6">
    <div className="flex items-start justify-between gap-3"><div><h2 id={titleId} className="text-xl font-semibold">{t('pageTemplate.binding.title')}</h2>
      <p className="mt-1 break-words text-sm text-gray-500">{scope.kind === 'page' ? scope.title : scope.name}</p></div>
      <button type="button" aria-label={t('common.close')} onClick={close} className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-gray-100"><X size={18} /></button></div>
    {loading ? <p role="status" className="mt-5 text-sm text-gray-500">{t('common.loading')}</p> : null}
    {!loading && pages.length ? <>
      <div data-testid="binding-page-scope" className="mt-5 rounded-[14px] border bg-gray-50 p-4"><h3 className="font-medium">{t('pageTemplate.binding.scope')}</h3>
        {scope.kind === 'folder' ? <p className="mt-1 text-xs text-gray-500">{folderSource
          ? t('pageTemplate.binding.exactCompositeSource', { version: folderSource.templateVersion })
          : t('pageTemplate.binding.simplePageSource')}</p> : null}
        <ul className="mt-3 space-y-2 text-sm">{pages.map((page) => <li key={page.pageId} className="min-w-0 rounded-lg border bg-white p-3">
          <p className="break-words font-medium text-gray-900">{page.title ?? page.pageId}</p>
          <p className="mt-1 break-all font-mono text-xs text-gray-500">{page.pageId}</p>
          <dl className="mt-2 grid min-w-0 grid-cols-1 gap-1 text-xs text-gray-600 sm:grid-cols-3">
            <div className="min-w-0"><dt className="font-medium">{t('pageTemplate.binding.currentAgent')}</dt><dd className="break-all">{page.agentId ? agentNames.get(page.agentId) ?? page.agentId : t('pageTemplate.binding.unbound')}</dd></div>
            <div className="min-w-0"><dt className="font-medium">{t('pageTemplate.binding.currentRole')}</dt><dd className="break-all">{page.roleSlotKey ?? t('pageTemplate.binding.unbound')}</dd></div>
            <div className="min-w-0"><dt className="font-medium">{t('pageTemplate.binding.currentVersion')}</dt><dd className="break-all">{page.updatedAt ?? t('pageTemplate.binding.unbound')}</dd></div>
          </dl>
        </li>)}</ul>
      </div>
      {scope.kind === 'folder' && folderSource ? <fieldset className="mt-4 rounded-[14px] border p-4"><legend className="px-1 text-sm font-medium">{t('pageTemplate.binding.runSource')}</legend>
        <label className="mt-2 flex items-start gap-2 text-sm"><input type="radio" name="folder-run-source" value="template_instantiation" checked={folderRunSource === 'template_instantiation'} onChange={() => { setFolderRunSource('template_instantiation'); signatureRef.current = null; invalidateRunPreview(); }} />{t('pageTemplate.binding.useOriginalWorkflow', { version: folderSource.templateVersion })}</label>
        <label className="mt-3 flex items-start gap-2 text-sm"><input type="radio" name="folder-run-source" value="page_selection" checked={folderRunSource === 'page_selection'} onChange={() => { setFolderRunSource('page_selection'); signatureRef.current = null; invalidateRunPreview(); }} />{t('pageTemplate.binding.useSimplePages')}</label>
      </fieldset> : null}
      {result ? <section className="mt-5"><h3 className="text-lg font-semibold">{t('pageTemplate.binding.runStarted')}</h3>
        <p className="mt-1 text-sm text-amber-800">{t('pageTemplate.composite.agentsNeedWake')}</p>
        <div className="mt-3 space-y-3">{result.instructions.map((instruction) => <article key={instruction.agentId} className="rounded-lg border p-3"><pre className="whitespace-pre-wrap break-words text-xs">{instruction.text}</pre>
          <button type="button" onClick={() => void navigator.clipboard.writeText(instruction.text)} className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm"><Copy size={14} />{t('common.copy')}</button></article>)}</div>
        <Link to={`/spaces/${spaceId}/collaboration/runs/${result.runId}`} className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white">{t('collaboration.wizard.openRun')}</Link>
      </section> : <>
        <label className="mt-5 block text-sm font-medium">{t('pageTemplate.binding.primaryAgent')}
          <select aria-label={t('pageTemplate.binding.primaryAgent')} value={agentId} onChange={(event) => { setAgentId(event.target.value); signatureRef.current = null; invalidateRunPreview(); }} className="mt-1 h-10 w-full rounded-lg border px-3">
            <option value="">{t('pageTemplate.binding.none')}</option>
            {agents.flatMap((member) => member.agentId && member.agent ? [<option key={member.agentId} value={member.agentId} disabled={!availability.get(member.agentId)}>{member.agent.name}{availability.get(member.agentId) ? '' : ` — ${member.role === 'reader' ? t('pageTemplate.composite.agentReader') : t('pageTemplate.composite.agentInactive')}`}</option>] : [])}
          </select>
        </label>
        {selectedAgent?.agent ? <p className="mt-2 text-sm text-gray-500">{selectedAgent.agent.name} · {selectedAgent.agent.connected ? t('pageTemplate.binding.connected') : t('pageTemplate.binding.notConnected')}</p> : null}
        <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={startNow} disabled={!agentId} onChange={(event) => { setStartNow(event.target.checked); signatureRef.current = null; invalidateRunPreview(); }} />{t('pageTemplate.binding.startNow')}</label>
        <p className="mt-2 text-xs text-gray-500">{t('pageTemplate.binding.distinction')}</p>
        {scope.kind === 'folder' && startNow ? <section className="mt-4 rounded-[14px] border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">{t('pageTemplate.binding.runPreview')}</h3><p className="mt-1 text-xs text-gray-500">{t('pageTemplate.binding.runPreviewHelp')}</p></div>
            <button type="button" disabled={runPreviewBusy} onClick={() => void previewFolderRun()} className="min-h-10 rounded-lg border px-3 text-sm disabled:opacity-50">{runPreviewBusy ? t('common.loading') : t('pageTemplate.binding.previewRun')}</button></div>
          {runPreview ? <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2"><div><h4 className="text-sm font-medium">{t('pageTemplate.binding.previewTasks')}</h4><ul className="mt-2 space-y-2 text-sm">{runPreview.tasks.map((task) => <li key={task.nodeId} className="rounded-lg bg-gray-50 p-2"><p className="break-words font-medium">{task.name}</p><p className="mt-1 break-all text-xs text-gray-500">{task.nodeId} · {task.roleSlotId}</p></li>)}</ul></div>
            <div><h4 className="text-sm font-medium">{t('pageTemplate.binding.previewParticipants')}</h4><ul className="mt-2 space-y-2 text-sm">{runPreview.participants.map((participant) => <li key={participant} className="break-all rounded-lg bg-gray-50 p-2">{agentNames.get(participant) ?? participant} · {participant}</li>)}</ul></div>
            {runPreview.issues.length ? <div role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700 sm:col-span-2">{t('pageTemplate.binding.previewIssues', { count: runPreview.issues.length })}</div> : null}</div> : null}
        </section> : null}
      </>}
    </> : null}
    {error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    {!loading && !result ? <div className="mt-6 flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={close} className="min-h-10 rounded-lg border px-4 text-sm">{t('common.cancel')}</button>
      <button type="button" disabled={busy || !treeRevision || (scope.kind === 'folder' && startNow && (!runPreview || runPreviewSignature !== currentRunPreviewSignature() || runPreview.issues.length > 0))} onClick={() => void submit()} className="min-h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? t('common.saving') : startNow ? t('pageTemplate.binding.saveAndStart') : t('pageTemplate.binding.save')}</button></div> : null}
  </ModalDialog>;
};

function safeUuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values)];
}
