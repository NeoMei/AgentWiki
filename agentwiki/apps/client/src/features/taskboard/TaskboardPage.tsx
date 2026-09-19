import './taskboard.css';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { useLanguage } from '../../context/LanguageContext';
import { apiErrorMessage } from '../../api/error-message';
import { taskboardApi } from './api';
import type { TaskboardBoard, TaskboardTask } from './types';
import {
  TB_LABELS,
  tbCleanTitle,
  tbConcrete,
  tbFmt,
  tbHistorySummary,
  tbKids,
  tbPhaseMark,
  tbScopeLabel,
  tbShortFmt,
  tbStages,
  tbTaskStatusCounts,
  tbTaskRecordSummary,
  tbTaskStatusSummary,
  tbTaskTypeClass,
  tbTaskTypeLabel,
  tbTimeInfo,
  tbTimeText,
} from './board-view';

const STAGE_NAMES = ['前置验证', '功能实现', '集成验收'];
const STAGE_KEYS = ['validation', 'implementation', 'acceptance'];
const TB_STATUS_ORDER = ['todo', 'in_progress', 'blocked', 'in_review', 'done', 'canceled', 'unknown'];

function statusZh(s: string): string {
  return TB_LABELS[s] ?? '待核实';
}

function tbIcon(size: number): React.ReactNode {
  return (
    <svg className="icon" style={{ width: size, height: size }} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6" />
    </svg>
  );
}

export const TaskboardPage: React.FC = () => {
  const { id: spaceId } = useParams<{ id: string }>();
  const { t, language } = useLanguage();
  const zh = language === 'zh-CN';
  const [board, setBoard] = useState<TaskboardBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [phaseId, setPhaseId] = useState<string | null>(null);
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [planContent, setPlanContent] = useState('');
  const [planSource, setPlanSource] = useState('docs/superpowers/plans/plan.md');
  const [syncStatus, setSyncStatus] = useState(false);
  const [importNote, setImportNote] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [statusDraft, setStatusDraft] = useState('');
  const [stepDraft, setStepDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const graphRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [layout, setLayout] = useState<{ h: number; tops: Record<string, number>; wires: string[] }>({ h: 580, tops: {}, wires: [] });
  const [railCanScroll, setRailCanScroll] = useState(false);
  const [railAtStart, setRailAtStart] = useState(true);
  const [railAtEnd, setRailAtEnd] = useState(false);

  const load = useCallback(async () => {
    if (!spaceId) return;
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

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!spaceId) return undefined;
    const socket: Socket = io(window.location.origin + '/collaboration', {
      transports: ['websocket', 'polling'],
      auth: { token: localStorage.getItem('token') },
      autoConnect: false,
    });
    let timer: number | undefined;
    const debounced = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 150);
    };
    const onConnect = () => socket.emit('taskboard:subscribe', { spaceId });
    const connectTimer = window.setTimeout(() => socket.connect(), 0);
    socket.on('connect', onConnect);
    socket.on('taskboardChanged', debounced);
    socket.io.on('reconnect', () => { socket.emit('taskboard:subscribe', { spaceId }); debounced(); });
    return () => {
      window.clearTimeout(connectTimer);
      if (timer !== undefined) window.clearTimeout(timer);
      socket.emit('taskboard:unsubscribe', { spaceId });
      socket.off('connect', onConnect);
      socket.off('taskboardChanged', debounced);
      socket.disconnect();
    };
  }, [spaceId, load]);

  const tasks = board?.tasks ?? [];
  const phases = useMemo(() => tasks.filter((x) => x.kind === 'phase'), [tasks]);
  const activePhase = phases.find((x) => x.id === phaseId) ?? phases[0] ?? null;
  const mods = useMemo(
    () => (activePhase ? tbKids(tasks, activePhase.id).filter((x) => x.kind !== 'step') : (phases.length === 0 ? tasks.filter((x) => !x.parent_id) : [])),
    [tasks, activePhase, phases.length],
  );
  const activeModuleId = mods.some((x) => x.id === moduleId) ? moduleId : mods[0]?.id ?? null;
  const moduleTask = tasks.find((x) => x.id === activeModuleId) ?? null;
  const moduleChildren = moduleTask ? tbKids(tasks, moduleTask.id) : [];
  const capabilities = moduleChildren.filter((x) => x.kind === 'capability' || x.kind === 'module');
  const shown = capabilities.length > 0
    ? [...capabilities.flatMap((c) => tbKids(tasks, c.id)), ...moduleChildren.filter((x) => x.kind !== 'capability' && x.kind !== 'module')]
    : moduleChildren;
  const selected = tasks.find((x) => x.id === selectedId) ?? null;

  const runningList = useMemo(
    () => tasks.filter((x) => (x.kind === 'task' || x.kind === 'implementation_task') && x.status === 'in_progress'),
    [tasks],
  );

  useEffect(() => { setStatusDraft(selected?.status ?? ''); setStepDraft(selected?.current_step ?? ''); }, [selected?.id, selected?.status, selected?.current_step]);

  const updateRailButtons = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    setRailCanScroll(rail.scrollWidth > rail.clientWidth + 8);
    setRailAtStart(rail.scrollLeft <= 2);
    setRailAtEnd(rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2);
  }, []);

  const scrollRailByStep = useCallback((dir: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    const milestones = Array.from(rail.querySelectorAll<HTMLElement>('[data-phase-id]'));
    if (milestones.length === 0) return;
    const current = rail.scrollLeft;
    let target: HTMLElement | null = null;
    if (dir > 0) {
      const edge = current + rail.clientWidth;
      for (const m of milestones) { if (m.offsetLeft > edge) { target = m; break; } }
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
    const rail = railRef.current;
    if (!rail || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => updateRailButtons());
    observer.observe(rail);
    return () => observer.disconnect();
  }, [updateRailButtons, phases.length]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !activePhase) return;
    const el = rail.querySelector('[data-phase-id="' + activePhase.id + '"]');
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [activePhase?.id, phases.length]);

  // Canvas layout: port of the plugin draw() placement + SVG wires.
  useLayoutEffect(() => {
    const graph = graphRef.current;
    if (!graph || tasks.length === 0) return;
    const gap = 16; const pad = 24;
    const moduleEls = mods.map((m) => nodeRefs.current.get('m:' + m.id)).filter(Boolean) as HTMLButtonElement[];
    const childEls = shown.map((c) => nodeRefs.current.get('c:' + c.id)).filter(Boolean) as HTMLButtonElement[];
    if (moduleEls.length === 0 && childEls.length === 0) return;
    const columnHeight = (els: HTMLElement[]) => els.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0) + Math.max(0, els.length - 1) * gap;
    const mh = columnHeight(moduleEls);
    const ch = columnHeight(childEls);
    const h = Math.max(580, mh + pad * 2, ch + pad * 2);
    const tops: Record<string, number> = {};
    const centerOf = (el: HTMLElement, top: number) => top + el.getBoundingClientRect().height / 2;
    const place = (pairs: Array<{ el: HTMLElement; key: string }>, start: number) => {
      let y = start;
      for (const pair of pairs) { tops[pair.key] = Math.round(y); y += pair.el.getBoundingClientRect().height + gap; }
    };
    place(moduleEls.map((el, i) => ({ el, key: 'm:' + mods[i].id })), (h - mh) / 2);
    const activeIndex = mods.findIndex((x) => x.id === activeModuleId);
    const activeEl = activeIndex >= 0 ? moduleEls[activeIndex] : null;
    const anchor = activeEl ? centerOf(activeEl, tops['m:' + mods[activeIndex].id]) : h / 2;
    place(childEls.map((el, i) => ({ el, key: 'c:' + shown[i].id })), Math.max(pad, Math.min(h - pad - ch, anchor - ch / 2)));
    const wires: string[] = [];
    const wire = (fromX: number, fromCenterY: number, toX: number, toCenterY: number) => {
      const mid = (fromX + toX) / 2;
      wires.push('M' + fromX + ' ' + fromCenterY + 'H' + mid + 'V' + toCenterY + 'H' + toX);
    };
    const modWires = mods.map((m, i) => {
      const top = tops['m:' + m.id] ?? 0;
      const el = moduleEls[i];
      return { x: (28 + 29) * 10, cy: centerOf(el, top) };
    });
    const rootCenter = h / 2;
    modWires.forEach((w) => wire(2 * 10 + 200, rootCenter, 28 * 10, w.cy));
    if (activeEl) {
      const activeCenter = anchor;
      childEls.forEach((el, i) => {
        const cy = centerOf(el, tops['c:' + shown[i].id] ?? 0);
        wire((28 + 29) * 10, activeCenter, 66 * 10, cy);
      });
    }
    const next = JSON.stringify({ h: Math.round(h), tops, wires });
    setLayout((prev) => (JSON.stringify(prev) === next ? prev : JSON.parse(next)));
  }, [tasks, mods, shown, activeModuleId, activePhase?.id, selectedId]);

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

  const addChild = async () => {
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

  const locate = (t: TaskboardTask) => {
    const path: TaskboardTask[] = [];
    const seen = new Set<string>();
    let n: TaskboardTask | undefined = t;
    while (n && !seen.has(n.id)) { path.push(n); seen.add(n.id); n = n.parent_id ? tasks.find((x) => x.id === n!.parent_id) : undefined; }
    const phase = path.find((x) => x.kind === 'phase');
    if (phase) {
      setPhaseId(phase.id);
      const phaseIndex = path.findIndex((x) => x.id === phase.id);
      const directChild = phaseIndex > 0 ? path[phaseIndex - 1] : null;
      setModuleId(directChild?.id || null);
    }
    setSelectedId(t.id);
    window.setTimeout(() => {
      const el = nodeRefs.current.get('m:' + t.id) ?? nodeRefs.current.get('c:' + t.id);
      if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' });
      else graphRef.current?.scrollIntoView({ block: 'center' });
    }, 60);
  };

  const renderNode = (task: TaskboardTask, cls: 'root' | 'module' | 'cap', refKey: string, style: React.CSSProperties, onClick: () => void) => {
    const isSelected = task.id === selectedId || task.id === activeModuleId;
    const counts = tbTaskStatusCounts(tasks, task.id);
    const history = tbHistorySummary(tasks, task.id);
    void history;
    return (
      <button
        key={task.id}
        ref={(el) => { if (el) nodeRefs.current.set(refKey, el); else nodeRefs.current.delete(refKey); }}
        className={'node ' + cls + ' ' + tbTaskTypeClass(tasks, task) + (isSelected ? ' selected' : '')}
        style={style}
        onClick={onClick}
        aria-label={tbCleanTitle(task)}
        aria-pressed={isSelected}
        title={tbCleanTitle(task)}
      >
        {cls === 'root'
          ? <span className="letter active">{tbPhaseMark(task, phases.findIndex((x) => x.id === task.id))}</span>
          : tbIcon(19)}
        <div className="node-body">
          <strong>{tbCleanTitle(task)}</strong>
          <small className="node-count task-type">{tbTaskTypeLabel(tasks, task)}</small>
          {counts.total > 0 && (
            <small className="node-count">下属主线任务 {counts.total} 个 · {counts.done} 已完成</small>
          )}
          {cls !== 'root' && <small className="node-time">{tbTimeText(tasks, task)}</small>}
          <div className="signals">
            {tbStages(tasks, task).map((v, i) => (
              <span key={STAGE_KEYS[i]} title={STAGE_NAMES[i] + '：' + statusZh(v)}>
                <i className={'dot ' + v} />{STAGE_NAMES[i].slice(0, 2)}
              </span>
            ))}
          </div>
        </div>
      </button>
    );
  };

  const inspectTask = selected ?? moduleTask ?? activePhase;
  const syncText = board ? '数据更新 ' + tbFmt(board.updated_at) : '正在读取项目记录';

  return (
    <div className="tb-page">
      <header>
        <h1>{board?.project || (zh ? '项目全景' : 'Project Overview')}</h1>
        <small>{syncText}</small>
        <span className="updated">{zh ? '项目规划 · 实现进度' : 'Plan · Progress'}</span>
        <button type="button" onClick={() => setImportOpen((open) => !open)}>{zh ? '导入计划' : 'Import plan'}</button>
        <button type="button" id="refresh" onClick={() => void load()}>{zh ? '刷新' : 'Refresh'}</button>
      </header>
      <main>
        <div className="road">
          <div className="roadlabel">{zh ? '实施顺序' : 'Phases'}<small>{zh ? <React.Fragment>按阶段规划，<br />逐步推进</React.Fragment> : <React.Fragment>Phase by phase,<br />step by step</React.Fragment>}</small></div>
          <div className="roadwrap">
            <nav className="tracks" ref={railRef} onScroll={updateRailButtons}>
              {phases.map((phase, index) => {
                const c = tbTaskStatusCounts(tasks, phase.id);
                return (
                  <button
                    key={phase.id}
                    type="button"
                    data-phase-id={phase.id}
                    className={'milestone' + (phase.id === activePhase?.id ? ' selected' : '')}
                    onClick={() => { setPhaseId(phase.id); setModuleId(null); setSelectedId(phase.id); }}
                  >
                    <div className="mtop"><span className={'letter' + (phase.id === activePhase?.id ? ' active' : '')}>{tbPhaseMark(phase, index)}</span><span>{tbCleanTitle(phase)}</span></div>
                    <div className="counts">
                      <span title="已完成执行任务"><i className="dot done" /><div>{c.done}</div></span>
                      <span title="进行中执行任务"><i className="dot in_progress" /><div>{c.inProgress}</div></span>
                      <span title="待完成执行任务"><i className="dot todo" /><div>{c.pending}</div></span>
                    </div>
                    <small className="scope-summary">{tbTaskStatusSummary(tasks, phase.id)}</small>
                    <small className="scope-summary road-time">{tbTimeText(tasks, phase)}</small>
                  </button>
                );
              })}
            </nav>
          </div>
          <div className="roadnav">
            <button type="button" aria-label={t('taskboard.prevPhase')} title={t('taskboard.prevPhase')} disabled={!railCanScroll || railAtStart} onClick={() => scrollRailByStep(-1)}>‹</button>
            <button type="button" aria-label={t('taskboard.nextPhase')} title={t('taskboard.nextPhase')} disabled={!railCanScroll || railAtEnd} onClick={() => scrollRailByStep(1)}>›</button>
            <select
              className="jumpmenu"
              aria-label={t('taskboard.jumpToPhase')}
              title={t('taskboard.jumpToPhase')}
              value={activePhase?.id ?? ''}
              onChange={(event) => { const id = event.target.value; if (!id) return; setPhaseId(id); setModuleId(null); setSelectedId(id); }}
            >
              {phases.map((phase, index) => {
                const c = tbTaskStatusCounts(tasks, phase.id);
                return <option key={phase.id} value={phase.id}>{tbPhaseMark(phase, index)} · {tbCleanTitle(phase)} ({c.done}/{c.total})</option>;
              })}
            </select>
          </div>
        </div>
        {error && <div id="error" role="status">{error}</div>}
        {importNote && <div className="box" style={{ margin: '0 15px 10px' }}><p>{importNote}</p></div>}
        {importOpen && (
          <section className="box" style={{ margin: '0 15px 10px' }}>
            <h3>{t('taskboard.importPlan')}</h3>
            <label className="statusrow"><span>{t('taskboard.planSource')}</span><input aria-label={t('taskboard.planSource')} value={planSource} onChange={(e) => setPlanSource(e.target.value)} style={{ flex: 1, border: '1px solid #d8e1ed', borderRadius: 6, padding: '4px 8px' }} /></label>
            <p><textarea aria-label={t('taskboard.planContent')} value={planContent} onChange={(e) => setPlanContent(e.target.value)} rows={7} style={{ width: '100%', border: '1px solid #d8e1ed', borderRadius: 6, padding: 8, fontFamily: 'monospace', fontSize: 12 }} /></p>
            <label className="statusrow"><span>{t('taskboard.syncStatus')}</span><input type="checkbox" aria-label={t('taskboard.syncStatus')} checked={syncStatus} onChange={(e) => setSyncStatus(e.target.checked)} /></label>
            <p>
              <button type="button" className="locate" disabled={busy || !planContent.trim()} onClick={() => void importPlan()} style={{ marginRight: 8 }}>{t('taskboard.import')}</button>
              <button type="button" className="locate" style={{ background: '#f1f5fb', color: '#506587' }} onClick={() => setImportOpen(false)}>{t('common.cancel')}</button>
            </p>
          </section>
        )}
        {loading ? (
          <p className="empty">{zh ? '正在加载…' : 'Loading…'}</p>
        ) : tasks.length === 0 ? (
          <p className="empty">{t('taskboard.empty')}</p>
        ) : (
          <React.Fragment>
            <div className="workspace">
              <section className="canvaspanel">
                <div className="canvashead">
                  <span className="letter active">{activePhase ? tbPhaseMark(activePhase, phases.findIndex((x) => x.id === activePhase.id)) : '·'}</span>
                  <div>
                    <h2>{activePhase ? tbCleanTitle(activePhase) + ' · ' + tbTaskStatusSummary(tasks, activePhase.id) : (board?.project || '')}</h2>
                    <div className="crumb">{zh ? '项目 / ' : 'Project / '}{activePhase ? tbCleanTitle(activePhase) : (zh ? '全部任务' : 'All tasks')}{moduleTask ? ' / ' + tbCleanTitle(moduleTask) : ''}</div>
                    <div className="view-summary">{activePhase ? '统计：' + tbTaskStatusSummary(tasks, activePhase.id) + ' · 当前图形展示 ' + mods.length + ' 个模块节点和 ' + shown.length + ' 个展开子节点' : ''}</div>
                  </div>
                </div>
                <div className="graphviewport">
                  <div className="graph" ref={graphRef} style={{ height: layout.h }}>
                    <svg className="wires" viewBox={'0 0 1000 ' + layout.h} preserveAspectRatio="none">
                      {layout.wires.map((d, i) => <path key={i} d={d} fill="none" stroke="#94a5c0" strokeWidth="1.2" strokeLinejoin="round" />)}
                    </svg>
                    {activePhase && moduleTask && renderNode(activePhase, 'root', 'r:' + activePhase.id, { left: '2%', width: '20%', top: layout.h / 2 - 41 }, () => setSelectedId(activePhase.id))}
                    {mods.map((m) => renderNode(m, 'module', 'm:' + m.id, { left: '28%', width: '29%', top: layout.tops['m:' + m.id] ?? 0 }, () => { setModuleId(m.id); setSelectedId(m.id); }))}
                    {shown.map((c) => renderNode(c, 'cap', 'c:' + c.id, { left: '66%', width: '32%', top: layout.tops['c:' + c.id] ?? 0 }, () => setSelectedId(c.id)))}
                    {shown.length === 0 && moduleTask && (
                      <div className="empty" style={{ position: 'absolute', left: '66%', width: '32%', top: layout.h / 2 - 30 }}>{zh ? '该节点暂无子项' : 'No children'}</div>
                    )}
                  </div>
                </div>
              </section>
              <aside className="inspector">
                {inspectTask && (
                  <React.Fragment>
                    <div className="inspecthead">
                      {tbIcon(34)}
                      <div>
                        <h2>{tbCleanTitle(inspectTask)}</h2>
                        <div className="crumb">{inspectTask.kind === 'phase' ? (zh ? '项目里程碑' : 'Milestone') : (inspectTask.kind === 'step' ? (zh ? '步骤' : 'Step') : (zh ? '模块 / 实现记录' : 'Module / Record'))}</div>
                      </div>
                    </div>
                    <div className="inside">
                      <div className="box">
                        {tbStages(tasks, inspectTask).map((v, i) => (
                          <div key={STAGE_KEYS[i]} className="statusrow">
                            <strong>{STAGE_NAMES[i]}</strong>
                            <span className={'pill ' + v} style={{ ['--state' as string]: 'var(--state)' }}>{statusZh(v)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="box">
                        <h3>{zh ? '更新执行状态' : 'Update status'}</h3>
                        <label className="statusrow"><span>{t('common.status')}</span>
                          <select aria-label={t('common.status')} value={statusDraft} onChange={(e) => setStatusDraft(e.target.value)} style={{ border: '1px solid #d8e1ed', borderRadius: 6, padding: '4px 8px' }}>
                            {TB_STATUS_ORDER.map((s) => <option key={s} value={s}>{statusZh(s)}</option>)}
                          </select>
                        </label>
                        <label className="statusrow"><span>{t('taskboard.currentStep')}</span>
                          <input aria-label={t('taskboard.currentStep')} value={stepDraft} onChange={(e) => setStepDraft(e.target.value)} style={{ flex: 1, border: '1px solid #d8e1ed', borderRadius: 6, padding: '4px 8px' }} />
                        </label>
                        <p><button type="button" className="locate" disabled={busy} onClick={() => void applyStatus()}>{zh ? '保存' : 'Save'}</button></p>
                      </div>
                      <div className="box">
                        <h3>{zh ? '范围与历史' : 'Scope & history'}</h3>
                        <p>{tbScopeLabel(tasks, inspectTask)}（含祖先排除）</p>
                        <p>记录状态：{statusZh(String(inspectTask.status))}</p>
                        <p>{tbTaskStatusSummary(tasks, inspectTask.id)} · {tbTaskRecordSummary(tasks, inspectTask.id)}</p>
                        <p>{zh ? '原记录三阶段' : 'Stages'}：{tbStages(tasks, inspectTask).map((v) => statusZh(v)).join(' / ')}</p>
                      </div>
                      <div className="box">
                        <h3>{zh ? '时间进度' : 'Time'}</h3>
                        <p>{tbTimeInfo(tasks, inspectTask).label}：{inspectTask.derived ? '' : ''}</p>
                        <p>开始：{tbShortFmt(tbTimeInfo(tasks, inspectTask).start)}</p>
                        <p>结束：{tbTimeInfo(tasks, inspectTask).end ? tbShortFmt(tbTimeInfo(tasks, inspectTask).end) : (inspectTask.status === 'done' ? '结束未记录' : '未结束')}</p>
                      </div>
                      <div className="box">
                        <h3>{zh ? '规格依据' : 'Spec source'}</h3>
                        {(Array.isArray(inspectTask.source) ? inspectTask.source : inspectTask.source ? [String(inspectTask.source)] : []).map((src) => <p key={src}>{src}</p>)}
                        {(!inspectTask.source) && <p>{String(inspectTask.evidence || (zh ? '尚未关联具体条款' : 'No linked spec'))}</p>}
                      </div>
                      <div className="box">
                        <h3>{zh ? '执行任务' : 'Execution tasks'}</h3>
                        {tbConcrete(tasks, inspectTask.id).length > 0
                          ? tbConcrete(tasks, inspectTask.id).map((x) => <p key={x.id}>{x.title} · {statusZh(String(x.status))} · {tbScopeLabel(tasks, x)}</p>)
                          : <p>{zh ? '尚未关联独立任务' : 'No linked tasks'}</p>}
                      </div>
                      <div className="box">
                        <h3>{zh ? '验收要点' : 'Acceptance'}</h3>
                        <p>{String(inspectTask.summary || (zh ? '待 PM 补充' : 'TBD'))}</p>
                      </div>
                      <div className="box">
                        <h3>{zh ? '下一步' : 'Next step'}</h3>
                        <p>{String(inspectTask.next_step || (zh ? '待 PM 补充' : 'TBD'))}</p>
                      </div>
                      <div className="box">
                        <h3>{selected ? t('taskboard.addChild') : t('taskboard.addRoot')}</h3>
                        <p>
                          <input aria-label={t('taskboard.addTaskPlaceholder')} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={t('taskboard.addTaskPlaceholder')} style={{ width: '70%', border: '1px solid #d8e1ed', borderRadius: 6, padding: '4px 8px' }} />
                          <button type="button" className="locate" disabled={busy || !newTitle.trim()} onClick={() => void addChild()} style={{ marginLeft: 8 }}>{zh ? '添加' : 'Add'}</button>
                        </p>
                      </div>
                    </div>
                  </React.Fragment>
                )}
              </aside>
            </div>
            <section className="running">
              <div className="runninghead"><span className="dot" /><h2>{t('taskboard.running')}</h2><small>当前执行任务 {runningList.length} 项 · 必需 {runningList.filter((x) => tbScopeLabel(tasks, x) === '范围：必需').length} 项</small></div>
              <div className="runscroll">
                <table>
                  <thead><tr><th>{zh ? '任务名称' : 'Task'}</th><th>{zh ? '范围' : 'Scope'}</th><th>{zh ? '所属模块' : 'Module'}</th><th>{t('taskboard.owner')}</th><th>{t('taskboard.currentStep')}</th><th>{t('taskboard.updated')}</th><th /></tr></thead>
                  <tbody>
                    {runningList.length === 0 ? (
                      <tr><td colSpan={7}>{zh ? '当前没有登记为进行中的执行任务；模块进展请查看上方。' : 'No in-progress execution tasks.'}</td></tr>
                    ) : runningList.map((x) => (
                      <tr key={x.id}>
                        <td>{x.title}</td>
                        <td>{tbScopeLabel(tasks, x)}</td>
                        <td>{tasks.find((p) => p.id === x.parent_id)?.title || x.parent_id || (zh ? '未关联' : '-')}</td>
                        <td>{x.owner || (zh ? '未指定' : '-')}</td>
                        <td>{x.current_step || (zh ? '进行中' : 'Running')}</td>
                        <td>{tbFmt(x.updated_at)}</td>
                        <td><button type="button" className="locate" onClick={() => locate(x)}>{zh ? '定位节点 ↗' : 'Locate ↗'}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <footer className="legend">
              <span><i className="dot done" />已完成</span>
              <span><i className="dot in_progress" />进行中</span>
              <span><i className="dot blocked" />已阻塞</span>
              <span><i className="dot todo" />未开始</span>
              <span><i className="dot unknown" />待核实</span>
              <i className="legend-divider" />
              <span className="type-legend"><i className="type-swatch type-required" />主线执行</span>
              <span className="type-legend"><i className="type-swatch type-optional" />可选外部</span>
              <span className="type-legend"><i className="type-swatch type-canceled" />已取消</span>
              <span className="type-legend"><i className="type-swatch type-coordination" />协调记录</span>
              <span className="note">{zh ? '技术验证通过 ≠ 功能完成' : 'Passing checks ≠ done'}</span>
            </footer>
            <details className="audit">
              <summary>{zh ? '数据来源与覆盖范围' : 'Data source & coverage'}</summary>
              <p>{zh ? '必需统计排除自身或任一祖先的可选外部、已取消、协调、required_denominator=false 或 status=canceled；未标注范围沿用旧口径。范围外历史单独计数，不计入必需阶段与未完成数。三阶段独立状态未登记时显示待核实。' : 'Required counts exclude optional/canceled/coordination/excluded ancestors; out-of-scope history is counted separately. Unregistered three-stage status shows as unknown.'}</p>
            </details>
          </React.Fragment>
        )}
      </main>
    </div>
  );
};
