import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { RefreshCw, Upload } from 'lucide-react';
import { io, type Socket } from 'socket.io-client';
import { useLanguage } from '../../context/LanguageContext';
import { apiErrorMessage } from '../../api/error-message';
import { taskboardApi } from './api';
import type { TaskboardBoard, TaskboardTask } from './types';

const STATUS_ORDER = ['todo', 'in_progress', 'blocked', 'in_review', 'done', 'canceled', 'unknown'] as const;

const STATUS_STYLE: Record<string, { zh: string; en: string; pill: string; dot: string }> = {
  todo: { zh: '未开始', en: 'To do', pill: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
  in_progress: { zh: '进行中', en: 'In progress', pill: 'bg-blue-50 text-blue-700', dot: 'bg-blue-600' },
  blocked: { zh: '已阻塞', en: 'Blocked', pill: 'bg-orange-50 text-orange-700', dot: 'bg-orange-500' },
  in_review: { zh: '待验收', en: 'In review', pill: 'bg-violet-50 text-violet-700', dot: 'bg-violet-600' },
  done: { zh: '已完成', en: 'Done', pill: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-600' },
  canceled: { zh: '已取消', en: 'Canceled', pill: 'bg-gray-100 text-gray-400', dot: 'bg-gray-300' },
  unknown: { zh: '待核实', en: 'Unknown', pill: 'bg-gray-100 text-gray-500', dot: 'bg-gray-400' },
};

const KIND_LABELS: Record<string, { zh: string; en: string }> = {
  phase: { zh: '阶段', en: 'Phase' },
  module: { zh: '模块', en: 'Module' },
  capability: { zh: '能力', en: 'Capability' },
  plan: { zh: '计划', en: 'Plan' },
  step: { zh: '步骤', en: 'Step' },
  task: { zh: '任务', en: 'Task' },
  implementation_task: { zh: '执行任务', en: 'Execution task' },
  work_item: { zh: '工作项', en: 'Work item' },
};

const statusMeta = (task: TaskboardTask) => STATUS_STYLE[String(task.status)] ?? STATUS_STYLE.unknown;
const formatTime = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, { hour12: false });
};

export const TaskboardPage: React.FC = () => {
  const { id: spaceId } = useParams<{ id: string }>();
  const { t, language } = useLanguage();
  const zh = language === 'zh-CN';
  const [board, setBoard] = useState<TaskboardBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState('');
  const [stepDraft, setStepDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [planContent, setPlanContent] = useState('');
  const [planSource, setPlanSource] = useState('docs/superpowers/plans/plan.md');
  const [syncStatus, setSyncStatus] = useState(false);
  const [importNote, setImportNote] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const phaseRailRef = useRef<HTMLDivElement | null>(null);
  const [railCanScroll, setRailCanScroll] = useState(false);
  const [railAtStart, setRailAtStart] = useState(true);
  const [railAtEnd, setRailAtEnd] = useState(false);

  const load = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    try {
      const data = await taskboardApi.getBoard(spaceId);
      setBoard(data.board);
      setError('');
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError, t, 'taskboard.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [spaceId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const tasks = board?.tasks ?? [];
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const phases = useMemo(() => tasks.filter((task) => task.kind === 'phase'), [tasks]);
  const [activePhaseId, setActivePhaseId] = useState<string | null>(null);
  const effectivePhaseId = activePhaseId && byId.has(activePhaseId) ? activePhaseId : phases[0]?.id ?? null;

  const depthOf = useCallback((task: TaskboardTask) => {
    let depth = 0;
    let current: TaskboardTask | undefined = task;
    while (current?.parent_id) { depth += 1; current = byId.get(current.parent_id); }
    return depth;
  }, [byId]);

  const inSubtree = useCallback((task: TaskboardTask, rootId: string | null) => {
    if (rootId === null) return true;
    let current: TaskboardTask | undefined = task;
    while (current) {
      if (current.id === rootId) return true;
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return false;
  }, [byId]);

  const visibleTasks = useMemo(
    () => tasks.filter((task) => inSubtree(task, effectivePhaseId)),
    [tasks, inSubtree, effectivePhaseId],
  );

  const phaseSummaries = useMemo<Array<{ id: string; title: string; total: number; done: number; inProgress: number; pending: number }>>(() => {
    const build = (rootId: string | null, title: string) => {
      const members = tasks.filter((task) => inSubtree(task, rootId));
      const concrete = members.filter((task) => task.kind === 'task' || task.kind === 'implementation_task' || task.kind === 'step');
      return {
        id: rootId ?? 'all',
        title,
        total: concrete.length,
        done: concrete.filter((task) => task.status === 'done' || task.status === 'canceled').length,
        inProgress: concrete.filter((task) => task.status === 'in_progress' || task.status === 'in_review' || task.status === 'blocked').length,
        pending: concrete.filter((task) => task.status === 'todo' || task.status === 'unknown').length,
      };
    };
    if (phases.length === 0) return [build(null, zh ? '全部任务' : 'All tasks')];
    return phases.map((phase) => build(phase.id, phase.title));
  }, [tasks, phases, inSubtree, zh]);

  const running = useMemo(() => visibleTasks.filter((task) => task.status === 'in_progress'), [visibleTasks]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  // Phase rail: horizontal scrolling with quick-jump controls (upstream e27b53c).
  const updateRailButtons = useCallback(() => {
    const rail = phaseRailRef.current;
    if (!rail) return;
    setRailCanScroll(rail.scrollWidth > rail.clientWidth + 8);
    setRailAtStart(rail.scrollLeft <= 2);
    setRailAtEnd(rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2);
  }, []);

  const scrollRailToPhase = useCallback((phaseId: string | null) => {
    const rail = phaseRailRef.current;
    if (!rail || !phaseId) return;
    const target = rail.querySelector<HTMLElement>('[data-phase-id="' + phaseId + '"]');
    if (target) target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, []);

  const scrollRailByStep = useCallback((dir: 1 | -1) => {
    const rail = phaseRailRef.current;
    if (!rail) return;
    const milestones = Array.from(rail.querySelectorAll<HTMLElement>('[data-phase-id]'));
    if (milestones.length === 0) return;
    const current = rail.scrollLeft;
    let target: HTMLElement | null = null;
    if (dir > 0) {
      const center = current + rail.clientWidth;
      for (const milestone of milestones) {
        if (milestone.offsetLeft > center) { target = milestone; break; }
      }
      target = target ?? milestones[milestones.length - 1];
    } else {
      for (let index = milestones.length - 1; index >= 0; index -= 1) {
        if (milestones[index].offsetLeft < current - 4) { target = milestones[index]; break; }
      }
      target = target ?? milestones[0];
    }
    target.scrollIntoView({ block: 'nearest', inline: dir > 0 ? 'start' : 'end', behavior: 'smooth' });
  }, []);

  useEffect(() => {
    updateRailButtons();
    const rail = phaseRailRef.current;
    if (!rail || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => updateRailButtons());
    observer.observe(rail);
    return () => observer.disconnect();
  }, [updateRailButtons, phaseSummaries.length]);

  useEffect(() => {
    scrollRailToPhase(effectivePhaseId);
  }, [effectivePhaseId, scrollRailToPhase, phaseSummaries.length]);

  // Live sync: board changes published by any agent refresh this view (debounced).
  useEffect(() => {
    if (!spaceId) return undefined;
    const socket: Socket = io(window.location.origin + '/collaboration', {
      transports: ['websocket', 'polling'],
      auth: { token: localStorage.getItem('token') },
      autoConnect: false,
    });
    let timer: number | undefined;
    const debouncedRefresh = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 150);
    };
    const onConnect = () => socket.emit('taskboard:subscribe', { spaceId });
    const connectTimer = window.setTimeout(() => socket.connect(), 0);
    socket.on('connect', onConnect);
    socket.on('taskboardChanged', debouncedRefresh);
    socket.io.on('reconnect', () => {
      socket.emit('taskboard:subscribe', { spaceId });
      debouncedRefresh();
    });
    return () => {
      window.clearTimeout(connectTimer);
      if (timer !== undefined) window.clearTimeout(timer);
      socket.emit('taskboard:unsubscribe', { spaceId });
      socket.off('connect', onConnect);
      socket.off('taskboardChanged', debouncedRefresh);
      socket.disconnect();
    };
  }, [spaceId, load]);

  useEffect(() => { setStatusDraft(selected?.status ?? ''); setStepDraft(selected?.current_step ?? ''); }, [selected?.id, selected?.status, selected?.current_step]);

  const applyStatus = async () => {
    if (!spaceId || !selected) return;
    setBusy(true);
    try {
      await taskboardApi.updateStatus(spaceId, selected.id, {
        ...(statusDraft ? { status: statusDraft } : {}),
        ...(stepDraft !== (selected.current_step ?? '') ? { current_step: stepDraft } : {}),
      });
      await load();
    } catch (requestError: unknown) { setError(apiErrorMessage(requestError, t, 'taskboard.actionFailed')); }
    finally { setBusy(false); }
  };

  const addTask = async () => {
    const title = newTitle.trim();
    if (!spaceId || !title) return;
    setBusy(true);
    try {
      if (selected) await taskboardApi.createChild(spaceId, selected.id, { title });
      else await taskboardApi.createTask(spaceId, { title });
      setNewTitle('');
      await load();
    } catch (requestError: unknown) { setError(apiErrorMessage(requestError, t, 'taskboard.actionFailed')); }
    finally { setBusy(false); }
  };

  const importPlan = async () => {
    if (!spaceId || !planContent.trim()) return;
    setBusy(true);
    try {
      const data = await taskboardApi.importPlan(spaceId, { content: planContent, sourcePath: planSource, syncStatus });
      setBoard(data.board);
      setImportOpen(false);
      setPlanContent('');
      setImportNote((zh ? '导入完成：新增 ' : 'Imported: ') + data.summary.added + (zh ? ' 个，更新 ' : ' added, ') + data.summary.updated + (zh ? ' 个' : ' updated'));
    } catch (requestError: unknown) { setError(apiErrorMessage(requestError, t, 'taskboard.importFailed')); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{board?.project || (zh ? '任务看板' : 'Taskboard')}</h1>
        <span className="text-sm text-gray-500">{t('taskboard.progress')}：{phaseSummaries.reduce((sum, phase) => sum + phase.done, 0)}/{phaseSummaries.reduce((sum, phase) => sum + phase.total, 0)}</span>
        {importNote && <span className="text-sm text-emerald-700">{importNote}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setImportOpen((open) => !open)} className="flex items-center gap-1 rounded-md border border-blue-600 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50">
            <Upload size={14} /> {t('taskboard.importPlan')}
          </button>
          <button type="button" onClick={() => void load()} className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            <RefreshCw size={14} /> {t('common.refresh')}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {importOpen && (
        <section className="mb-5 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-base font-medium">{t('taskboard.importPlan')}</h2>
          <div className="grid gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-gray-600">{t('taskboard.planContent')}</span>
              <textarea aria-label={t('taskboard.planContent')} value={planContent} onChange={(event) => setPlanContent(event.target.value)} rows={8}
                className="w-full rounded-md border border-gray-300 p-2 font-mono text-xs" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-gray-600">{t('taskboard.planSource')}</span>
              <input aria-label={t('taskboard.planSource')} value={planSource} onChange={(event) => setPlanSource(event.target.value)}
                className="w-full rounded-md border border-gray-300 p-2 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" aria-label={t('taskboard.syncStatus')} checked={syncStatus} onChange={(event) => setSyncStatus(event.target.checked)} />
              {t('taskboard.syncStatus')}
            </label>
            <div className="flex gap-2">
              <button type="button" disabled={busy || !planContent.trim()} onClick={() => void importPlan()}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white disabled:opacity-50">{t('taskboard.import')}</button>
              <button type="button" onClick={() => setImportOpen(false)} className="rounded-md border border-gray-300 px-4 py-1.5 text-sm text-gray-600">{t('common.cancel')}</button>
            </div>
          </div>
        </section>
      )}

      {phaseSummaries.length > 1 && (
        <nav aria-label={zh ? '实施阶段' : 'Phases'} className="mb-4">
          <div className="flex items-center gap-2">
            <div ref={phaseRailRef} onScroll={updateRailButtons} className="min-w-0 flex-1 overflow-x-auto pb-1">
              <div className="flex w-max gap-2">
                {phaseSummaries.map((phase) => {
                  const active = effectivePhaseId === (phase.id === 'all' ? null : phase.id);
                  return (
                    <button key={phase.id} type="button" data-phase-id={phase.id}
                      onClick={() => setActivePhaseId(phase.id === 'all' ? null : phase.id)} aria-pressed={active}
                      className={'w-56 shrink-0 rounded-lg border px-3 py-2 text-left text-sm ' + (active ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300')}>
                      <span className="block truncate font-medium">{phase.title}</span>
                      <span className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><i className={'inline-block h-2 w-2 rounded-full ' + STATUS_STYLE.done.dot} />{phase.done}</span>
                        <span className="flex items-center gap-1"><i className={'inline-block h-2 w-2 rounded-full ' + STATUS_STYLE.in_progress.dot} />{phase.inProgress}</span>
                        <span className="flex items-center gap-1"><i className={'inline-block h-2 w-2 rounded-full ' + STATUS_STYLE.todo.dot} />{phase.pending}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={() => scrollRailByStep(-1)} disabled={!railCanScroll || railAtStart}
                aria-label={t('taskboard.prevPhase')} title={t('taskboard.prevPhase')}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 disabled:opacity-40">‹</button>
              <button type="button" onClick={() => scrollRailByStep(1)} disabled={!railCanScroll || railAtEnd}
                aria-label={t('taskboard.nextPhase')} title={t('taskboard.nextPhase')}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 disabled:opacity-40">›</button>
              <select aria-label={t('taskboard.jumpToPhase')} value={effectivePhaseId ?? 'all'}
                onChange={(event) => setActivePhaseId(event.target.value === 'all' ? null : event.target.value)}
                className="max-w-[14rem] rounded-md border border-gray-300 px-2 py-1 text-sm">
                {phaseSummaries.map((phase, index) => (
                  <option key={phase.id} value={phase.id}>{String(index + 1)} · {phase.title}（{phase.done}/{phase.total}）</option>
                ))}
              </select>
            </div>
          </div>
        </nav>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-gray-500">{zh ? '正在加载…' : 'Loading…'}</p>
      ) : tasks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500">{t('taskboard.empty')}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('common.status')}</th>
                  <th className="px-3 py-2 font-medium">{zh ? '任务' : 'Task'}</th>
                  <th className="px-3 py-2 font-medium">{t('taskboard.owner')}</th>
                  <th className="px-3 py-2 font-medium">{t('taskboard.updated')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleTasks.map((task) => {
                  const meta = statusMeta(task);
                  const kind = KIND_LABELS[String(task.kind)] ?? null;
                  return (
                    <tr key={task.id}
                      onClick={() => setSelectedId(task.id)}
                      className={'cursor-pointer border-t border-gray-100 hover:bg-blue-50/50 ' + (selectedId === task.id ? 'bg-blue-50' : '')}>
                      <td className="px-3 py-2"><span className={'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ' + meta.pill}><i className={'inline-block h-2 w-2 rounded-full ' + meta.dot} />{zh ? meta.zh : meta.en}</span></td>
                      <td className="py-2 pr-3" style={{ paddingLeft: 12 + depthOf(task) * 18 }}>
                        <span className={task.kind === 'phase' ? 'font-semibold' : ''}>{task.title}</span>
                        {kind && <span className="ml-2 text-xs text-gray-400">{zh ? kind.zh : kind.en}</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-500">{task.owner ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-500">{formatTime(task.updated_at) ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <div className="grid content-start gap-4">
            {selected && (
              <section aria-label={selected.title} className="rounded-lg border border-gray-200 bg-white p-4">
                <h2 className="text-base font-medium">{selected.title}</h2>
                {selected.summary && <p className="mt-1 text-sm text-gray-500">{selected.summary}</p>}
                <dl className="mt-3 grid gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <dt className="text-gray-500">{t('common.status')}</dt>
                    <dd>
                      <select aria-label={t('common.status')} value={statusDraft} onChange={(event) => setStatusDraft(event.target.value)}
                        className="rounded-md border border-gray-300 px-2 py-1 text-sm">
                        {STATUS_ORDER.map((status) => (
                          <option key={status} value={status}>{zh ? STATUS_STYLE[status].zh : STATUS_STYLE[status].en}</option>
                        ))}
                      </select>
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <dt className="shrink-0 text-gray-500">{t('taskboard.currentStep')}</dt>
                    <dd className="flex-1">
                      <input aria-label={t('taskboard.currentStep')} value={stepDraft} onChange={(event) => setStepDraft(event.target.value)}
                        className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm" />
                    </dd>
                  </div>
                  <div className="flex justify-end">
                    <button type="button" disabled={busy} onClick={() => void applyStatus()}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">{zh ? '保存' : 'Save'}</button>
                  </div>
                  <div><dt className="inline text-gray-500">{t('taskboard.owner')}：</dt><dd className="inline">{selected.owner ?? '—'}</dd></div>
                  <div><dt className="inline text-gray-500">{zh ? '开始' : 'Started'}：</dt><dd className="inline">{formatTime(selected.started_at) ?? '—'}</dd></div>
                  <div><dt className="inline text-gray-500">{zh ? '完成' : 'Completed'}：</dt><dd className="inline">{formatTime(selected.completed_at) ?? '—'}</dd></div>
                  {selected.description && <div><dt className="mb-1 text-gray-500">{zh ? '说明' : 'Notes'}</dt><dd className="whitespace-pre-wrap text-gray-700">{selected.description}</dd></div>}
                  {Array.isArray(selected.status_history) && selected.status_history.length > 0 && (
                    <div>
                      <dt className="mb-1 text-gray-500">{t('taskboard.statusHistory')}</dt>
                      <dd className="grid gap-0.5">
                        {[...selected.status_history].slice(-5).reverse().map((entry, index) => (
                          <span key={entry.at + '-' + index} className="text-xs text-gray-500">
                            {formatTime(entry.at) ?? ''} · {zh ? STATUS_STYLE[String(entry.to)]?.zh ?? String(entry.to) : STATUS_STYLE[String(entry.to)]?.en ?? String(entry.to)}{entry.by ? ' · ' + entry.by : ''}
                          </span>
                        ))}
                      </dd>
                    </div>
                  )}
                </dl>
              </section>
            )}

            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-medium">{selected ? t('taskboard.addChild') : t('taskboard.addRoot')}</h2>
              <div className="flex gap-2">
                <input aria-label={t('taskboard.addTaskPlaceholder')} value={newTitle} onChange={(event) => setNewTitle(event.target.value)}
                  placeholder={t('taskboard.addTaskPlaceholder')}
                  className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
                <button type="button" disabled={busy || !newTitle.trim()} onClick={() => void addTask()}
                  className="rounded-md border border-blue-600 px-3 py-1.5 text-sm text-blue-600 disabled:opacity-50">{zh ? '添加' : 'Add'}</button>
              </div>
            </section>

            {running.length > 0 && (
              <section className="rounded-lg border border-gray-200 bg-white p-4">
                <h2 className="mb-2 flex items-center gap-2 text-sm font-medium"><i className={'inline-block h-2 w-2 animate-pulse rounded-full ' + STATUS_STYLE.in_progress.dot} />{t('taskboard.running')}（{running.length}）</h2>
                <ul className="grid gap-1 text-sm">
                  {running.map((task) => (
                    <li key={task.id}>
                      <button type="button" onClick={() => setSelectedId(task.id)} className="text-left text-blue-700 hover:underline">{task.title}</button>
                      {task.current_step && <span className="text-gray-500"> · {task.current_step}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
