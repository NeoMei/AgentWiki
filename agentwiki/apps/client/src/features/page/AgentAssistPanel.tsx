import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, CheckCircle2, Loader2, RefreshCw, Send, XCircle, Brain, Sparkles } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { AssistCandidateReview } from './AssistCandidateReview';
import { completeAssistCandidate, applyCandidateToDraft, type AssistCandidate, type AssistSnapshot } from './assistCandidate';

import { validateAssistTarget, type AssistTarget } from './assistTargets';
export interface AssistRequest { id: string; intent: string; assistTarget?: AssistTarget; noteIds?: string[]; autoSubmit?: boolean; annotations?: { id: string; body: string; quote: string }[] }
export interface AssistNotesEvent { event: 'dispatch' | 'ready' | 'accept' | 'fail' | 'discard'; taskId: string; noteIds: string[]; candidate: AssistCandidate; editId?: string; acceptedEditIds?: string[] }
interface AgentAssistPanelProps {
  pageId: string;
  pageTitle: string;
  spaceId: string;
  snapshot: () => AssistSnapshot;
  canEdit?: boolean;
  canAccept?: boolean;
  acceptUnavailableReason?: string;
  onApply?: (candidate: AssistCandidate, editId?: string) => boolean;
  supportsScopedApply?: boolean;
  assistRequest?: AssistRequest | null;
  assistTargets?: { selection?: AssistTarget | null; section?: AssistTarget | null };
  onNotesEvent?: (event: AssistNotesEvent) => void;
  onRequestHandled?: (id: string) => void;
}

type AssistTaskStatus = 'queued' | 'running' | 'done' | 'failed';
type AssistPhase = 'thinking' | 'generating' | 'complete' | 'error';

/** Keep only the most recent assist interactions in the panel. */
const MAX_ASSIST_TASKS = 5;

interface AssistAttemptResult {
  errorCode?: string;
}

interface AssistRoutingResult {
  changes?: string;
  summary?: string;
  model?: string;
  modelTier?: 'free' | 'paid';
  attemptCount: number;
  usage?: { total?: number };
  cost: number;
  attempts?: AssistAttemptResult[];
}

interface AssistTask {
  id: string;
  intent: string;
  status: AssistTaskStatus;
  result?: AssistRoutingResult;
  streamContent?: string;
  phase?: AssistPhase;
}

interface PendingReview {
  id: string;
  title: string;
  status: string;
}

const STATUS_LABEL: Record<AssistTaskStatus, { zh: string; en: string; cls: string }> = {
  queued: { zh: '排队中', en: 'Queued', cls: 'text-amber-600' },
  running: { zh: '执行中', en: 'Running', cls: 'text-blue-600' },
  done: { zh: '已完成', en: 'Done', cls: 'text-green-600' },
  failed: { zh: '失败', en: 'Failed', cls: 'text-red-600' },
};

const PHASE_LABEL: Record<AssistPhase, { zh: string; en: string; icon: React.ReactNode }> = {
  thinking: { zh: '思考中…', en: 'Thinking…', icon: <Brain size={11} className="animate-pulse" /> },
  generating: { zh: '生成中…', en: 'Generating…', icon: <Sparkles size={11} className="animate-pulse" /> },
  complete: { zh: '已完成', en: 'Complete', icon: <CheckCircle2 size={11} /> },
  error: { zh: '出错', en: 'Error', icon: <XCircle size={11} /> },
};

const routingMeta = (result: AssistRoutingResult | undefined, zh: boolean) => {
  if (!result?.model) return null;
  return zh ? '已生成' : 'Generated';
};

const routingErrorCode = (result: AssistRoutingResult | undefined, zh: boolean) => {
  const attempts = result?.attempts;
  const code = attempts?.[attempts.length - 1]?.errorCode;
  if (!code) return null;
  const messages: Record<string, { zh: string; en: string }> = {
    binary_unavailable: { zh: '助手暂时不可用，请稍后重试', en: 'Assistant temporarily unavailable, please retry' },
    timeout: { zh: '助手响应超时，请稍后重试', en: 'Assistant timed out, please retry' },
    invalid_output: { zh: '助手返回了无法解析的内容', en: 'Assistant returned unparseable content' },
    process_error: { zh: '助手运行出错，请稍后重试', en: 'Assistant encountered an error, please retry' },
  };
  const msg = messages[code];
  return msg ? (zh ? msg.zh : msg.en) : (zh ? '助手运行失败，请稍后重试' : 'Assistant failed, please retry');
};

/** Extract the current "changes" value from a possibly-incomplete JSON text stream.
 *  opencode responds with {"summary":"...","changes":"<full markdown>"} — this
 *  lets us render the markdown live while it is still being generated.
 *  Tolerates ```json fences and pretty-printed JSON. */
function extractChangesFromStream(raw: string): string | null {
  const jsonText = raw.split('\n')
    .filter((line) => line.startsWith('📝 生成:'))
    .map((line) => line.slice('📝 生成:'.length).replace(/^\s/, ''))
    .join('');
  if (!jsonText) return null;
  const marker = '"changes"';
  const markerIdx = jsonText.indexOf(marker);
  if (markerIdx < 0) return null;
  // Skip past `"changes"` then optional whitespace + `:` then optional whitespace + `"`.
  let i = markerIdx + marker.length;
  while (i < jsonText.length && (jsonText[i] === ' ' || jsonText[i] === '\t' || jsonText[i] === '\n' || jsonText[i] === '\r')) i += 1;
  if (jsonText[i] !== ':') return null;
  i += 1;
  while (i < jsonText.length && (jsonText[i] === ' ' || jsonText[i] === '\t' || jsonText[i] === '\n' || jsonText[i] === '\r')) i += 1;
  if (jsonText[i] !== '"') return null;
  i += 1;
  let out = '';
  let escaped = false;
  for (; i < jsonText.length; i += 1) {
    const c = jsonText[i];
    if (escaped) {
      if (c === 'n') out += '\n';
      else if (c === 't') out += '\t';
      else if (c === 'r') out += '\r';
      else if (c === '"') out += '"';
      else if (c === '\\') out += '\\';
      else out += c;
      escaped = false;
      continue;
    }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"') break; // string closed — changes fully received
    out += c;
  }
  return out.length ? out : null;
}

export const AgentAssistPanel: React.FC<AgentAssistPanelProps> = ({ pageId, spaceId, snapshot, onApply, canEdit = true, canAccept = true, acceptUnavailableReason, supportsScopedApply = false, assistRequest, assistTargets, onNotesEvent, onRequestHandled }) => {
  const { language } = useLanguage();
  const { user } = useAuth();
  const zh = language === 'zh-CN';
  const [intent, setIntent] = useState('');
  const autoSubmittedRef = useRef(new Set<string>());
  const [targetKind, setTargetKind] = useState<AssistTarget['kind']>('document');
  const requestRef = useRef<AssistRequest | null>(null);
  const notesEventRef = useRef(onNotesEvent); notesEventRef.current = onNotesEvent;
  const emitNotes = useCallback((event: AssistNotesEvent['event'], candidate: AssistCandidate, editId?: string) => {
    if (candidate.noteIds?.length) notesEventRef.current?.({ event, taskId: candidate.taskId, noteIds: candidate.noteIds, candidate, editId, acceptedEditIds: candidate.acceptedEditIds });
  }, []);
  const [tasks, setTasks] = useState<AssistTask[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<{ identity: string; generation: number } | null>(null);
  const [pending, setPending] = useState<PendingReview[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const streamBufferRef = useRef<Map<string, string>>(new Map());
  const candidatesRef = useRef(new Map<string, AssistCandidate>());
  const [candidates, setCandidates] = useState(new Map<string, AssistCandidate>());
  const identity = `${user?.id ?? ''}:${spaceId}:${pageId}`;
  const identityRef = useRef(identity);
  const generationRef = useRef(0);
  const permissionRef = useRef(canEdit);
  if (identityRef.current !== identity || permissionRef.current !== canEdit) generationRef.current += 1;
  identityRef.current = identity;
  permissionRef.current = canEdit;
  const mountedRef = useRef(true);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const publishCandidates = useCallback(() => setCandidates(new Map(candidatesRef.current)), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; generationRef.current += 1; };
  }, []);

  useEffect(() => {
    candidatesRef.current.clear();
    setCandidates(new Map());
    streamBufferRef.current.clear();
    setTasks([]);
    setPending([]);
    setIntent(''); requestRef.current = null; autoSubmittedRef.current.clear(); setTargetKind('document');
    setSubmitting(false);
    setSubmissionError(null);
  }, [identity]);

  useEffect(() => {
    if (!assistRequest) return;
    requestRef.current = assistRequest; setIntent(assistRequest.intent); setTargetKind(assistRequest.assistTarget?.kind ?? 'document');
  }, [assistRequest?.id]);

  useEffect(() => {
    if (canEdit) return;
    setSubmitting(false);
    setSubmissionError(null);
    for (const [taskId, candidate] of candidatesRef.current) {
      if (candidate.status === 'ready' || candidate.status === 'generating') { candidatesRef.current.set(taskId, { ...candidate, status: 'conflict' }); emitNotes('fail', candidate); }
    }
    publishCandidates();
  }, [canEdit, publishCandidates, emitNotes]);

  const loadTasks = useCallback(async () => {
    const requestedIdentity = identity;
    const requestedGeneration = generationRef.current;
    try {
      const res = await api.get('/assist/tasks', { params: { pageId } });
      if (!mountedRef.current || generationRef.current !== requestedGeneration || identityRef.current !== requestedIdentity) return;
      const loadedTasks = Array.isArray(res.data) ? res.data : res.data.data || [];
      const recentTasks: AssistTask[] = loadedTasks.slice(0, MAX_ASSIST_TASKS);
      setTasks((prev) => {
        const streamMap = new Map(prev.map((t) => [t.id, { stream: t.streamContent, phase: t.phase }]));
        return recentTasks.map((t) => ({ ...t,
          streamContent: streamMap.get(t.id)?.stream || t.streamContent,
          phase: streamMap.get(t.id)?.phase || t.phase,
        }));
      });
      for (const task of recentTasks) {
        const candidate = candidatesRef.current.get(task.id);
        // Terminal decisions survive duplicate polling and socket completion.
        if (!candidate || candidate.status !== 'generating') continue;
        if (task.status === 'done') {
          const changes = task.result?.changes;
          const completed = completeAssistCandidate(candidate, typeof changes === 'string' ? changes : '', task.result?.summary);
          candidatesRef.current.set(task.id, completed); emitNotes(completed.status === 'ready' ? 'ready' : 'fail', completed);
        } else if (task.status === 'failed') {
          candidatesRef.current.set(task.id, { ...candidate, status: 'failed' }); emitNotes('fail', candidate);
        }
      }
      publishCandidates();
    } catch { /* keep existing */ }
  }, [identity, pageId, publishCandidates, emitNotes]);

  const loadTasksRef = useRef(loadTasks);
  loadTasksRef.current = loadTasks;

  const loadPending = useCallback(async () => {
    const requestedGeneration = generationRef.current;
    try {
      const res = await api.get('/review', { params: { spaceId } });
      const items: PendingReview[] = Array.isArray(res.data) ? res.data : res.data.data || [];
      if (!mountedRef.current || generationRef.current !== requestedGeneration || identityRef.current !== identity) return;
      setPending(items.filter((item) => item.status === 'pending_review'));
    } catch {
      if (mountedRef.current && generationRef.current === requestedGeneration && identityRef.current === identity) setPending([]);
    }
  }, [spaceId, identity]);

  useEffect(() => {
    void loadTasks();
    void loadPending();
    timerRef.current = setInterval(() => void loadTasks(), 3000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [loadTasks, loadPending]);

  // Socket.IO connection for streaming
  useEffect(() => {
    if (!user?.id || !pageId) return;

    const socketUrl = window.location.origin;
    const socket = io(socketUrl + '/collaboration', {
      transports: ['websocket', 'polling'],
      auth: { token: localStorage.getItem('token') },
    });
    socketRef.current = socket;

    let mounted = true;

    socket.on('connect', () => {
      socket.emit('joinPage', {
        pageId,
        userId: user.id,
        userName: user.name || user.email || 'Anonymous',
      });
    });

    socket.on('assistStream', (data: { taskId: string; chunk: string }) => {
      if (!mounted || identityRef.current !== identity) return;
      const candidate = candidatesRef.current.get(data.taskId);
      if (!candidate || candidate.status !== 'generating') return;
      const current = streamBufferRef.current.get(data.taskId) || '';
      const updated = current + data.chunk;
      streamBufferRef.current.set(data.taskId, updated);
      
      const partial = extractChangesFromStream(updated);
      if (partial !== null) {
        candidatesRef.current.set(data.taskId, { ...candidate, content: partial });
        publishCandidates();
      }

      setTasks((prev) => {
        const exists = prev.some((t) => t.id === data.taskId);
        const task = {
          id: data.taskId,
          intent: prev.find((t) => t.id === data.taskId)?.intent || '',
          status: 'running' as AssistTaskStatus,
          streamContent: updated,
          phase: (updated.length > 100 ? 'generating' : 'thinking') as AssistPhase,
        };
        const next = !exists ? [task, ...prev] : prev.map((t) => (t.id === data.taskId ? { ...t, streamContent: updated, phase: task.phase } : t));
        return next.slice(0, MAX_ASSIST_TASKS);
      });
    });

    socket.on('assistComplete', (data: { taskId: string }) => {
      if (!mounted || identityRef.current !== identity) return;
      setTasks((prev) => prev.map((t) => (t.id === data.taskId ? { ...t, phase: 'complete' } : t)));
      streamBufferRef.current.delete(data.taskId);
      if (mounted) void loadTasksRef.current();
    });

    socket.on('assistError', (data: { taskId: string; error: string }) => {
      if (!mounted || identityRef.current !== identity) return;
      const candidate = candidatesRef.current.get(data.taskId);
      if (candidate?.status === 'generating') {
        candidatesRef.current.set(data.taskId, { ...candidate, status: 'failed' }); emitNotes('fail', candidate);
        publishCandidates();
      }
      setTasks((prev) => prev.map((t) => (t.id === data.taskId ? { ...t, status: 'failed', phase: 'error', streamContent: undefined } : t)));
      streamBufferRef.current.delete(data.taskId);
    });

    return () => {
      mounted = false;
      socket.disconnect();
      socketRef.current = null;
      streamBufferRef.current.clear();
    };
  }, [identity, user?.id, pageId, publishCandidates, emitNotes]);

  const accept = (taskId: string, editId?: string) => {
    const candidate = candidatesRef.current.get(taskId);
    if (!candidate || candidate.status !== 'ready' || !canAccept || (candidate.assistTarget && !supportsScopedApply)) return;
    const current = { ...snapshotRef.current(), pageId, spaceId, userId: user?.id ?? '', canEdit: canEditRef.current };
    const application = applyCandidateToDraft(candidate, current, editId);
    if (application.status !== 'applied') {
      candidatesRef.current.set(taskId, { ...candidate, status: 'conflict' }); emitNotes('fail', candidate);
    } else {
      // Lock before invoking parent. Publish ledger only after parent synchronously commits live source.
      candidatesRef.current.set(taskId, { ...candidate, status: 'accepted' });
      const applied = editId ? onApply?.(candidate, editId) === true : onApply?.(candidate) === true;
      if (!applied) { candidatesRef.current.set(taskId, { ...candidate, status: 'conflict' }); emitNotes('fail', candidate); }
      else {
        const completed = !candidate.editPlan || application.acceptedEditIds.length === candidate.editPlan.edits.length;
        const accepted: AssistCandidate = { ...candidate, acceptedEditIds: application.acceptedEditIds, status: completed ? 'accepted' : 'ready' };
        candidatesRef.current.set(taskId, accepted); emitNotes('accept', accepted, editId);
      }
    }
    publishCandidates();
  };
  const discard = (taskId: string) => {
    const candidate = candidatesRef.current.get(taskId);
    if (!candidate || candidate.status === 'accepted' || candidate.status === 'discarded') return;
    candidatesRef.current.set(taskId, { ...candidate, status: 'discarded' }); emitNotes('discard', candidate);
    streamBufferRef.current.delete(taskId);
    publishCandidates();
  };
  const submit = async () => {
    if (!intent.trim() || submitting || !canEditRef.current || !user?.id) return;
    const requestedIdentity = identity;
    const requestedGeneration = generationRef.current;
    const submitted = { ...snapshotRef.current() };
    const request = requestRef.current;
    const selectedTarget = targetKind === 'document'
      ? (request?.assistTarget?.kind === 'document' ? request.assistTarget : submitted.assistTarget?.kind === 'document' ? submitted.assistTarget : undefined)
      : request?.assistTarget?.kind === targetKind ? request.assistTarget : assistTargets?.[targetKind];
    if ((targetKind !== 'document' && !selectedTarget) || selectedTarget && (!validateAssistTarget(submitted.content, selectedTarget) || selectedTarget.baseUpdatedAt !== submitted.updatedAt)) {
      setSubmissionError({ identity: requestedIdentity, generation: requestedGeneration }); return;
    }
    const submittedIntent = intent.trim();
    setSubmitting(true);
    setSubmissionError(null);
    try {
      const created = await api.post('/assist/tasks', { spaceId, pageId, intent: submittedIntent, snapshot: { title: submitted.title, content: submitted.content, updatedAt: submitted.updatedAt, ...(selectedTarget ? { assistTarget: selectedTarget } : {}) } });
      if (!mountedRef.current || generationRef.current !== requestedGeneration || identityRef.current !== requestedIdentity || !canEditRef.current) return;
      if (created.data?.id) {
        const taskId = created.data.id;
        const candidate: AssistCandidate = { taskId, pageId, spaceId, userId: user.id,
          baseTitle: submitted.title, baseContent: submitted.content, baseUpdatedAt: submitted.updatedAt,
          baseDraftRevision: submitted.draftRevision, baseRemoteRevision: submitted.remoteRevision,
          content: '', status: 'generating', assistTarget: selectedTarget ?? undefined, noteIds: request?.noteIds ? [...request.noteIds] : [],
        };
        candidatesRef.current.set(taskId, candidate); emitNotes('dispatch', candidate);
        if (request) { onRequestHandled?.(request.id); requestRef.current = null; }
        while (candidatesRef.current.size > MAX_ASSIST_TASKS) { const oldestId = candidatesRef.current.keys().next().value!; const oldest = candidatesRef.current.get(oldestId)!; if (oldest.status !== 'accepted' && oldest.status !== 'discarded') emitNotes('discard', oldest); candidatesRef.current.delete(oldestId); }
        setTasks((prev) => [{ id: taskId, intent: submittedIntent, status: 'queued' as AssistTaskStatus }, ...prev.filter((task) => task.id !== taskId)].slice(0, MAX_ASSIST_TASKS));
        publishCandidates();
      }
      setIntent('');
      await loadTasks();
    } catch {
      // Do not expose server/provider errors or let a stale request affect another context.
      if (mountedRef.current && generationRef.current === requestedGeneration
        && identityRef.current === requestedIdentity && canEditRef.current) {
        setSubmissionError({ identity: requestedIdentity, generation: requestedGeneration });
      }
    } finally {
      if (mountedRef.current && generationRef.current === requestedGeneration && identityRef.current === requestedIdentity) setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!assistRequest?.autoSubmit || !assistRequest.noteIds?.length || autoSubmittedRef.current.has(assistRequest.id) || requestRef.current?.id !== assistRequest.id || intent !== assistRequest.intent || submitting || !canEdit) return;
    autoSubmittedRef.current.add(assistRequest.id); void submit();
  }, [assistRequest?.id, intent, targetKind, submitting, canEdit]);

  return (
    <aside className="flex w-80 shrink-0 flex-col rounded-xl border border-gray-200 bg-white shadow-sm" data-testid="agent-assist-panel">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
        <Bot size={18} className="text-blue-600" />
        <h2 className="text-sm font-semibold">{zh ? '编辑辅助' : 'Editing assist'}</h2>
      </div>
      <div className="flex-1 space-y-4 overflow-auto p-4">
        <div>
          <label className="mb-2 block text-xs text-gray-600">{zh ? '修改范围' : 'Edit scope'}
            <select aria-label={zh ? '修改范围' : 'Edit scope'} value={targetKind} disabled={submitting || !canEdit} onChange={(event) => { setTargetKind(event.target.value as AssistTarget['kind']); }} className="ml-2 rounded-lg border border-gray-200 p-1">
              <option value="document">{zh ? '整篇文档' : 'Document'}</option>
              <option value="selection" disabled={!assistTargets?.selection && assistRequest?.assistTarget?.kind !== 'selection'}>{zh ? '所选段落' : 'Selection'}</option>
              <option value="section" disabled={!assistTargets?.section && assistRequest?.assistTarget?.kind !== 'section'}>{zh ? '当前章节' : 'Section'}</option>
            </select>
          </label>
          {(requestRef.current?.assistTarget?.kind === targetKind ? requestRef.current.assistTarget : (targetKind !== 'document' ? assistTargets?.[targetKind] : null)) ? <blockquote className="mb-2 max-h-24 overflow-auto whitespace-pre-wrap border-l-2 pl-2 text-xs text-gray-500">{(requestRef.current?.assistTarget?.kind === targetKind ? requestRef.current.assistTarget : (targetKind !== 'document' ? assistTargets?.[targetKind] : null))?.quote}</blockquote> : null}
          <p className="mb-2 text-xs text-gray-500">{zh ? '只修改所选范围；候选须审阅接受后才进入草稿。' : 'Change only the chosen scope. Review and accept the candidate before it enters your draft.'}</p>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">{zh ? '想让智能体做什么？' : 'What should the agent do?'}</label>
          <textarea
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            rows={3}
            placeholder={zh ? '例如：帮我续写这段、润色开头、补充一个示例…' : 'e.g. continue this section, polish the intro, add an example…'}
            className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            data-testid="assist-intent"
          />
          <button
            onClick={() => void submit()}
            disabled={!intent.trim() || submitting || !canEdit}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            data-testid="assist-submit"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {zh ? '提交任务' : 'Run task'}
          </button>
          {submissionError?.identity === identity && submissionError.generation === generationRef.current ? (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {zh ? '任务提交失败，草稿未改动。请重试。' : 'Could not submit the task. Your draft is unchanged. Please retry.'}
            </p>
          ) : null}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500">{zh ? '辅助任务' : 'Assist tasks'}</p>
            <button onClick={() => void loadTasks()} className="text-gray-400 hover:text-gray-700" aria-label="refresh">
              <RefreshCw size={13} />
            </button>
          </div>
          {tasks.length ? (
            <ul className="space-y-2">
              {tasks.map((task) => {
                const status = STATUS_LABEL[task.status];
                const phase = task.phase;
                const phaseLabel = phase ? PHASE_LABEL[phase] : null;
                const metadata = task.status === 'done' || task.status === 'failed'
                  ? routingMeta(task.result, zh)
                  : null;
                const errorCode = task.status === 'failed' ? routingErrorCode(task.result, zh) : null;
                const streamContent = task.streamContent;
                const isStreaming = task.status === 'running' && streamContent;
                
                return (
                  <li key={task.id} className="rounded-lg border border-gray-200 p-2.5" data-testid={`assist-task-${task.id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-xs font-medium text-gray-700">{task.intent}</p>
                      <span className={`flex shrink-0 items-center gap-1 text-xs ${status.cls}`}>
                        {task.status === 'running' || task.status === 'queued' ? <Loader2 size={11} className="animate-spin" /> : task.status === 'done' ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                        {zh ? status.zh : status.en}
                      </span>
                    </div>
                    
                    {/* Phase indicator */}
                    {phaseLabel && task.status === 'running' && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-blue-600">
                        {phaseLabel.icon}
                        <span>{zh ? phaseLabel.zh : phaseLabel.en}</span>
                      </div>
                    )}
                    
                    {/* Streaming content */}
                    {isStreaming && streamContent && (
                      <div className="mt-2 max-h-48 overflow-auto rounded bg-blue-50 p-2">
                        <p className="text-xs text-gray-700">{zh ? '助手正在处理…正文未改动。' : 'Assistant is working… Your draft is unchanged.'}</p>
                      </div>
                    )}
                    
                    {metadata ? <p className="mt-1 text-[11px] text-gray-500">{metadata}</p> : null}
                    {candidates.get(task.id) ? <>
                      {!canAccept ? <p className="mt-2 text-xs text-gray-600">{acceptUnavailableReason ?? (zh ? '返回编辑模式后可接受候选。' : 'Return to edit to accept this candidate.')}</p> : null}
                      <AssistCandidateReview candidate={candidates.get(task.id)!} canEdit={canEdit && canAccept && (!candidates.get(task.id)?.assistTarget || supportsScopedApply)} supportsScopedApply={supportsScopedApply} onAccept={(editId) => accept(task.id, editId)} onDiscard={() => discard(task.id)} />
                    </> : task.status === 'done' && task.result?.changes ? (
                      <details className="mt-2"><summary className="cursor-pointer text-xs">{zh ? '查看历史生成内容（不能直接应用）' : 'View historical output (cannot apply)'}</summary>
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">{task.result.changes}</pre>
                      </details>
                    ) : null}
                    {errorCode ? <p className="mt-1 text-xs text-red-600">{errorCode}</p> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-gray-400">{zh ? '还没有辅助任务。' : 'No assist tasks yet.'}</p>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-500">{zh ? '待我审批的变更' : 'Awaiting my review'}</p>
          {pending.length ? (
            <ul className="space-y-1.5">
              {pending.map((item) => (
                <li key={item.id}>
                  <a href={`/review?changeSet=${item.id}`} className="block rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 hover:bg-amber-100">
                    {item.title}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-400">{zh ? '暂无待审变更。' : 'Nothing pending review.'}</p>
          )}
        </div>
      </div>
    </aside>
  );
};
