import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { AssistCandidateReview } from '../page/AssistCandidateReview';
import { applyCandidateToDraft, type AssistCandidate } from '../page/assistCandidate';
import { captureAssistTarget, validateAssistTarget, type AssistTarget } from '../page/assistTargets';
import type { AssistNotesEvent } from '../page/AgentAssistPanel';
import { AgentReferencePicker } from './AgentReferencePicker';
import { bindCandidate, candidateFromTurn } from './agentSessionCandidate';
import { useAgentSession } from './useAgentSession';
import type { AgentSessionPanelProps, AgentTurn } from './agentSessionTypes';

export function AgentSessionPanel({ pageId, spaceId, pageTitle, snapshot, canEdit = false, canAccept = false, onApply, supportsScopedApply = false, assistTargets, assistRequest, onRequestHandled, onNotesEvent, notesReady = true, acceptUnavailableReason }: AgentSessionPanelProps) {
  const { user } = useAuth(), { language } = useLanguage(), zh = language === 'zh-CN';
  const userId = typeof user?.id === 'string' ? user.id : '';
  const session = useAgentSession(userId, spaceId);
  const { store, draft } = session;
  const targetKind = draft.targetKind;
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const scope = `${userId}\u0000${spaceId}\u0000${pageId}`;
  const mountRef = useRef({ scope, token: {} });
  if (mountRef.current.scope !== scope) mountRef.current = { scope, token: {} };
  const mount = mountRef.current.token;
  const live = useRef(true), scopeRef = useRef(scope); scopeRef.current = scope;
  const callbacks = useRef({ onNotesEvent, onRequestHandled }); callbacks.current = { onNotesEvent, onRequestHandled };
  const emitted = useRef(new Map<string, string>());
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { setLocalError(null); emitted.current.clear(); }, [scope]);
  useEffect(() => { if (!session.loading) composerRef.current?.focus(); }, [scope, session.loading]);
  useEffect(() => {
    if (session.loading || !assistRequest || [...store.drafts.values()].some((composer) => composer.staged?.request.id === assistRequest.id)) return;
    session.updateDraft({ intent: assistRequest.intent, targetKind: assistRequest.assistTarget?.kind ?? 'document', staged: { pageId, request: assistRequest } });
  }, [assistRequest?.id, session.loading, session.selected, scope]);
  const emit = (event: AssistNotesEvent['event'], candidate: AssistCandidate, editId?: string, dispatchRequest?: AssistNotesEvent['dispatchRequest']) => {
    if (candidate.noteIds?.length && candidate.pageId === pageId && candidate.userId === userId && candidate.spaceId === spaceId) callbacks.current.onNotesEvent?.({ event, taskId: candidate.taskId, noteIds: candidate.noteIds, candidate, editId, acceptedEditIds: candidate.acceptedEditIds, ...(dispatchRequest ? { dispatchRequest } : {}) });
  };
  const restoreCandidate = (turn: AgentTurn) => {
    const record = candidateFromTurn(turn, userId, spaceId), ledger = store.ledger.get(turn.id);
    if (record && ledger) record.candidate = { ...record.candidate, ...ledger };
    return record;
  };
  // Reconstruct candidates only from canonical historical snapshots; never resurrect a local terminal ledger.
  for (const turn of session.detail?.turns ?? []) {
    const existing = store.candidates.get(turn.id);
    if (!existing || existing.candidate.status === 'generating') {
      const record = restoreCandidate(turn);
      if (record) { if (existing) record.mount = existing.mount; store.candidates.set(turn.id, record); }
    }
  }
  useEffect(() => {
    if (!notesReady) return;
    for (const turn of session.detail?.turns ?? []) {
      const candidate = store.candidates.get(turn.id)?.candidate;
      if (!candidate || candidate.pageId !== pageId || candidate.status === 'generating') continue;
      const key = `${candidate.status}:${candidate.acceptedEditIds?.join(',') ?? ''}`;
      if (emitted.current.get(turn.id) === key) continue;
      emitted.current.set(turn.id, key);
      if (candidate.status === 'ready' || candidate.status === 'accepted') emit('ready', candidate);
      if (candidate.status === 'failed') emit('fail', candidate);
    }
  }, [session.detail, scope, store, notesReady]);
  useEffect(() => { if (!canEdit && draft.mode !== 'question') session.updateDraft({ mode: 'question' }); }, [canEdit, draft.mode, store]);
  const current = () => ({ ...snapshot(), userId, spaceId, pageId, canEdit });
  const accept = (id: string, editId?: string) => {
    const record = store.candidates.get(id);
    if (!record || !canAccept || !canEdit || record.candidate.pageId !== pageId || (record.candidate.assistTarget && !supportsScopedApply)) return;
    const liveSnapshot = current(), candidate = bindCandidate(record, liveSnapshot, mount);
    const application = applyCandidateToDraft(candidate, liveSnapshot, editId);
    if (application.status !== 'applied' || onApply?.(candidate, editId) !== true) { record.candidate = { ...candidate, status: 'conflict' }; emit('fail', record.candidate); }
    else {
      const complete = !candidate.editPlan || application.acceptedEditIds.length === candidate.editPlan.edits.length;
      record.candidate = { ...candidate, status: complete ? 'accepted' : 'ready', acceptedEditIds: application.acceptedEditIds };
      emit('accept', record.candidate, editId);
    }
    store.ledger.set(id, { status: record.candidate.status, acceptedEditIds: record.candidate.acceptedEditIds });
    store.set({ revision: store.get().revision + 1 });
  };
  const discard = (id: string) => {
    const record = store.candidates.get(id);
    if (!record || record.candidate.status === 'accepted' || record.candidate.status === 'discarded') return;
    record.candidate = { ...record.candidate, status: 'discarded' }; store.ledger.set(id, { status: 'discarded', acceptedEditIds: record.candidate.acceptedEditIds }); emit('discard', record.candidate); store.set({ revision: store.get().revision + 1 });
  };
  const submit = async () => {
    if (!draft.intent.trim() || session.sending || session.running || session.loading || !userId || (draft.mode === 'proposal' && !canEdit)) return;
    const staged = draft.staged;
    if (staged && staged.pageId !== pageId) { setLocalError(zh ? '请返回批注所属页面发送，或移除附件。' : 'Return to the annotation page before sending, or remove the attachment.'); return; }
    const source = { ...snapshot() };
    const requestedTarget = staged?.request.assistTarget;
    const target = requestedTarget?.kind === targetKind ? requestedTarget : targetKind === 'document'
      ? source.updatedAt ? captureAssistTarget(source.content, 'document', 0, source.content.length, source.updatedAt) ?? undefined : undefined
      : assistTargets?.[targetKind] ?? undefined;
    if (source.remoteConflict || (targetKind !== 'document' && !target) || target && (!validateAssistTarget(source.content, target) || target.baseUpdatedAt !== source.updatedAt)
      || staged?.request.annotations?.some((annotation) => annotation.quote && !source.content.includes(annotation.quote))) {
      setLocalError(zh ? '选文或版本已变化，请重新选择原文和批注。' : 'Selection or version changed. Select the source and annotations again.'); return;
    }
    setLocalError(null);
    const submittedSnapshot = { title: source.title, content: source.content, updatedAt: source.updatedAt, draftRevision: source.draftRevision, remoteRevision: source.remoteRevision, ...(target ? { assistTarget: target } : {}) };
    await session.send({ pageId, mode: draft.mode, intent: draft.intent.trim(), snapshot: submittedSnapshot, referencePageIds: draft.references.map((r) => r.pageId), noteIds: staged?.request.noteIds ?? [], annotations: staged?.request.annotations ?? [] }, (turn) => {
      const record = restoreCandidate(turn);
      if (record) { record.mount = mount; store.candidates.set(turn.id, record); }
      if (!live.current || scopeRef.current !== scope || mountRef.current.token !== mount) return;
      const candidate = record?.candidate ?? { taskId: turn.id, pageId: turn.pageId, spaceId, userId, baseTitle: turn.pageSnapshot?.title, baseContent: turn.pageSnapshot?.content, baseUpdatedAt: turn.pageSnapshot?.updatedAt, content: '', status: 'generating', noteIds: turn.noteIds } as AssistCandidate;
      emit('dispatch', candidate, undefined, staged ? { userId, spaceId, pageId, request: staged.request, snapshot: { title: source.title, content: source.content, updatedAt: source.updatedAt } } : undefined);
      if (staged) callbacks.current.onRequestHandled?.(staged.request.id);
    });
  };
  const errors: Record<string, string> = {
    access: zh ? '会话或来源已不可访问。请重试，或新建会话继续。' : 'This conversation or a source is no longer accessible. Retry or start a new conversation.',
    conflict: zh ? '会话正在执行或来源版本已变化。请刷新后重试。' : 'A turn is running or a source version changed. Refresh and retry.',
    limits: zh ? '请求超过限制或选文已失效。请减少正文、引用或笔记后重试；满 100 轮请新建会话。' : 'Request exceeds a limit or the selection is stale. Reduce content, references or notes and retry; start a new conversation after 100 turns.',
    quota: zh ? '当前任务过多，请稍后重试。' : 'Too many tasks are active. Please retry shortly.',
    network: zh ? '请求失败，输入已保留。请重试。' : 'Request failed. Your message is preserved. Please retry.',
  };
  const statuses = zh ? { queued: '排队中', running: '执行中', done: '已完成', failed: '失败', cancelled: '已停止' } : { queued: 'Queued', running: 'Running', done: 'Done', failed: 'Failed', cancelled: 'Stopped' };
  const regenerate = (turn: AgentTurn) => {
    const originalTarget = turn.pageSnapshot?.assistTarget;
    const scopedTarget = originalTarget?.kind !== 'document' ? originalTarget : undefined;
    // Document regeneration captures the CURRENT full source on Send. Selection/section stays explicit.
    const staged = scopedTarget || turn.noteIds.length || turn.annotations?.length ? { pageId, request: {
      id: crypto.randomUUID(), intent: turn.intent, assistTarget: scopedTarget, noteIds: turn.noteIds, annotations: turn.annotations,
    } } : undefined;
    session.updateDraft({ intent: turn.intent, mode: turn.mode, references: turn.references, staged, targetKind: scopedTarget?.kind ?? 'document' });
    setLocalError(null);
    document.querySelector<HTMLTextAreaElement>('[data-agent-composer]')?.focus();
  };
  return <aside aria-label="Agent" data-testid="agent-session-panel" className="agent-session-panel flex min-h-0 min-w-0 flex-1 flex-col bg-white text-sm">
    <div className="flex shrink-0 items-end gap-2 border-b border-gray-200 p-3">
      <label className="min-w-0 flex-1 text-xs text-gray-500">{zh ? '会话' : 'Conversation'}<select aria-label={zh ? '会话' : 'Conversation'} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" value={session.selected ?? ''} disabled={session.sending} onChange={(e) => void session.select(e.target.value)}><option value="" disabled>{zh ? '新会话' : 'New conversation'}</option>{session.selected && !session.sessions.some((s) => s.id === session.selected) ? <option value={session.selected}>{zh ? '不可访问的会话' : 'Unavailable conversation'}</option> : null}{session.sessions.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label><button type="button" disabled={session.sending || session.loading} onClick={() => void session.newSession()} className="min-h-9 shrink-0 rounded-lg border border-gray-200 px-2">{zh ? '新建会话' : 'New conversation'}</button>
    </div>
    <div className="agent-session-turns min-h-0 flex-1 space-y-4 overflow-y-auto p-3 [overflow-wrap:anywhere]" aria-live="polite">
      {session.loading ? <p role="status">{zh ? '加载会话…' : 'Loading conversation…'}</p> : null}
      {!session.loading && !session.detail?.turns.length ? <p className="text-gray-500">{zh ? '围绕这篇文档开始对话。' : 'Start a conversation about this document.'}</p> : null}
      {session.detail?.turns.map((turn) => {
        const record = store.candidates.get(turn.id);
        const samePage = turn.pageId === pageId;
        const candidate = record ? samePage && canAccept ? bindCandidate(record, current(), mount) : record.candidate : null;
        return <article key={turn.id} className="space-y-2 rounded-lg border border-gray-200 p-3" data-testid={`agent-turn-${turn.id}`}>
          <p className="whitespace-pre-wrap font-medium">{turn.intent}</p><p className="text-xs text-gray-500">{statuses[turn.status]}</p>
          <details className="text-xs text-gray-600"><summary className="cursor-pointer">{zh ? '发送时的来源与版本' : 'Sources and versions at send'}</summary><div className="mt-2 space-y-2">
            <p><span>{turn.pageSnapshot?.title ?? turn.pageId}</span> · {turn.pageSnapshot?.updatedAt ?? (zh ? '版本未知' : 'Unknown version')}</p>
            {turn.pageSnapshot?.assistTarget?.quote ? <blockquote className="max-h-32 overflow-auto whitespace-pre-wrap border-l-2 border-gray-200 pl-2">{turn.pageSnapshot.assistTarget.quote}</blockquote> : null}
            {turn.references.map((r) => <p key={r.pageId}><span>{r.title}</span> · {r.updatedAt}</p>)}
            {turn.annotations?.map((a) => <div key={a.id} className="rounded-lg bg-gray-50 p-2"><blockquote className="whitespace-pre-wrap">{a.quote}</blockquote><p className="mt-1 whitespace-pre-wrap">{a.body}</p></div>)}
            <details><summary>{zh ? '原始 Markdown 快照' : 'Original Markdown snapshot'}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{turn.pageSnapshot?.content}</pre></details>
          </div></details>
          {turn.result?.summary || turn.progressText ? <p className="whitespace-pre-wrap">{turn.result?.summary ?? turn.progressText}</p> : null}
          {turn.status === 'failed' ? <p role="alert" className="text-xs text-red-700">{zh ? '本轮执行失败。可检查上下文后重试，或新建会话。' : 'This turn failed. Check the context and retry, or start a new conversation.'}</p> : null}
          {candidate ? <>
            {(!samePage || !canAccept) && turn.pageId ? <Link className="block text-blue-700" to={`/pages/${turn.pageId}/edit`}>{zh ? '打开目标文档编辑以审阅' : 'Open target document to review'}</Link> : null}
            {samePage && !canAccept ? <p>{acceptUnavailableReason ?? (zh ? '返回编辑模式后可接受候选。' : 'Return to edit to accept this candidate.')}</p> : null}
            {candidate.status === 'accepted' || candidate.acceptedEditIds?.length ? <p className="text-xs text-gray-600">{zh ? '历史接受记录：曾接受到草稿。编辑器撤销/重做只改变正文，不回退本记录或笔记；再次应用请重新生成。' : 'Acceptance record: previously accepted into the draft. Editor Undo/Redo changes text, not this record or notes. Regenerate to apply again.'}</p> : null}
            <AssistCandidateReview candidate={candidate} canEdit={canEdit && canAccept && samePage && (!candidate.assistTarget || supportsScopedApply)} supportsScopedApply={supportsScopedApply} onAccept={(editId) => accept(turn.id, editId)} onDiscard={() => discard(turn.id)} />
          </> : null}
          {samePage && (turn.status === 'failed' || candidate?.status === 'conflict' || candidate?.status === 'accepted' || candidate?.status === 'discarded' || candidate?.status === 'failed' || turn.status === 'cancelled') ? <button type="button" disabled={session.running} onClick={() => regenerate(turn)} className="rounded-lg border border-gray-200 px-2 py-1">{zh ? '基于当前草稿重新生成' : 'Regenerate from current draft'}</button> : null}
          {(turn.status === 'queued' || turn.status === 'running') ? <button type="button" disabled={session.cancelling} onClick={() => void session.cancel(turn)} className="rounded-lg border border-gray-200 px-3 py-1">{zh ? '停止' : 'Stop'}</button> : null}
        </article>;
      })}
    </div>
    <div className="agent-session-composer min-h-0 border-t border-gray-200">
    <div className="agent-composer-fields min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
      <p className="truncate text-xs text-gray-600" title={pageTitle}>{zh ? '当前文档：' : 'Current document: '}{pageTitle}</p>
      {draft.staged ? <div className="max-h-40 space-y-1 overflow-auto rounded-lg bg-gray-50 p-2 text-xs [overflow-wrap:anywhere]">
        <p>{draft.staged.request.annotations?.length ? (zh ? '已加入待发送批注（尚未上传）' : 'Annotations staged (not sent yet)') : (zh ? '已选择原文范围' : 'Selected source context')}</p>
        {draft.staged.request.assistTarget ? <blockquote className="max-h-24 overflow-auto whitespace-pre-wrap border-l-2 border-gray-200 pl-2">{draft.staged.request.assistTarget.quote}</blockquote> : null}
        {draft.staged.request.annotations?.map((a) => <div key={a.id}><blockquote className="whitespace-pre-wrap border-l-2 border-gray-200 pl-2">{a.quote}</blockquote><p>{a.body}</p></div>)}
        {draft.staged.pageId !== pageId ? <Link to={`/pages/${draft.staged.pageId}`}>{zh ? '返回批注页面' : 'Return to annotation page'}</Link> : null}
        {targetKind !== 'document' && assistTargets?.[targetKind] ? <button type="button" disabled={session.sending || session.loading} className="mr-2 rounded-lg border border-gray-200 px-2 py-1" onClick={() => session.updateDraft({ staged: { ...draft.staged!, request: { ...draft.staged!.request, assistTarget: assistTargets[targetKind as 'selection' | 'section'] ?? undefined } } })}>{targetKind === 'selection' ? (zh ? '使用当前选区' : 'Use current selection') : (zh ? '使用当前章节' : 'Use current section')}</button> : null}
        <button type="button" disabled={session.sending || session.loading} onClick={() => { callbacks.current.onRequestHandled?.(draft.staged!.request.id); session.updateDraft({ staged: undefined, targetKind: 'document' }); }}>{zh ? '移除附件并使用整篇文档' : 'Remove context and use the whole document'}</button>
      </div> : null}
      <AgentReferencePicker key={`${userId}:${spaceId}`} userId={userId} spaceId={spaceId} selected={draft.references} onChange={(references) => session.updateDraft({ references })} disabled={session.sending || session.loading} />
      <div className="flex flex-wrap gap-2"><select aria-label={zh ? '会话模式' : 'Message mode'} disabled={session.sending || session.loading} value={canEdit ? draft.mode : 'question'} onChange={(e) => session.updateDraft({ mode: e.target.value as 'question' | 'proposal' })} className="min-h-8 rounded-lg border border-gray-200 px-2"><option value="question">{zh ? '问答' : 'Ask a question'}</option><option value="proposal" disabled={!canEdit}>{zh ? '生成修改候选' : 'Propose changes'}</option></select>
        <select aria-label={zh ? '修改范围' : 'Edit scope'} disabled={session.sending || session.loading} value={targetKind} onChange={(e) => session.updateDraft({ targetKind: e.target.value as AssistTarget['kind'] })} className="min-h-8 rounded-lg border border-gray-200 px-2"><option value="document">{zh ? '整篇文档' : 'Document'}</option><option value="selection" disabled={!assistTargets?.selection && draft.staged?.request.assistTarget?.kind !== 'selection'}>{zh ? '所选段落' : 'Selection'}</option><option value="section" disabled={!assistTargets?.section && draft.staged?.request.assistTarget?.kind !== 'section'}>{zh ? '当前章节' : 'Section'}</option></select>
      </div>
      <label className="block text-xs text-gray-600">{zh ? '消息' : 'Message'}<textarea ref={composerRef} data-agent-composer data-testid="assist-intent" aria-label={zh ? '消息' : 'Message'} rows={3} disabled={session.sending || session.loading} value={draft.intent} onChange={(e) => session.updateDraft({ intent: e.target.value })} className="mt-1 max-h-40 w-full resize-y rounded-lg border border-gray-200 p-2 text-sm" /></label>
      {localError || session.error ? <div role="alert" className="text-xs text-red-700"><p>{localError ?? errors[session.error!]}</p>{session.selected && session.error ? <button type="button" onClick={() => void session.select(session.selected!)} className="mt-1 underline">{zh ? '重新加载会话' : 'Reload conversation'}</button> : null}</div> : null}
    </div>
    <div className="agent-composer-actions shrink-0 border-t border-gray-200 px-3 py-2">
      <button type="button" data-testid="assist-submit" disabled={!draft.intent.trim() || session.sending || session.running || session.loading || !userId || (!canEdit && draft.mode === 'proposal')} onClick={() => void submit()} className="min-h-8 rounded-lg bg-gray-900 px-4 text-white disabled:opacity-40">{session.sending ? (zh ? '发送中…' : 'Sending…') : (zh ? '发送' : 'Send')}</button>
    </div></div>
  </aside>;
}
