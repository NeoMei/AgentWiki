import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import type { AgentTurn } from './agentSessionTypes';

/** Execution metadata is deliberately separate from the streamed answer. */
export function AgentActivity({ status, progress, createdAt }: {
  status: 'sending' | 'queued' | 'running'; progress?: AgentTurn['progress']; createdAt?: string;
}) {
  const { language } = useLanguage(), zh = language === 'zh-CN';
  const [startedAt] = useState(() => {
    const created = createdAt ? Date.parse(createdAt) : NaN;
    return Number.isFinite(created) ? Math.min(created, Date.now()) : Date.now();
  });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const phases = zh
    ? { preparing: '正在准备上下文', waiting: '正在等待模型响应', generating: '正在生成回答', finalizing: '正在整理结果' }
    : { preparing: 'Preparing context', waiting: 'Waiting for model', generating: 'Generating response', finalizing: 'Finalizing result' };
  const label = status === 'sending' ? (zh ? '正在发送请求' : 'Sending request')
    : status === 'queued' ? (zh ? '正在排队等待执行' : 'Queued for execution')
      : progress && phases[progress.phase] || (zh ? 'Agent 正在执行' : 'Agent is working');
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return <div className="agent-activity">
    <div role="status" aria-label={zh ? 'Agent 执行状态' : 'Agent activity'} className="agent-activity-status">
      <LoaderCircle aria-hidden="true" size={15} className="agent-activity-spinner" />
      <span>{label}</span>
      {status === 'running' && progress?.attempt && progress.attempt > 1 ? <span className="agent-activity-retry">{zh ? `正在重试 · 第 ${progress.attempt} 次尝试` : `Retry · attempt ${progress.attempt}`}</span> : null}
    </div>
    <span aria-live="off" className="agent-activity-elapsed">{zh ? `已用时 ${seconds} 秒` : `${seconds}s elapsed`}</span>
  </div>;
}
