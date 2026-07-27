import React, { useEffect, useState } from 'react';
import { Bot, Check, Copy, RefreshCw, Send } from 'lucide-react';
import api from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import { buildAssistTask } from './assistTask';

interface AgentAssistPanelProps {
  pageId: string;
  pageTitle: string;
  spaceId: string;
}

export const AgentAssistPanel: React.FC<AgentAssistPanelProps> = ({ pageId, pageTitle, spaceId }) => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const [intent, setIntent] = useState('');
  const [task, setTask] = useState('');
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<any[]>([]);

  const loadPending = async () => {
    try {
      const res = await api.get('/review', { params: { spaceId } });
      const items = Array.isArray(res.data) ? res.data : res.data.data || [];
      setPending(items.filter((item: any) => item.status === 'pending_review'));
    } catch {
      setPending([]);
    }
  };

  useEffect(() => { void loadPending(); }, [spaceId]);

  const generate = () => {
    if (!intent.trim()) return;
    setTask(buildAssistTask({ baseUrl: `${window.location.origin}/api`, pageId, pageTitle, intent: intent.trim() }, zh));
    setCopied(false);
  };

  const copy = () => {
    void navigator.clipboard.writeText(task);
    setCopied(true);
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
            onClick={generate}
            disabled={!intent.trim()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            data-testid="assist-generate"
          >
            <Send size={14} /> {zh ? '生成任务' : 'Build task'}
          </button>
        </div>

        {task ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500">{zh ? '把这段任务发给本地智能体' : 'Send this task to your local agent'}</p>
              <button onClick={copy} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800" data-testid="assist-copy">
                {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                {copied ? (zh ? '已复制' : 'Copied') : (zh ? '复制' : 'Copy')}
              </button>
            </div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border bg-gray-50 p-3 text-xs text-gray-700" data-testid="assist-task">{task}</pre>
          </div>
        ) : null}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500">{zh ? '待我审批的变更' : 'Changes awaiting my review'}</p>
            <button onClick={() => void loadPending()} className="text-gray-400 hover:text-gray-700" aria-label="refresh">
              <RefreshCw size={13} />
            </button>
          </div>
          {pending.length ? (
            <ul className="space-y-1.5">
              {pending.map((item: any) => (
                <li key={item.id}>
                  <a href={`/review?changeSet=${item.id}`} className="block rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 hover:bg-amber-100" data-testid={`assist-pending-${item.id}`}>
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
