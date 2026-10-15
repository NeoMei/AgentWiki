import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, ChevronDown, FileText, History, MessageSquare, Plus, Square, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { AssistCandidateReview } from '../page/AssistCandidateReview';
import { applyCandidateToDraft, type AssistCandidate } from '../page/assistCandidate';
import { captureAssistTarget, validateAssistTarget, type AssistTarget } from '../page/assistTargets';
import type { AssistNotesEvent } from '../page/AgentAssistPanel';
import { AgentActivity } from './AgentActivity';
import { AgentContextSettings } from './AgentContextSettings';
import { bugEditorMessages } from '../../i18n/bug-editor-messages';
import { AgentReferencePicker } from './AgentReferencePicker';
import { bindCandidate, candidateFromTurn } from './agentSessionCandidate';
import { useAgentSession } from './useAgentSession';
import type { AgentSessionPanelProps, AgentTurn } from './agentSessionTypes';

/** A receipt proves exactly the explicit upload, even if its bridge or composer has since changed. */
function matchesReceipt(turn: AgentTurn, credential: NonNullable<AssistNotesEvent['dispatchRequest']>) {
  const { request, snapshot } = credential, annotations = request.annotations ?? [], noteIds = request.noteIds ?? [];
  return turn.pageId === credential.pageId && turn.pageSnapshot?.title === snapshot.title
    && turn.pageSnapshot?.content === snapshot.content && turn.pageSnapshot?.updatedAt === snapshot.updatedAt
    && turn.noteIds.length === noteIds.length && new Set(turn.noteIds).size === noteIds.length
    && turn.noteIds.every((id) => noteIds.includes(id)) && (turn.annotations ?? []).length === annotations.length
    && annotations.every((annotation) => turn.annotations?.some((sent) => sent.id === annotation.id && sent.body === annotation.body && sent.quote === annotation.quote));
}

export function AgentSessionPanel({ pageId, spaceId, pageTitle, snapshot, canEdit = false, canAccept = false, onApply, onDirectApply, supportsScopedApply = false, assistTargets, assistRequest, onRequestHandled, onNotesEvent, notesReady = true, visible = true, autoFocus = true, focusRequest, acceptUnavailableReason }: AgentSessionPanelProps) {
  const { user } = useAuth(), { language } = useLanguage(), zh = language === 'zh-CN';
  const userId = typeof user?.id === 'string' ? user.id : '';
  const session = useAgentSession(userId, spaceId);
  const { store, draft } = session;
  const targetKind = draft.targetKind;
  const turnsRef = useRef<HTMLDivElement>(null);
  const turnsContentRef = useRef<HTMLDivElement>(null);
  const followTurnsRef = useRef(true);
  const selectedRef = useRef(session.selected); selectedRef.current = session.selected;
  // Capture user intent before incoming content changes the bottom distance.
  useLayoutEffect(() => { followTurnsRef.current = true; }, [`${userId}\u0000${spaceId}`, session.selected]);
  useLayoutEffect(() => {
    const viewport = turnsRef.current;
    if (!viewport || session.loading) return;
    let frame: number | null = null;
    const follow = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        if (followTurnsRef.current) viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      });
    };
    follow();
    // Watch the content, not the fixed-height viewport: streamed replies and
    // expanded source/candidate details may grow after the React commit.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(follow);
    if (turnsContentRef.current) observer?.observe(turnsContentRef.current);
    observer?.observe(viewport);
    return () => { observer?.disconnect(); if (frame !== null) cancelAnimationFrame(frame); };
  }, [session.detail, session.loading, session.selected, session.sending]);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const handledFocusRequest = useRef<string | undefined>(undefined);
  const autoFocusedScope = useRef<string | null>(null);
  const historyRef = useRef<HTMLDetailsElement>(null);
  const referenceTrigger = useRef<{ intent: string; offset: number; scope: string; session: string | null } | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const newSessionRef = useRef<HTMLButtonElement>(null);
  const closeFocusRef = useRef<string | null | undefined>(undefined);
  const [referenceOpenRequest, setReferenceOpenRequest] = useState(0);
  const conversationPanelId = useId();
  const [localError, setLocalError] = useState<string | null>(null);
  const directTurnIds = useRef(new Set<string>());
  const directInFlight = useRef(new Set<string>());
  const [directAppliedIds, setDirectAppliedIds] = useState<Set<string>>(new Set());
  const scope = `${userId}\u0000${spaceId}\u0000${pageId}`;
  const mountRef = useRef({ scope, token: {} });
  if (mountRef.current.scope !== scope) mountRef.current = { scope, token: {} };
  const mount = mountRef.current.token;
  const callbacks = useRef({ onNotesEvent, onRequestHandled, onDirectApply }); callbacks.current = { onNotesEvent, onRequestHandled, onDirectApply };
  const emitted = useRef(new Map<string, string>());
  useEffect(() => { setLocalError(null); emitted.current.clear(); }, [scope]);
  useEffect(() => { composingRef.current = false; }, [scope, session.selected]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      for (const details of [historyRef.current]) {
        if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false;
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  useLayoutEffect(() => {
    const tabs = tabsRef.current, selected = tabs?.querySelector<HTMLElement>('.agent-conversation-tab-item[data-selected="true"]');
    if (!tabs || !selected) return;
    const reveal = () => {
      if (!tabs.clientWidth) return;
      const right = selected.offsetLeft + selected.offsetWidth;
      // Include the sibling close button; if the strip is exceptionally narrow,
      // keep that action visible even when the whole tab cannot fit.
      if (selected.offsetWidth > tabs.clientWidth || right > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = Math.max(0, right - tabs.clientWidth);
      else if (selected.offsetLeft < tabs.scrollLeft) tabs.scrollLeft = selected.offsetLeft;
    };
    reveal();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reveal);
    observer?.observe(tabs); observer?.observe(selected);
    return () => observer?.disconnect();
  }, [session.selected, session.sessions, session.openSessionIds, visible]);
  useLayoutEffect(() => {
    if (closeFocusRef.current === undefined) return;
    const id = closeFocusRef.current; closeFocusRef.current = undefined;
    if (id) document.getElementById(`${conversationPanelId}-${id}`)?.focus();
    else newSessionRef.current?.focus();
  }, [session.openSessionIds, conversationPanelId]);
  useEffect(() => {
    // A hidden panel consumes a pending request so a late load cannot steal focus.
    if (!visible) { handledFocusRequest.current = focusRequest; autoFocusedScope.current = null; return; }
    if (session.loading) return;
    if (autoFocus && autoFocusedScope.current !== scope || focusRequest !== undefined && handledFocusRequest.current !== focusRequest) composerRef.current?.focus();
    autoFocusedScope.current = scope;
    handledFocusRequest.current = focusRequest;
  }, [scope, session.loading, visible, autoFocus, focusRequest]);
  useEffect(() => {
    if (session.loading || !assistRequest || [...store.drafts.values()].some((composer) => composer.staged?.request.id === assistRequest.id)
      || [...store.receipts.values()].some((receipt) => receipt.credential.request.id === assistRequest.id)) return;
    session.updateDraft({ intent: assistRequest.intent, targetKind: assistRequest.assistTarget?.kind ?? 'document', staged: { pageId, request: assistRequest } });
  }, [assistRequest?.id, session.loading, session.selected, scope]);
  const emit = (event: AssistNotesEvent['event'], candidate: AssistCandidate, editId?: string, dispatchRequest?: AssistNotesEvent['dispatchRequest']) => {
    if (candidate.noteIds?.length && candidate.pageId === pageId && candidate.userId === userId && candidate.spaceId === spaceId) callbacks.current.onNotesEvent?.({ event, taskId: candidate.taskId, noteIds: candidate.noteIds, annotations: session.detail?.turns.find((turn) => turn.id === candidate.taskId)?.annotations, candidate, editId, acceptedEditIds: candidate.acceptedEditIds, ...(dispatchRequest ? { dispatchRequest } : {}) });
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
    if (!notesReady || session.loading || session.error) return;
    for (const turn of session.detail?.turns ?? []) {
      const receipt = store.receipts.get(turn.id);
      if (receipt && !receipt.awaitingRead && receipt.sessionId === session.detail?.id && receipt.credential.pageId === pageId
        && receipt.credential.userId === userId && receipt.credential.spaceId === spaceId && matchesReceipt(turn, receipt.credential)) {
        const dispatched = store.candidates.get(turn.id)?.candidate ?? {
          taskId: turn.id, pageId: turn.pageId, spaceId, userId, baseTitle: turn.pageSnapshot?.title,
          baseContent: turn.pageSnapshot?.content, baseUpdatedAt: turn.pageSnapshot?.updatedAt,
          content: '', status: 'generating', noteIds: turn.noteIds,
        } as AssistCandidate;
        emit('dispatch', dispatched, undefined, receipt.credential);
        callbacks.current.onRequestHandled?.(receipt.credential.request.id);
        store.receipts.delete(turn.id); emitted.current.delete(turn.id);
      }
      const candidate = store.candidates.get(turn.id)?.candidate;
      if (!candidate || candidate.pageId !== pageId || candidate.status === 'generating') continue;
      const key = `${candidate.status}:${candidate.acceptedEditIds?.join(',') ?? ''}`;
      if (emitted.current.get(turn.id) === key) continue;
      emitted.current.set(turn.id, key);
      if (candidate.status === 'ready' || candidate.status === 'accepted') emit('ready', candidate);
      if (candidate.status === 'failed') emit('fail', candidate);
    }
  }, [session.detail, session.loading, session.error, session.sentRevision, scope, store, notesReady]);
  useEffect(() => {
    if ((!canEdit || !onDirectApply) && draft.mode === 'direct') session.updateDraft({ mode: 'question' });
    else if (!canEdit && draft.mode !== 'question') session.updateDraft({ mode: 'question' });
  }, [canEdit, draft.mode, onDirectApply, store]);
  useEffect(() => {
    if (!onDirectApply || !canEdit || session.loading || session.error) return;
    for (const turn of session.detail?.turns ?? []) {
      if (!directTurnIds.current.has(turn.id) || directInFlight.current.has(turn.id) || directAppliedIds.has(turn.id)) continue;
      const record = store.candidates.get(turn.id), candidate = record?.candidate;
      if (!record || !candidate || candidate.status !== 'ready' || candidate.pageId !== pageId) continue;
      const liveSnapshot = current();
      const application = applyCandidateToDraft(candidate, liveSnapshot);
      if (application.status !== 'applied') {
        record.candidate = { ...candidate, status: 'conflict' };
        store.set({ revision: store.get().revision + 1 });
        continue;
      }
      directInFlight.current.add(turn.id);
      void Promise.resolve(callbacks.current.onDirectApply?.(candidate, application.content)).then((saved) => {
        if (saved) {
          record.candidate = { ...candidate, status: 'accepted', acceptedEditIds: application.acceptedEditIds };
          store.ledger.set(turn.id, { status: 'accepted', acceptedEditIds: application.acceptedEditIds });
          setDirectAppliedIds((ids) => new Set(ids).add(turn.id));
          emit('accept', record.candidate);
        } else {
          record.candidate = { ...candidate, status: 'conflict' };
          store.ledger.set(turn.id, { status: 'conflict', acceptedEditIds: candidate.acceptedEditIds });
          emit('fail', record.candidate);
        }
        store.set({ revision: store.get().revision + 1 });
      }).catch(() => {
        record.candidate = { ...candidate, status: 'conflict' };
        store.set({ revision: store.get().revision + 1 });
      }).finally(() => directInFlight.current.delete(turn.id));
    }
  }, [session.detail, session.loading, session.error, session.sentRevision, scope, store, notesReady, canEdit, onDirectApply, pageId, directAppliedIds]);
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
    if (!draft.intent.trim() || session.sending || session.running || session.loading || !userId || ((draft.mode === 'proposal' || draft.mode === 'direct') && !canEdit)) return;
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
    followTurnsRef.current = true;
    const credential: AssistNotesEvent['dispatchRequest'] = staged ? {
      // Regeneration may defer its document target until Send; the receipt proves the actual
      // submitted target, including edits made after staging, rather than the staged placeholder.
      userId, spaceId, pageId, request: structuredClone({ ...staged.request, assistTarget: target }), snapshot: { title: source.title, content: source.content, updatedAt: source.updatedAt },
    } : undefined;
    const submittedSnapshot = { title: source.title, content: source.content, updatedAt: source.updatedAt, draftRevision: source.draftRevision, remoteRevision: source.remoteRevision, ...(target ? { assistTarget: target } : {}) };
    const direct = draft.mode === 'direct';
    await session.send({ pageId, mode: direct ? 'proposal' : draft.mode, intent: draft.intent.trim(), snapshot: submittedSnapshot, referencePageIds: draft.references.map((r) => r.pageId), noteIds: staged?.request.noteIds ?? [], annotations: staged?.request.annotations ?? [] }, (turn) => {
      if (direct) directTurnIds.current.add(turn.id);
      if (mountRef.current.token === mount && selectedRef.current === turn.sessionId) followTurnsRef.current = true;
      const record = restoreCandidate(turn);
      if (record && !store.candidates.has(turn.id)) { record.mount = mount; store.candidates.set(turn.id, record); }
      if (credential && matchesReceipt(turn, credential)) store.receipts.set(turn.id, { sessionId: turn.sessionId, awaitingRead: false, credential });
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
      ...(turn.pageSnapshot ? { supersedes: { taskId: turn.id, snapshot: { title: turn.pageSnapshot.title, content: turn.pageSnapshot.content, updatedAt: turn.pageSnapshot.updatedAt }, noteIds: [...turn.noteIds], annotations: (turn.annotations ?? []).map((annotation) => ({ ...annotation })) } } : {}),
    } } : undefined;
    session.updateDraft({ intent: turn.intent, mode: turn.mode, references: turn.references, staged, targetKind: scopedTarget?.kind ?? 'document' });
    setLocalError(null);
    composerRef.current?.focus();
  };
  const runningTurn = session.detail?.turns.find((turn) => turn.status === 'queued' || turn.status === 'running');
  const tabsDisabled = session.sending || session.loadingSessions || session.creating;
  const visibleSessions = (session.openSessionIds ?? []).map((id) => session.sessions.find((item) => item.id === id)
    ?? { id, title: zh ? '不可访问的会话' : 'Unavailable conversation' });
  const selectedSession = visibleSessions.find((item) => item.id === session.selected);
  const scopeLabel = targetKind === 'selection' ? (zh ? '所选段落' : 'Selection') : targetKind === 'section' ? (zh ? '当前章节' : 'Section') : (zh ? '整篇文档' : 'Document');
  const selectConversation = (id: string) => {
    if (historyRef.current) historyRef.current.open = false;
    void session.select(id);
  };
  const closeConversation = (id: string) => {
    if (tabsDisabled) return;
    const index = visibleSessions.findIndex((item) => item.id === id);
    closeFocusRef.current = session.selected === id
      ? visibleSessions[index + 1]?.id ?? visibleSessions[index - 1]?.id ?? null
      : session.selected;
    if (!session.close(id)) closeFocusRef.current = undefined;
  };
  const returnComposerFocus = () => { if (visible) composerRef.current?.focus(); };
  return <aside aria-label="Agent" data-testid="agent-session-panel" className="agent-session-panel flex min-h-0 min-w-0 flex-1 flex-col bg-white text-sm">
    <header className="agent-conversation-header">
      <div ref={tabsRef} role="tablist" aria-label={zh ? '会话' : 'Conversations'} className="agent-conversation-tabs" onKeyDown={(event) => {
        if (event.key === 'Delete') {
          const tab = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
          const id = tab?.dataset.sessionId;
          if (id) { event.preventDefault(); closeConversation(id); }
          return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0 || !tabs.length) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].focus(); tabs[next].click();
      }}>
        {visibleSessions.map((item) => <div key={item.id} role="presentation" className="agent-conversation-tab-item" data-selected={session.selected === item.id}>
          <button type="button" role="tab" data-session-id={item.id} id={`${conversationPanelId}-${item.id}`} aria-controls={conversationPanelId} aria-selected={session.selected === item.id} tabIndex={session.selected === item.id ? 0 : -1} title={item.title} disabled={tabsDisabled} className="agent-conversation-tab" onClick={() => selectConversation(item.id)}><Bot aria-hidden="true" size={15} /><span>{item.title}</span></button>
          <button type="button" aria-label={zh ? `关闭 ${item.title}` : `Close ${item.title}`} title={zh ? '关闭会话标签' : 'Close conversation tab'} disabled={tabsDisabled} className="agent-conversation-close" onClick={() => closeConversation(item.id)}><X aria-hidden="true" size={13} /></button>
        </div>)}
        {!visibleSessions.length ? <span className="agent-conversation-placeholder"><Bot aria-hidden="true" size={15} />{zh ? '新会话' : 'New conversation'}</span> : null}
      </div>
      <button ref={newSessionRef} type="button" aria-label={zh ? '新建会话' : 'New conversation'} title={zh ? '新建会话' : 'New conversation'} disabled={session.sending || session.loading} onClick={() => void session.newSession()} className="agent-icon-button"><Plus aria-hidden="true" size={17} /></button>
      <details ref={historyRef} className="agent-conversation-history" onKeyDown={(event) => { if (event.key === 'Escape' && historyRef.current?.open) { event.preventDefault(); historyRef.current.open = false; historyRef.current.querySelector<HTMLElement>('summary')?.focus(); } }}>
        <summary aria-label={zh ? '会话历史' : 'Conversation history'} title={zh ? '会话历史' : 'Conversation history'} className="agent-icon-button"><History aria-hidden="true" size={17} /></summary>
        <div className="agent-history-menu">
          <p>{zh ? '会话历史' : 'Conversation history'}</p>
          {session.sessions.length ? session.sessions.map((item) => <button type="button" key={item.id} disabled={tabsDisabled} aria-current={session.selected === item.id ? 'true' : undefined} onClick={() => { selectConversation(item.id); historyRef.current?.querySelector<HTMLElement>('summary')?.focus(); }}><MessageSquare aria-hidden="true" size={15} /><span>{item.title}</span></button>) : <p className="text-gray-500">{zh ? '还没有历史会话' : 'No conversations yet'}</p>}
        </div>
      </details>
    </header>
    <div id={conversationPanelId} role="tabpanel" aria-labelledby={selectedSession ? `${conversationPanelId}-${selectedSession.id}` : undefined} aria-label={selectedSession ? undefined : (zh ? '当前会话' : 'Current conversation')} ref={turnsRef} className="agent-session-turns min-h-0 flex-1 overflow-y-auto [overflow-wrap:anywhere]" aria-live="polite" onScroll={(event) => {
      const viewport = event.currentTarget;
      followTurnsRef.current = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 80;
    }}>
      <div ref={turnsContentRef} className="agent-conversation-messages">
      {session.loading ? <p role="status" className="agent-chat-empty">{zh ? '加载会话…' : 'Loading conversation…'}</p> : null}
      {!session.loading && !session.detail?.turns.length ? <div className="agent-chat-empty"><Bot aria-hidden="true" size={25} /><p>{zh ? '围绕这篇文档开始对话。' : 'Start a conversation about this document.'}</p><span>{zh ? '提问，或描述你希望修改的内容。' : 'Ask a question or describe a change you need.'}</span></div> : null}
      {session.detail?.turns.map((turn) => {
        const record = store.candidates.get(turn.id);
        const samePage = turn.pageId === pageId;
        const candidate = record ? samePage && canAccept ? bindCandidate(record, current(), mount) : record.candidate : null;
        return <article key={turn.id} className="agent-chat-turn" data-testid={`agent-turn-${turn.id}`}>
          <div className="agent-user-message"><p className="whitespace-pre-wrap">{turn.intent}</p></div>
          <div className="agent-reply">
            <div className="agent-reply-meta"><Bot aria-hidden="true" size={15} /><span>Agent</span><span className={turn.status === 'running' || turn.status === 'queued' ? 'agent-turn-active' : ''}>{statuses[turn.status]}</span></div>
            {turn.status === 'queued' || turn.status === 'running' ? <AgentActivity status={turn.status} progress={turn.progress} createdAt={turn.createdAt} /> : null}
            {turn.result?.summary || turn.progressText ? <div className="agent-reply-content"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img']} components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{turn.result?.summary ?? turn.progressText}</ReactMarkdown></div> : null}
            {turn.status === 'failed' ? <p role="alert" className="text-xs text-red-700">{zh ? '本轮执行失败。可检查上下文后重试，或新建会话。' : 'This turn failed. Check the context and retry, or start a new conversation.'}</p> : null}
            {directAppliedIds.has(turn.id) ? <div className="agent-acceptance-receipt"><p>{zh ? '页面已直接修改并保存。' : 'Page updated and saved directly.'}</p></div> : candidate?.status === 'accepted' || candidate?.acceptedEditIds?.length ? <div className="agent-acceptance-receipt"><p>{zh ? '已接受到草稿，仍需保存页面。' : 'Accepted to draft. Save the page to publish these changes.'}</p><details className="agent-acceptance-history"><summary>{zh ? '接受记录说明' : 'About this acceptance record'}</summary><p className="text-xs text-gray-600">{zh ? '历史接受记录：曾接受到草稿。编辑器撤销/重做只改变正文，不回退本记录或笔记；再次应用请重新生成。' : 'Acceptance record: previously accepted into the draft. Editor Undo/Redo changes text, not this record or notes. Regenerate to apply again.'}</p></details></div> : null}
            {candidate && candidate.status !== 'generating' ? <div className="agent-candidate-review">
              {(!samePage || !canAccept) && turn.pageId ? <Link className="block text-blue-700" to={`/pages/${turn.pageId}/edit`}>{zh ? '打开目标文档编辑以审阅' : 'Open target document to review'}</Link> : null}
              {samePage && !canAccept ? <p role="status">{acceptUnavailableReason ?? (zh ? '返回编辑模式后可接受候选。' : 'Return to edit to accept this candidate.')}</p> : null}
              <AssistCandidateReview compact candidate={candidate} canEdit={canEdit && canAccept && samePage && (!candidate.assistTarget || supportsScopedApply)} supportsScopedApply={supportsScopedApply} onAccept={(editId) => accept(turn.id, editId)} onDiscard={() => discard(turn.id)} />
            </div> : null}
            <details className="agent-turn-sources"><summary>{zh ? '发送时的来源与版本' : 'Sources and versions at send'}<ChevronDown aria-hidden="true" size={13} /></summary><div className="mt-2 space-y-2">
              <p><span>{turn.pageSnapshot?.title ?? turn.pageId}</span> · {turn.pageSnapshot?.updatedAt ?? (zh ? '版本未知' : 'Unknown version')}</p>
              {turn.pageSnapshot?.assistTarget?.quote ? <blockquote className="max-h-32 overflow-auto whitespace-pre-wrap border-l-2 border-gray-200 pl-2">{turn.pageSnapshot.assistTarget.quote}</blockquote> : null}
              {turn.references.map((r) => <p key={r.pageId}><span>{r.title}</span> · {r.updatedAt}</p>)}
              {turn.annotations?.map((a) => <div key={a.id} className="rounded-lg bg-gray-50 p-2"><blockquote className="whitespace-pre-wrap">{a.quote}</blockquote><p className="mt-1 whitespace-pre-wrap">{a.body}</p></div>)}
              <details><summary>{zh ? '原始 Markdown 快照' : 'Original Markdown snapshot'}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{turn.pageSnapshot?.content}</pre></details>
            </div></details>
            {samePage && (turn.status === 'failed' || candidate?.status === 'conflict' || candidate?.status === 'accepted' || candidate?.status === 'discarded' || candidate?.status === 'failed' || candidate?.status === 'empty' || turn.status === 'cancelled') ? <button type="button" disabled={session.running} onClick={() => regenerate(turn)} className="agent-regenerate-button">{zh ? '基于当前草稿重新生成' : 'Regenerate from current draft'}</button> : null}
          </div>
        </article>;
      })}
      {session.sending ? <div className="agent-reply agent-sending-feedback"><AgentActivity status="sending" /></div> : null}
      </div>
    </div>
    <div className="agent-session-composer">
      <div className="agent-composer-context"><span className="agent-current-document" title={pageTitle}><FileText aria-hidden="true" size={13} /><span>{pageTitle}</span></span><AgentReferencePicker key={`${userId}:${spaceId}:${session.selected ?? 'new'}`} userId={userId} spaceId={spaceId} selected={draft.references} onChange={(references) => session.updateDraft({ references })} onOpen={() => { referenceTrigger.current = null; }} onSelected={(references) => {
        const trigger = referenceTrigger.current;
        referenceTrigger.current = null;
        const clean = trigger && trigger.scope === scope && trigger.session === session.selected && trigger.intent === draft.intent && draft.intent[trigger.offset] === '@';
        session.updateDraft({ references, ...(clean ? { intent: draft.intent.slice(0, trigger.offset) + draft.intent.slice(trigger.offset + 1) } : {}) });
        if (clean) requestAnimationFrame(() => composerRef.current?.setSelectionRange(trigger.offset, trigger.offset));
      }} disabled={session.sending || session.loading || !visible} openRequest={referenceOpenRequest} onClose={returnComposerFocus} /></div>
      <p className="agent-reference-hint">{bugEditorMessages[zh ? 'zh-CN' : 'en']['editor.referenceHint']}</p>
      <div className="agent-composer-box">
        {draft.staged ? <details className="agent-staged-context" key={draft.staged.request.id}>
          <summary><MessageSquare aria-hidden="true" size={13} /><span>{draft.staged.request.annotations?.length ? (zh ? `${draft.staged.request.annotations.length} 条笔记 · 待发送` : `${draft.staged.request.annotations.length} page ${draft.staged.request.annotations.length === 1 ? 'note' : 'notes'} · not sent`) : (zh ? '已选择原文范围' : 'Selected source context')}</span><ChevronDown aria-hidden="true" size={13} /></summary>
          <div className="agent-staged-content">
            <p>{draft.staged.request.annotations?.length ? (zh ? '这些页面笔记将随消息发送给 Agent。' : 'These page notes will be included with your message.') : (zh ? '将使用以下原文作为上下文' : 'The following source will be included')}</p>
            {draft.staged.request.assistTarget ? <blockquote className="whitespace-pre-wrap border-l-2 border-gray-200 pl-2">{draft.staged.request.assistTarget.quote}</blockquote> : null}
            {draft.staged.request.annotations?.map((a) => <div key={a.id}><blockquote className="whitespace-pre-wrap border-l-2 border-gray-200 pl-2">{a.quote}</blockquote><p>{a.body}</p></div>)}
            {draft.staged.pageId !== pageId ? <Link to={`/pages/${draft.staged.pageId}`}>{zh ? '返回批注页面' : 'Return to annotation page'}</Link> : null}
            {targetKind !== 'document' && assistTargets?.[targetKind] ? <button type="button" disabled={session.sending || session.loading} className="agent-context-action" onClick={() => session.updateDraft({ staged: { ...draft.staged!, request: { ...draft.staged!.request, assistTarget: assistTargets[targetKind as 'selection' | 'section'] ?? undefined } } })}>{targetKind === 'selection' ? (zh ? '使用当前选区' : 'Use current selection') : (zh ? '使用当前章节' : 'Use current section')}</button> : null}
            <button type="button" disabled={session.sending || session.loading} className="agent-context-action" onClick={() => { callbacks.current.onRequestHandled?.(draft.staged!.request.id); session.updateDraft({ staged: undefined, targetKind: 'document' }); }}>{zh ? '移除附件并使用整篇文档' : 'Remove context and use the whole document'}</button>
          </div>
        </details> : null}
        <textarea ref={composerRef} data-agent-composer data-testid="assist-intent" aria-label={zh ? '消息' : 'Message'} placeholder={zh ? '询问文档或描述修改，@ 引用页面' : 'Ask about this document, @ to reference a page'} rows={3} disabled={session.sending || session.loading} value={draft.intent} onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }} onChange={(event) => {
          const value = event.target.value, cursor = event.target.selectionStart;
          if (!composingRef.current && draft.references.length < 5 && value.length > draft.intent.length && value[cursor - 1] === '@' && (cursor === 1 || /\s/.test(value[cursor - 2]))) {
            referenceTrigger.current = { intent: value, offset: cursor - 1, scope, session: session.selected };
            setReferenceOpenRequest((request) => request + 1);
          }
          session.updateDraft({ intent: value });
        }} onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229) return;
          event.preventDefault(); void submit();
        }} />
        <div className="agent-composer-actions">
          <select aria-label={zh ? '会话模式' : 'Message mode'} disabled={session.sending || session.loading} value={canEdit ? draft.mode : 'question'} onChange={(event) => session.updateDraft({ mode: event.target.value as 'question' | 'proposal' | 'direct' })} className="agent-mode-select"><option value="question">{zh ? '问答' : 'Ask a question'}</option><option value="proposal" disabled={!canEdit}>{zh ? '生成修改候选' : 'Propose changes'}</option>{onDirectApply ? <option value="direct" disabled={!canEdit}>{zh ? '直接修改页面' : 'Edit page directly'}</option> : null}</select>
          <AgentContextSettings label={zh ? '上下文设置' : 'Context settings'} scopeLabel={targetKind !== 'document' ? scopeLabel : undefined} visible={visible}><label>{zh ? '修改范围' : 'Edit scope'}<select aria-label={zh ? '修改范围' : 'Edit scope'} disabled={session.sending || session.loading} value={targetKind} onChange={(event) => session.updateDraft({ targetKind: event.target.value as AssistTarget['kind'] })}><option value="document">{zh ? '整篇文档' : 'Document'}</option><option value="selection" disabled={!assistTargets?.selection && draft.staged?.request.assistTarget?.kind !== 'selection'}>{zh ? '所选段落' : 'Selection'}</option><option value="section" disabled={!assistTargets?.section && draft.staged?.request.assistTarget?.kind !== 'section'}>{zh ? '当前章节' : 'Section'}</option></select></label><p>{draft.mode === 'direct' ? (zh ? '完成后会再次检查页面版本，并直接保存；版本冲突时不会覆盖页面。' : 'After completion, the page version is checked again and the change is saved directly. Conflicts never overwrite the page.') : (zh ? '修改候选需审阅并接受到草稿，再保存页面。' : 'Review and accept proposed changes to the draft, then save the page.')}</p></AgentContextSettings>
          <span className="agent-composer-spacer" />
          {runningTurn ? <button type="button" aria-label={zh ? '停止' : 'Stop'} title={zh ? '停止' : 'Stop'} disabled={session.cancelling} onClick={() => void session.cancel(runningTurn)} className="agent-send-button agent-stop-button"><Square aria-hidden="true" size={13} fill="currentColor" /></button> : <button type="button" aria-label={session.sending ? (zh ? '发送中…' : 'Sending…') : (zh ? '发送' : 'Send')} title={zh ? '发送 · Enter' : 'Send · Enter'} data-testid="assist-submit" disabled={!draft.intent.trim() || session.sending || session.running || session.loading || !userId || (!canEdit && (draft.mode === 'proposal' || draft.mode === 'direct'))} onClick={() => void submit()} className="agent-send-button"><ArrowUp aria-hidden="true" size={18} /></button>}
        </div>
      </div>
      {localError || session.error ? <div role="alert" className="agent-composer-error"><p>{localError ?? errors[session.error!]}</p>{session.selected && session.error ? <button type="button" onClick={() => void session.select(session.selected!)} className="mt-1 underline">{zh ? '重新加载会话' : 'Reload conversation'}</button> : null}</div> : null}
    </div>
  </aside>;
}
