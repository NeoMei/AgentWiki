import type { TaskboardTask } from './types';

/** Faithful port of the project-taskboard 项目全景 rendering logic (assets/index.html). */

export const TB_LABELS: Record<string, string> = {
  done: '已完成',
  passed: '已通过',
  in_progress: '进行中',
  blocked: '已阻塞',
  todo: '未开始',
  unknown: '待核实',
  in_review: '待验收',
  canceled: '已取消',
  not_applicable: '不适用',
};

export const TB_SCOPE_LABELS: Record<string, string> = {
  required: '必需',
  optional_external: '可选外部',
  canceled: '已取消',
  coordination: '协调',
  excluded: '其他排除',
};

export function tbKids(tasks: TaskboardTask[], id: string): TaskboardTask[] {
  return tasks.filter((t) => t.parent_id === id);
}

export function tbDescendants(tasks: TaskboardTask[], id: string): TaskboardTask[] {
  const out: TaskboardTask[] = [];
  const stack = [...tbKids(tasks, id)];
  while (stack.length) {
    const t = stack.pop()!;
    out.push(t);
    stack.push(...tbKids(tasks, t.id));
  }
  return out;
}

export function tbTaskLeaves(tasks: TaskboardTask[], id: string): TaskboardTask[] {
  const root = tasks.find((t) => t.id === id);
  return (root ? [root] : []).concat(tbDescendants(tasks, id))
    .filter((t) => t.kind === 'implementation_task' || t.kind === 'task');
}

export function tbScopeOf(tasks: TaskboardTask[], start: TaskboardTask): string {
  const reasons = new Set<string>();
  const seen = new Set<string>();
  let t: TaskboardTask | undefined = start;
  while (t && !seen.has(t.id)) {
    seen.add(t.id);
    if (t.status === 'canceled' || t.scope_class === 'canceled') reasons.add('canceled');
    if (t.scope_class === 'optional_external' || t.scope_class === 'coordination') reasons.add(t.scope_class as string);
    if (t.required_denominator === false) reasons.add('excluded');
    t = t.parent_id ? tasks.find((x) => x.id === t!.parent_id) : undefined;
  }
  return ['canceled', 'optional_external', 'coordination', 'excluded'].find((k) => reasons.has(k)) || 'required';
}

export function tbConcrete(tasks: TaskboardTask[], id: string): TaskboardTask[] {
  return tbTaskLeaves(tasks, id).filter((t) => tbScopeOf(tasks, t) === 'required');
}

export function tbTaskStatusCounts(tasks: TaskboardTask[], id: string) {
  const xs = tbConcrete(tasks, id);
  return {
    total: xs.length,
    done: xs.filter((x) => x.status === 'done').length,
    inProgress: xs.filter((x) => x.status === 'in_progress').length,
    pending: xs.filter((x) => x.status !== 'done' && x.status !== 'in_progress').length,
  };
}

export function tbHierarchyStats(tasks: TaskboardTask[], id: string) {
  const registered = tbDescendants(tasks, id);
  return { registered: registered.length, planned: 0, total: registered.length };
}

export function tbHistorySummary(tasks: TaskboardTask[], id: string): string {
  const counts: Record<string, number> = { optional_external: 0, canceled: 0, coordination: 0, excluded: 0 };
  tbTaskLeaves(tasks, id).forEach((t) => {
    const k = tbScopeOf(tasks, t);
    if (k !== 'required') counts[k] += 1;
  });
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => TB_SCOPE_LABELS[k] + ' ' + n)
    .join(' · ');
}

export function tbTaskStatusSummary(tasks: TaskboardTask[], id: string): string {
  const c = tbTaskStatusCounts(tasks, id);
  return '主线执行任务 ' + c.total + ' 个 · 已完成 ' + c.done + ' · 进行中 ' + c.inProgress + ' · 待完成 ' + c.pending;
}

export function tbTaskRecordSummary(tasks: TaskboardTask[], id: string): string {
  const all = tbTaskLeaves(tasks, id);
  const main = tbConcrete(tasks, id);
  const outside = all.length - main.length;
  return '全部任务节点 ' + all.length + ' 个' + (outside > 0 ? ' · 主线 ' + main.length + ' 个 · 范围外 ' + outside + ' 个（' + tbHistorySummary(tasks, id) + '）' : '');
}

/** Upstream ba67015: task's own stage value, with implementation falling back to status. */
export function tbOwnStage(t: TaskboardTask, k: string): string | null {
  const stages = t.stages as Record<string, string> | undefined;
  if (stages && typeof stages[k] === 'string') return stages[k];
  if (k === 'implementation') return (t.status as string) || null;
  return null;
}

export function tbStages(tasks: TaskboardTask[], t: TaskboardTask): string[] {
  const own = ['validation', 'implementation', 'acceptance'];
  const leaves = tbConcrete(tasks, t.id);
  if (leaves.length === 0) {
    return own.map((k) => {
      const v = tbOwnStage(t, k);
      return v && TB_LABELS[v] ? v : 'not_applicable';
    });
  }
  return own.map((k) => {
    const vals = leaves.map((x) => tbOwnStage(x, k))
      .filter((v) => typeof v === 'string' && TB_LABELS[v] && v !== 'not_applicable');
    if (vals.length === 0) {
      const v = tbOwnStage(t, k);
      return v && TB_LABELS[v] ? v : 'unknown';
    }
    if (vals.includes('blocked')) return 'blocked';
    if (vals.includes('in_progress')) return 'in_progress';
    if (vals.includes('in_review')) return 'in_review';
    const doneCount = vals.filter((v) => v === 'done' || v === 'passed').length;
    if (doneCount === vals.length) return doneCount === vals.filter((v) => v === 'passed').length ? 'passed' : 'done';
    if (doneCount > 0) return 'in_progress';
    if (vals.includes('todo')) return 'todo';
    return 'unknown';
  });
}

export function tbShortFmt(x?: string | null): string {
  if (!x) return '未记录';
  const d = new Date(x);
  if (Number.isNaN(d.getTime())) return '未记录';
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function tbTimeInfo(tasks: TaskboardTask[], t: TaskboardTask) {
  const ownStart = (t.started_at as string) || null;
  const ownEnd = (t.completed_at as string) || null;
  if (ownStart || ownEnd) return { label: '起止时间', start: ownStart, end: ownEnd, derived: false };
  const leaves = tbConcrete(tasks, t.id).filter((x) => x.id !== t.id);
  const starts = leaves.map((x) => x.started_at as string | undefined).filter(Boolean) as string[];
  const ends = leaves.map((x) => x.completed_at as string | undefined).filter(Boolean) as string[];
  if (starts.length || ends.length) {
    return { label: '子任务时间范围', start: starts.sort()[0] ?? null, end: ends.sort()[ends.length - 1] ?? null, derived: true };
  }
  return { label: '起止时间', start: null, end: null, derived: false };
}

export function tbTimeText(tasks: TaskboardTask[], t: TaskboardTask): string {
  const x = tbTimeInfo(tasks, t);
  const end = x.end ? tbShortFmt(x.end) : (t.status === 'done' ? '结束未记录' : '未结束');
  return x.label + '：' + tbShortFmt(x.start) + ' → ' + end + (x.derived ? ' · 汇总' : '');
}

export function tbPhaseMark(t: TaskboardTask, index: number): string {
  return t.id.startsWith('M-') ? t.id.slice(2) : String(index + 1);
}

export function tbCleanTitle(t: TaskboardTask): string {
  return t.title.replace(/^Milestone [A-Z][｜ —]+/, '');
}

export function tbScopeLabel(tasks: TaskboardTask[], t: TaskboardTask): string {
  return '范围：' + TB_SCOPE_LABELS[tbScopeOf(tasks, t)];
}

export function tbTaskTypeLabel(tasks: TaskboardTask[], t: TaskboardTask): string {
  const s = tbScopeOf(tasks, t);
  if (s === 'required') return '任务类型：主线执行';
  if (s === 'optional_external') return '任务类型：可选外部 · 无需执行';
  if (s === 'canceled') return '任务类型：已取消 · 无需执行';
  if (s === 'coordination') return '任务类型：协调记录 · 不计入执行任务';
  return '任务类型：' + TB_SCOPE_LABELS[s];
}

export function tbTaskTypeClass(tasks: TaskboardTask[], t: TaskboardTask): string {
  const map: Record<string, string> = {
    required: 'type-required',
    optional_external: 'type-optional',
    canceled: 'type-canceled',
    coordination: 'type-coordination',
    excluded: 'type-excluded',
  };
  return map[tbScopeOf(tasks, t)] || 'type-required';
}

export function tbFmt(x?: string | null): string {
  return x ? new Date(x).toLocaleString('zh-CN', { hour12: false }) : '未记录';
}
