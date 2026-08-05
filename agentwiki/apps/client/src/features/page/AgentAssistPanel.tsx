import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, CheckCircle2, Loader2, RefreshCw, Send, XCircle } from 'lucide-react';
import api from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';

interface AgentAssistPanelProps {
  pageId: string;
  pageTitle: string;
  spaceId: string;
  snapshot: () => { title: string; content: string; updatedAt?: string };
}

type AssistTaskStatus = 'queued' | 'running' | 'done' | 'failed';

interface AssistAttemptResult {
  errorCode?: string;
}

interface AssistRoutingResult {
  changes?: string;
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
}

interface PendingReview {
  id: string;
  title: string;
  status: string;
}

const STATUS_LABEL: Record<AssistTaskStatus, { zh: string; en: string; cls: string }> = {
  queued: { zh: '排队中', en: 'Queued', cls: 'text-amber-600' },
  running: { zh: '生成中…', en: 'Running…', cls: 'text-blue-600' },
  done: { zh: '已完成', en: 'Done', cls: 'text-green-600' },
  failed: { zh: '失败', en: 'Failed', cls: 'text-red-600' },
};

const routingMeta = (result: AssistRoutingResult | undefined, zh: boolean) => {
  if (!result?.model) return null;
  const tier = result.modelTier === 'paid' ? (zh ? '付费' : 'Paid') : (zh ? '免费' : 'Free');
  const attempts = zh
    ? `${result.attemptCount} 次尝试`
    : `${result.attemptCount} ${result.attemptCount === 1 ? 'attempt' : 'attempts'}`;
  const tokens = `${new Intl.NumberFormat(zh ? 'zh-CN' : 'en-US').format(result.usage?.total || 0)} tokens`;
  return `${result.model} · ${tier} · ${attempts} · ${tokens} · $${Number(result.cost || 0).toFixed(6)}`;
};

const routingErrorCode = (result: AssistRoutingResult | undefined) => {
  const attempts = result?.attempts;
  return attempts?.[attempts.length - 1]?.errorCode || null;
};

export const AgentAssistPanel: React.FC<AgentAssistPanelProps> = ({ pageId, spaceId, snapshot }) => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const [intent, setIntent] = useState('');
  const [tasks, setTasks] = useState<AssistTask[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState<PendingReview[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      const res = await api.get('/assist/tasks', { params: { pageId } });
      setTasks(Array.isArray(res.data) ? res.data : res.data.data || []);
    } catch {
      /* keep existing */
    }
  }, [pageId]);

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

  const submit = async () => {
    if (!intent.trim() || submitting) return;
    setSubmitting(true);
    try {
      await api.post('/assist/tasks', {
        spaceId,
        pageId,
        intent: intent.trim(),
        snapshot: snapshot(),
      });
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
                const metadata = task.status === 'done' || task.status === 'failed'
                  ? routingMeta(task.result, zh)
                  : null;
                const errorCode = task.status === 'failed' ? routingErrorCode(task.result) : null;
                return (
                  <li key={task.id} className="rounded-lg border border-gray-200 p-2.5" data-testid={`assist-task-${task.id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-xs font-medium text-gray-700">{task.intent}</p>
                      <span className={`flex shrink-0 items-center gap-1 text-xs ${status.cls}`}>
                        {task.status === 'running' || task.status === 'queued' ? <Loader2 size={11} className="animate-spin" /> : task.status === 'done' ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                        {zh ? status.zh : status.en}
                      </span>
                    </div>
                    {metadata ? <p className="mt-1 text-[11px] text-gray-500">{metadata}</p> : null}
                    {task.status === 'done' && task.result?.changes ? (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-xs text-blue-600">{zh ? '查看建议内容' : 'View suggestion'}</summary>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-700">{task.result.changes}</pre>
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
