import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, CheckCircle2, Loader2, RefreshCw, Send, XCircle, Brain, Sparkles } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';

interface AgentAssistPanelProps {
  pageId: string;
  pageTitle: string;
  spaceId: string;
  snapshot: () => { title: string; content: string; updatedAt?: string };
  onApply?: (changes: string) => void;
  onStreamUpdate?: (content: string) => void;
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

export const AgentAssistPanel: React.FC<AgentAssistPanelProps> = ({ pageId, spaceId, snapshot, onApply, onStreamUpdate }) => {
  const { language } = useLanguage();
  const { user } = useAuth();
  const zh = language === 'zh-CN';
  const [intent, setIntent] = useState('');
  const [tasks, setTasks] = useState<AssistTask[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState<PendingReview[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const streamBufferRef = useRef<Map<string, string>>(new Map());
  const appliedRef = useRef<Set<string>>(new Set());
  const eligibleTaskIdsRef = useRef<Set<string>>(new Set());
  const onStreamUpdateRef = useRef(onStreamUpdate);
  onStreamUpdateRef.current = onStreamUpdate;

  useEffect(() => {
    eligibleTaskIdsRef.current.clear();
    appliedRef.current.clear();
    streamBufferRef.current.clear();
  }, [pageId]);

  const loadTasks = useCallback(async () => {
    try {
      const res = await api.get('/assist/tasks', { params: { pageId } });
      const loadedTasks = Array.isArray(res.data) ? res.data : res.data.data || [];
      const recentTasks = loadedTasks.slice(0, MAX_ASSIST_TASKS);
      setTasks((prev) => {
        const streamMap = new Map(prev.map((t) => [t.id, { stream: t.streamContent, phase: t.phase }]));
        return recentTasks.map((t: AssistTask) => ({
          ...t,
          streamContent: streamMap.get(t.id)?.stream || t.streamContent,
          phase: streamMap.get(t.id)?.phase || t.phase,
        }));
      });
      
      // Auto-apply completed changes directly into the editor — WYSIWYG.
      // Each task is applied exactly once (tracked by appliedRef).
      if (onApply) {
        for (const task of recentTasks) {
          if (task.status === 'done' && task.result?.changes && eligibleTaskIdsRef.current.has(task.id) && !appliedRef.current.has(task.id)) {
            appliedRef.current.add(task.id);
            onApply(task.result.changes);
          }
        }
      }
    } catch {
      /* keep existing */
    }
  }, [pageId, onApply]);

  const loadTasksRef = useRef(loadTasks);
  loadTasksRef.current = loadTasks;

  const loadPending = useCallback(async () => {
    try {
      const res = await api.get('/review', { params: { spaceId } });
      const items: PendingReview[] = Array.isArray(res.data) ? res.data : res.data.data || [];
      setPending(items.filter((item) => item.status === 'pending_review'));
    } catch {
      setPending([]);
    }
  }, [spaceId]);

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
      const current = streamBufferRef.current.get(data.taskId) || '';
      const updated = current + data.chunk;
      streamBufferRef.current.set(data.taskId, updated);
      
      // Live-apply the markdown currently being generated to the editor.
      if (eligibleTaskIdsRef.current.has(data.taskId) && onStreamUpdateRef.current) {
        const partial = extractChangesFromStream(updated);
        if (partial) onStreamUpdateRef.current(partial);
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
      setTasks((prev) => prev.map((t) => (t.id === data.taskId ? { ...t, phase: 'complete' } : t)));
      streamBufferRef.current.delete(data.taskId);
      if (mounted) void loadTasksRef.current();
    });

    socket.on('assistError', (data: { taskId: string; error: string }) => {
      setTasks((prev) => prev.map((t) => (t.id === data.taskId ? { ...t, phase: 'error', streamContent: data.error } : t)));
      streamBufferRef.current.delete(data.taskId);
    });

    return () => {
      mounted = false;
      socket.disconnect();
      socketRef.current = null;
      streamBufferRef.current.clear();
    };
  }, [user?.id, pageId]);

  const submit = async () => {
    if (!intent.trim() || submitting) return;
    setSubmitting(true);
    try {
      const created = await api.post('/assist/tasks', {
        spaceId,
        pageId,
        intent: intent.trim(),
        snapshot: snapshot(),
      });
      if (created.data?.id) eligibleTaskIdsRef.current.add(created.data.id);
      setIntent('');
      await loadTasks();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col rounded-xl border border-gray-200 bg-white shadow-sm" data-testid="agent-assist-panel">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
        <Bot size={18} className="text-blue-600" />
        <h2 className="text-sm font-semibold">{zh ? '编辑辅助' : 'Editing assist'}</h2>
      </div>
      <div className="flex-1 space-y-4 overflow-auto p-4">
        <div>
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
            disabled={!intent.trim() || submitting}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            data-testid="assist-submit"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {zh ? '提交任务' : 'Run task'}
          </button>
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
                        <pre className="whitespace-pre-wrap text-xs text-gray-700">{streamContent}</pre>
                      </div>
                    )}
                    
                    {metadata ? <p className="mt-1 text-[11px] text-gray-500">{metadata}</p> : null}
                    {task.status === 'done' && task.result?.changes ? (
                      <div className="mt-1.5 rounded-md border border-green-200 bg-green-50 p-2">
                        {task.result?.summary ? (
                          <p className="text-[11px] leading-relaxed text-green-800">{task.result.summary}</p>
                        ) : (
                          <p className="text-[11px] text-green-600">{zh ? '内容已更新到编辑器' : 'Content applied to editor'}</p>
                        )}
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[11px] font-medium text-green-700">{zh ? '查看生成内容' : 'View generated content'}</summary>
                          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-[11px] leading-relaxed text-gray-700">{task.result.changes}</pre>
                        </details>
                      </div>
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
