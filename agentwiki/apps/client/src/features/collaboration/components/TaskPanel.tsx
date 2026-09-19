import React from 'react';
import { CheckCircle2, Circle, LoaderCircle, XCircle } from 'lucide-react';
import type { CollaborationRun, CollaborationTask, HumanSpaceRole } from '../types';

const ZH_WORKFLOW_TEXT: Record<string, string> = {
  'Clarify scope': '澄清范围',
  'Define acceptance criteria': '定义验收标准',
  'Split independent work': '拆分独立工作',
  'Plan tests and integration': '规划测试与集成',
  'Write failing tests': '编写失败测试',
  'Implement module A': '实现模块 A',
  'Implement module B': '实现模块 B',
  'Run focused tests': '运行专项测试',
  'Run integration tests': '运行集成测试',
  'Review correctness': '审查正确性',
  'Review security and integration risk': '审查安全与集成风险',
  'Resolve findings': '解决发现的问题',
  'Recheck repaired behavior': '复查修复后的行为',
  'Summarize changes': '总结变更',
  'Collect evidence and residual risks': '收集证据与残余风险',
  'Extract scoring matrix': '提取评分矩阵',
  'Identify mandatory gates': '识别强制门槛',
  'Catalog supplied materials': '整理已提供材料',
  'Mark missing or unverifiable materials': '标记缺失或不可验证材料',
  'Map scoring items': '映射评分项',
  'Map evidence and image-text relationships': '映射证据与图文关系',
  'Write technical solution': '撰写技术方案',
  'Link technical evidence': '关联技术证据',
  'Write delivery and support': '撰写交付与支持方案',
  'Check commitments against materials': '根据材料核对承诺',
  'Check scoring and mandatory coverage': '检查评分与强制项覆盖',
  'Check outline mapping': '检查大纲映射',
  'Check image-text mapping': '检查图文映射',
  'Check cross-draft consistency': '检查多稿一致性',
  'Merge drafts': '合并草稿',
  'Resolve coverage findings': '解决覆盖问题',
  'Polish terminology and flow': '润色术语与行文',
  'Prepare the external export reference': '准备外部导出引用',
  'Record version and content hash': '记录版本与内容哈希',
  'Define question and contribution': '定义问题与贡献',
  'Define evidence boundary': '定义证据边界',
  'Collect source identifiers': '收集来源标识',
  'Synthesize literature themes': '综合文献主题',
  'Define method': '定义方法',
  'Record assumptions and limitations': '记录假设与局限',
  'Draft sections': '起草章节',
  'Mark claims requiring citations': '标记需要引用的主张',
  'Mark unverifiable claims': '标记不可验证主张',
  'Resolve citation findings': '解决引用问题',
  'Edit argument and style': '编辑论证与文风',
  'Define audience and promise': '定义受众与承诺',
  'Define duration and format': '定义时长与形式',
  'Collect fact cards': '收集事实卡片',
  'Mark uncertain claims': '标记不确定主张',
  'Design hook': '设计开场钩子',
  'Budget timing by beat': '按节拍规划时长',
  'Write voiceover': '撰写旁白',
  'Estimate spoken duration': '估算口播时长',
  'Map shots to beats': '将镜头映射到节拍',
  'Map text and asset references': '映射文本与素材引用',
  'Check duration': '检查时长',
  'Check brand tone': '检查品牌语气',
  'Check voiceover and storyboard alignment': '检查旁白与分镜一致性',
  'Resolve review findings': '解决审核问题',
  'Merge final production script': '合并最终制作脚本',
  'Define world rules': '定义世界规则',
  'Define locations and chronology': '定义地点与时间线',
  'Define character arcs': '定义角色弧光',
  'Define relationships and knowledge boundaries': '定义关系与认知边界',
  'Plan chapter and scene structure': '规划章节与场景结构',
  'Plan continuity checkpoints': '规划连续性检查点',
  'Write chapters sequentially': '按顺序撰写章节',
  'Track character and world state': '跟踪角色与世界状态',
  'Check chronology and locations': '检查时间线与地点',
  'Check character state': '检查角色状态',
  'Check unresolved threads': '检查未解决线索',
  'Resolve continuity findings': '解决连续性问题',
  'Edit style and transitions': '编辑文风与过渡',
  'Prepare export reference': '准备导出引用',
};

const localizeWorkflowText = (value: string | undefined, t: (key: string) => string) => {
  if (!value) return '';
  if (t('common.todo') === 'Todo') return value;
  const slashIndex = value.indexOf(' / ');
  if (slashIndex > 0) return value.slice(0, slashIndex);
  if (value.startsWith('Complete ')) return `完成${value.slice('Complete '.length)}`;
  return ZH_WORKFLOW_TEXT[value] ?? value;
};

export const TaskPanel: React.FC<{
  run: CollaborationRun;
  role?: HumanSpaceRole;
  userId?: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  onHistory: (kind: 'todos' | 'attempts') => void;
  onAction: (kind: 'retry' | 'reassign' | 'skip', task: CollaborationTask) => void;
  agentNames?: Map<string, string>;
}> = ({ run, role, userId, t, onHistory, onAction, agentNames = new Map() }) => {
  const manager = role === 'owner' || role === 'admin';
  const canOperate = manager || run.startedById === userId;
  const tasks = [...(run.tasks ?? [])].sort((a, b) => a.ordinal - b.ordinal);
  return (
    <main data-testid="dashboard-section-current-task" className="order-2 min-w-0 space-y-4 lg:col-start-2 lg:row-span-3">
      <h2 className="text-lg font-semibold">{t('collaboration.dashboard.tasks')}</h2>
      {!tasks.length ? <div className="rounded-xl border bg-white py-10 text-center text-sm text-gray-500">{t('collaboration.dashboard.noTasks')}</div> : tasks.map((task) => {
        const activeAttempt = [...task.attempts].reverse().find((attempt) => ['claimed', 'running'].includes(attempt.status));
        return <article key={task.id} className="min-w-0 rounded-xl border bg-white p-4">
          <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-gray-500">{t('collaboration.dashboard.generation', { value: task.generation })}</p><h3 className="mt-1 break-words font-semibold">{localizeWorkflowText(task.name, t)}</h3>{task.objectivePreview || task.objective ? <p className="mt-1 break-words text-sm text-gray-600">{localizeWorkflowText(task.objectivePreview ?? task.objective, t)}</p> : null}</div><span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs">{t(`collaboration.taskStatus.${task.status}`)}</span></div>
          <p className="mt-3 break-all text-xs text-gray-500">{t('collaboration.dashboard.frozenAssignee')}: {agentNames.get(task.assigneeAgentId) ?? task.assigneeAgentId}</p>
          {activeAttempt ? <p className="mt-1 text-xs text-gray-500">{t('collaboration.dashboard.leaseExpires', { date: new Date(activeAttempt.leaseExpiresAt).toLocaleString() })}</p> : null}
          <ol className="mt-4 space-y-2">{[...task.todos].sort((a, b) => a.ordinal - b.ordinal).map((todo, index) => <li key={todo.id} aria-label={`${t('common.todo')} ${index + 1}: ${localizeWorkflowText(todo.name, t)}, ${t(`collaboration.todoStatus.${todo.status}`)}`} className="flex min-w-0 items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">{todo.status === 'done' ? <CheckCircle2 size={15} className="shrink-0 text-green-600" aria-hidden="true" /> : todo.status === 'doing' ? <LoaderCircle size={15} className="shrink-0 text-blue-600" aria-hidden="true" /> : todo.status === 'failed' ? <XCircle size={15} className="shrink-0 text-red-600" aria-hidden="true" /> : <Circle size={15} className="shrink-0 text-gray-400" aria-hidden="true" />}<span className="min-w-0 break-words">{index + 1}. {localizeWorkflowText(todo.name, t)}</span></li>)}</ol>
          {task.todoCounts && task.todoCounts.total > task.todos.length ? <p className="mt-2 text-xs text-gray-500">{task.todos.length} / {task.todoCounts.total} {t('common.todo')}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">{canOperate && ['failed', 'retry_wait'].includes(task.status) ? <button type="button" onClick={() => onAction('retry', task)} className="min-h-9 rounded-lg border px-3 text-sm">{t('collaboration.dashboard.retryTask')}</button> : null}{canOperate && !['submitted', 'completed', 'skipped'].includes(task.status) ? <button type="button" onClick={() => onAction('reassign', task)} className="min-h-9 rounded-lg border px-3 text-sm">{t('collaboration.dashboard.reassign')}</button> : null}{manager && task.skippable && !['submitted', 'completed', 'skipped'].includes(task.status) ? <button type="button" onClick={() => onAction('skip', task)} className="min-h-9 rounded-lg border border-red-200 px-3 text-sm text-red-700">{t('collaboration.dashboard.skip')}</button> : null}</div>
        </article>;
      })}
      {tasks.length ? <div className="flex flex-wrap gap-2"><button type="button" onClick={() => onHistory('todos')} className="min-h-9 rounded-lg border bg-white px-3 text-sm">{t('collaboration.dashboard.viewAllTodos')}</button><button type="button" onClick={() => onHistory('attempts')} className="min-h-9 rounded-lg border bg-white px-3 text-sm">{t('collaboration.dashboard.viewAllAttempts')}</button></div> : null}
    </main>
  );
};
