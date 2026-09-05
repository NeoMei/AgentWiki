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
  getPageAgentBinding,
  previewFolderAgentBindings,
  setFolderAgentBindings,
  setPageAgentBinding,
  startExistingFolderRun,
  startExistingPageRun,
} from './compositeTemplateApi';
import type { PageAgentBindingSnapshot } from './compositeTemplateTypes';

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
  const [agentId, setAgentId] = useState('');
  const [startNow, setStartNow] = useState(false);
  const [result, setResult] = useState<{ runId: string; instructions: AgentInstruction[] } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const signatureRef = useRef<{ value: string; key: string } | null>(null);
  const scopeKind = scope.kind;
  const scopeId = scope.kind === 'page' ? scope.pageId : scope.folderId;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true); setError(null); setResult(null);
    const snapshot = scopeKind === 'page'
      ? Promise.all([getPageAgentBinding(spaceId, scopeId), getContentTreeRevision(spaceId, controller.signal)])
        .then(([page, revision]) => ({ pages: [page], treeRevision: revision }))
      : previewFolderAgentBindings(spaceId, scopeId, undefined, controller.signal);
    void Promise.all([snapshot, collaborationApi.listMembers(spaceId)]).then(([binding, members]) => {
      if (!active || controller.signal.aborted) return;
      setPages(binding.pages); setTreeRevision(binding.treeRevision); setAgents(members);
      const existing = binding.pages.find((page) => page.agentId)?.agentId;
      setAgentId(existing ?? '');
    }).catch((reason) => {
      if (active && !controller.signal.aborted) setError(apiErrorMessage(reason, t, 'pageTemplate.binding.loadFailed'));
    }).finally(() => { if (active && !controller.signal.aborted) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [scopeId, scopeKind, spaceId, t]);

  const availability = useMemo(() => new Map(agents.flatMap((member) => member.agentId && member.agent
    ? [[member.agentId, member.agent.status === 'active' && !member.agent.revokedAt && (member.role === 'editor' || member.role === 'publisher')] as const]
    : [])), [agents]);
  const selectedAgent = agents.find((member) => member.agentId === agentId);

  const edits = () => pages.map((page) => ({
    pageId: page.pageId, agentId: agentId || null, roleSlotKey: agentId ? 'owner' : null, expectedUpdatedAt: page.updatedAt,
  }));
  const idempotencyKey = () => {
    const signature = JSON.stringify([spaceId, scope, pages, agentId, startNow]);
    if (signatureRef.current?.value !== signature) signatureRef.current = { value: signature, key: `bind-${safeUuid()}` };
    return signatureRef.current.key;
  };

  const submit = async () => {
    if (busy || !treeRevision || (!agentId && startNow)) return;
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
            source: { kind: 'page_selection' }, pageIds: pages.map((page) => page.pageId), collaborationInputs: {}, bindings: [],
            bindingEdits: edits(), roleSlotsByPage: pages.map((page) => ({ pageId: page.pageId, roleSlotKey: 'owner' })),
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
        <ul className="mt-2 space-y-1 text-sm">{pages.map((page) => <li key={page.pageId} className="flex flex-wrap justify-between gap-2"><span>{page.title ?? page.pageId}</span><span className="text-gray-500">{page.updatedAt ?? t('pageTemplate.binding.unbound')}</span></li>)}</ul>
      </div>
      {result ? <section className="mt-5"><h3 className="text-lg font-semibold">{t('pageTemplate.binding.runStarted')}</h3>
        <p className="mt-1 text-sm text-amber-800">{t('pageTemplate.composite.agentsNeedWake')}</p>
        <div className="mt-3 space-y-3">{result.instructions.map((instruction) => <article key={instruction.agentId} className="rounded-lg border p-3"><pre className="whitespace-pre-wrap break-words text-xs">{instruction.text}</pre>
          <button type="button" onClick={() => void navigator.clipboard.writeText(instruction.text)} className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm"><Copy size={14} />{t('common.copy')}</button></article>)}</div>
        <Link to={`/spaces/${spaceId}/collaboration/runs/${result.runId}`} className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white">{t('collaboration.wizard.openRun')}</Link>
      </section> : <>
        <label className="mt-5 block text-sm font-medium">{t('pageTemplate.binding.primaryAgent')}
          <select aria-label={t('pageTemplate.binding.primaryAgent')} value={agentId} onChange={(event) => { setAgentId(event.target.value); signatureRef.current = null; }} className="mt-1 h-10 w-full rounded-lg border px-3">
            <option value="">{t('pageTemplate.binding.none')}</option>
            {agents.flatMap((member) => member.agentId && member.agent ? [<option key={member.agentId} value={member.agentId} disabled={!availability.get(member.agentId)}>{member.agent.name}{availability.get(member.agentId) ? '' : ` — ${member.role === 'reader' ? t('pageTemplate.composite.agentReader') : t('pageTemplate.composite.agentInactive')}`}</option>] : [])}
          </select>
        </label>
        {selectedAgent?.agent ? <p className="mt-2 text-sm text-gray-500">{selectedAgent.agent.name} · {selectedAgent.agent.connected ? t('pageTemplate.binding.connected') : t('pageTemplate.binding.notConnected')}</p> : null}
        <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={startNow} disabled={!agentId} onChange={(event) => { setStartNow(event.target.checked); signatureRef.current = null; }} />{t('pageTemplate.binding.startNow')}</label>
        <p className="mt-2 text-xs text-gray-500">{t('pageTemplate.binding.distinction')}</p>
      </>}
    </> : null}
    {error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    {!loading && !result ? <div className="mt-6 flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={close} className="min-h-10 rounded-lg border px-4 text-sm">{t('common.cancel')}</button>
      <button type="button" disabled={busy || !treeRevision} onClick={() => void submit()} className="min-h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? t('common.saving') : startNow ? t('pageTemplate.binding.saveAndStart') : t('pageTemplate.binding.save')}</button></div> : null}
  </ModalDialog>;
};

function safeUuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
