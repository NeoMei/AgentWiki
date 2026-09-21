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
const STAGE_SHORT = ['验证', '实现', '验收'];
const TB_STATUS_ORDER = ['todo', 'in_progress', 'blocked', 'in_review', 'done', 'canceled', 'unknown'];

function statusZh(s: string): string {
  return TB_LABELS[s] ?? '待核实';
}

function hasPhaseFlag(tasks: TaskboardTask[]): boolean {
  return tasks.some((x) => x.kind === 'phase');
}

const ROOT_COLUMN_WIDTH = 280;
const COLUMN_WIDTH = 245;
const COLUMN_GAP = 32;
const GRAPH_PADDING = 24;

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewPath, setViewPath] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<'paste' | 'upload' | 'page'>('paste');
  const [planContent, setPlanContent] = useState('');
  const [planSource, setPlanSource] = useState('docs/superpowers/plans/plan.md');
  const [syncStatus, setSyncStatus] = useState(false);
  const [spacePages, setSpacePages] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [takeoverDraft, setTakeoverDraft] = useState(false);
  const [importNote, setImportNote] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [statusDraft, setStatusDraft] = useState('');
  const [stepDraft, setStepDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const graphRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [layout, setLayout] = useState<{ h: number; width: number; tops: Record<string, number>; wires: string[] }>({ h: 580, width: 960, tops: {}, wires: [] });
  const [sessionDraft, setSessionDraft] = useState('');
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

  // Upstream ba771da: normalize the expansion path, then derive one canvas column per hop.
  const path = useMemo<string[]>(() => {
    const out: string[] = [];
    const first = viewPath[0] ? tasks.find((x) => x.id === viewPath[0]) : undefined;
    if (!first) return hasPhaseFlag(tasks) ? (phases[0] ? [phases[0].id] : []) : out;
    out.push(first.id);
    for (const id of viewPath.slice(1)) {
      if (tbKids(tasks, out[out.length - 1]).some((x) => x.id === id)) out.push(id);
      else break;
    }
    return out;
  }, [tasks, viewPath, phases]);

  const columns = useMemo<TaskboardTask[][]>(() => {
    if (path.length === 0) return hasPhaseFlag(tasks) ? [] : [tasks.filter((x) => !x.parent_id)];
    const cols: TaskboardTask[][] = [];
    const rootTask = tasks.find((x) => x.id === path[0]);
    if (rootTask) cols.push([rootTask]);
    // Upstream semantics: each path node contributes a column of its children.
    for (const id of path) {
      const children = tbKids(tasks, id);
      if (children.length > 0) cols.push(children);
    }
    return cols;
  }, [tasks, path, hasPhaseFlag(tasks)]);

  const pathEnd = path.length > 0 ? tasks.find((x) => x.id === path[path.length - 1]) ?? null : null;
  const activePhase = hasPhaseFlag(tasks) && path.length > 0 ? tasks.find((x) => x.id === path[0]) ?? null : null;
  const selected = tasks.find((x) => x.id === selectedId) ?? pathEnd;
  const columnWidth = columns.length === 1 ? ROOT_COLUMN_WIDTH : COLUMN_WIDTH;

  const runningList = useMemo(
    () => tasks.filter((x) => (x.kind === 'task' || x.kind === 'implementation_task') && x.status === 'in_progress'),
    [tasks],
  );

  useEffect(() => { setStatusDraft(selected?.status ?? ''); setStepDraft(selected?.current_step ?? ''); setTakeoverDraft(false); }, [selected?.id, selected?.status, selected?.current_step]);

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

  // Canvas layout (upstream ba771da): one column per expanded path hop, px-based.
  useLayoutEffect(() => {
    const graph = graphRef.current;
    if (!graph || columns.length === 0) return;
    const gap = 16; const pad = 24;
    const columnWidth = columns.length === 1 ? ROOT_COLUMN_WIDTH : COLUMN_WIDTH;
    const graphWidth = Math.max(960, GRAPH_PADDING * 2 + columns.length * columnWidth + (columns.length - 1) * COLUMN_GAP);
    const columnEls = columns.map((items, ci) =>
      items.map((item) => nodeRefs.current.get(ci + ':' + item.id)).filter(Boolean) as HTMLButtonElement[],
    );
    if (columnEls.every((els) => els.length === 0)) return;
    const columnHeight = (els: HTMLElement[]) => els.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0) + Math.max(0, els.length - 1) * gap;
    const columnHeights = columnEls.map(columnHeight);
    const h = Math.max(580, ...columnHeights.map((v) => v + pad * 2));
    const tops: Record<string, number> = {};
    const heights: Record<string, number> = {};
    const wires: string[] = [];
    columnEls.forEach((els, ci) => {
      let y = Math.max(pad, (h - columnHeights[ci]) / 2);
      els.forEach((el, i) => {
        const key = ci + ':' + columns[ci][i].id;
        tops[key] = Math.round(y);
        heights[key] = el.getBoundingClientRect().height;
        y += el.getBoundingClientRect().height + gap;
      });
    });
    for (let ci = 1; ci < columns.length; ci += 1) {
      const fromId = path[ci - 1];
      const fromKey = ci - 1 + ':' + fromId;
      if (tops[fromKey] === undefined) continue;
      const fromX = GRAPH_PADDING + (ci - 1) * (columnWidth + COLUMN_GAP) + columnWidth;
      const fromY = tops[fromKey] + heights[fromKey] / 2;
      columns[ci].forEach((task) => {
        const toKey = ci + ':' + task.id;
        const toX = GRAPH_PADDING + ci * (columnWidth + COLUMN_GAP);
        const toY = tops[toKey] + heights[toKey] / 2;
        const mid = (fromX + toX) / 2;
        wires.push('M' + fromX + ' ' + fromY + 'H' + mid + 'V' + toY + 'H' + toX);
      });
    }
    const next = JSON.stringify({ h: Math.round(h), width: graphWidth, tops, wires });
    setLayout((prev) => (JSON.stringify(prev) === next ? prev : JSON.parse(next)));
  }, [tasks, columns, path, selectedId]);

  const applyStatus = async () => {
    if (!spaceId || !selected) return;
    setBusy(true);
    try {
      await taskboardApi.updateStatus(spaceId, selected.id, {
        ...(statusDraft ? { status: statusDraft } : {}),
        ...(stepDraft !== (selected.current_step ?? '') ? { current_step: stepDraft } : {}),
        ...(takeoverDraft ? { takeover: true } : {}),
        ...(sessionDraft ? { session_id: sessionDraft } : {}),
      });
      await load();
    } catch (requestError: unknown) { setError(apiErrorMessage(requestError, t, 'taskboard.actionFailed')); }
    finally { setBusy(false); }
  };

  /** Upstream ba771da: clicking a node truncates the path at its column and expands it. */
  const openNode = (task: TaskboardTask, colIndex: number) => {
    setViewPath([...path.slice(0, colIndex), task.id]);
    setSelectedId(task.id);
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
    if (!spaceId) return;
    if (importMode !== 'page' && !planContent.trim()) return;
    if (importMode === 'page' && !selectedPageId) return;
    setBusy(true);
    try {
      const payload = importMode === 'page'
        ? { pageId: selectedPageId, sourcePath: 'agentwiki-page:' + selectedPageId, syncStatus }
        : { content: planContent, sourcePath: planSource, syncStatus };
      const data = await taskboardApi.importPlan(spaceId, payload);
      setBoard(data.board);
      setImportOpen(false);
      setPlanContent('');
      setSelectedPageId('');
      setImportNote((zh ? '导入完成：新增 ' : 'Imported: ') + data.summary.added + (zh ? ' 个，更新 ' : ' added, ') + data.summary.updated + (zh ? ' 个' : ' updated'));
    } catch (requestError: unknown) { setError(apiErrorMessage(requestError, t, 'taskboard.importFailed')); }
    finally { setBusy(false); }
  };

  const openImportDialog = () => {
    setImportOpen(true);
    if (!spaceId) return;
    void taskboardApi.listSpacePages(spaceId).then((pages) => setSpacePages(pages)).catch(() => setSpacePages([]));
  };

  const onPlanFilePicked = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPlanContent(String(reader.result ?? ''));
      setPlanSource(file.name);
    };
    reader.readAsText(file);
  };

  const locate = (t: TaskboardTask) => {
    const chain: TaskboardTask[] = [];
    const seen = new Set<string>();
    let n: TaskboardTask | undefined = t;
    while (n && !seen.has(n.id)) { chain.push(n); seen.add(n.id); n = n.parent_id ? tasks.find((x) => x.id === n!.parent_id) : undefined; }
    const ids = chain.slice().reverse().map((x) => x.id);
    setViewPath(ids.length > 0 ? ids : [t.id]);
    setSelectedId(t.id);
    window.setTimeout(() => {
      const el = nodeRefs.current.get('0:' + t.id) ?? nodeRefs.current.get('1:' + t.id) ?? nodeRefs.current.get('2:' + t.id);
      if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' });
      else graphRef.current?.scrollIntoView({ block: 'center' });
    }, 60);
  };

  const renderNode = (task: TaskboardTask, cls: 'root' | 'module' | 'cap', refKey: string, style: React.CSSProperties, onClick: () => void) => {
    const isSelected = task.id === selectedId || viewPath.includes(task.id);
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
                <i className={'dot ' + v} />{STAGE_SHORT[i]}
              </span>
            ))}
          </div>
        </div>
      </button>
    );
  };

  const inspectTask = selected ?? pathEnd ?? activePhase;
  const syncText = board ? '数据更新 ' + tbFmt(board.updated_at) : '正在读取项目记录';

  return (
    <div className="tb-page">
      <header>
        <h1>{board?.project || (zh ? '项目全景' : 'Project Overview')}</h1>
        <small>{syncText}</small>
        <span className="updated">{zh ? '项目规划 · 实现进度' : 'Plan · Progress'}</span>
        <button type="button" onClick={openImportDialog}>{zh ? '导入计划' : 'Import plan'}</button>
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
                    onClick={() => { setViewPath([phase.id]); setSelectedId(phase.id); }}
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
              onChange={(event) => { const id = event.target.value; if (!id) return; setViewPath([id]); setSelectedId(id); }}
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
            <div className="statusrow">
              <span>{zh ? '计划来源' : 'Source'}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                {([['paste', '粘贴内容'], ['upload', '上传文件'], ['page', '空间页面']] as const).map(([mode, label]) => (
                  <button key={mode} type="button"
                    onClick={() => setImportMode(mode)}
                    aria-pressed={importMode === mode}
                    className={'locate' + (importMode === mode ? '' : '')}
                    style={{ background: importMode === mode ? '#0877ff' : '#f1f5fb', color: importMode === mode ? '#fff' : '#506587' }}>{label}</button>
                ))}
              </span>
            </div>
            {importMode === 'paste' && (
              <p><textarea aria-label={t('taskboard.planContent')} value={planContent} onChange={(e) => setPlanContent(e.target.value)} rows={7} style={{ width: '100%', border: '1px solid #d8e1ed', borderRadius: 6, padding: 8, fontFamily: 'monospace', fontSize: 12 }} /></p>
            )}
            {importMode === 'upload' && (
              <p>
                <input
                  type="file"
                  aria-label={zh ? '选择计划文件' : 'Choose plan file'}
                  accept=".md,.markdown,.txt"
                  onChange={(e) => onPlanFilePicked(e.target.files?.[0])}
                  style={{ fontSize: 12 }}
                />
                {planContent.trim() ? <span style={{ marginLeft: 8, color: '#12a367' }}>✓ {zh ? '已读取' : 'loaded'}</span> : null}
              </p>
            )}
            {importMode === 'page' && (
              <label className="statusrow"><span>{zh ? '选择空间页面' : 'Wiki page'}</span>
                <select
                  aria-label={zh ? '选择空间页面' : 'Choose wiki page'}
                  value={selectedPageId}
                  onChange={(e) => setSelectedPageId(e.target.value)}
                  style={{ flex: 1, border: '1px solid #d8e1ed', borderRadius: 6, padding: '4px 8px' }}
                >
                  <option value="">{spacePages.length ? (zh ? '— 请选择 —' : '— pick —') : (zh ? '本空间暂无页面' : 'No pages in this space')}</option>
                  {spacePages.map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}
                </select>
              </label>
            )}
            <label className="statusrow">
              <span>{t('taskboard.planSource')}<br /><small>{zh ? '仅用于生成稳定任务 ID，服务器不会读取本地文件' : 'Stable task IDs only; the server never reads local files'}</small></span>
              <input
                aria-label={t('taskboard.planSource')}
                value={importMode === 'page' ? (selectedPageId ? 'agentwiki-page:' + selectedPageId : '') : planSource}
                readOnly={importMode === 'page'}
                onChange={(e) => setPlanSource(e.target.value)}
                style={{ flex: 1, border: '1px solid #d8e1ed', borderRadius: 6, padding: '4px 8px' }}
              />
            </label>
            <label className="statusrow"><span>{t('taskboard.syncStatus')}</span><input type="checkbox" aria-label={t('taskboard.syncStatus')} checked={syncStatus} onChange={(e) => setSyncStatus(e.target.checked)} /></label>
            <p>
              <button type="button" className="locate" disabled={busy || (importMode === 'page' ? !selectedPageId : !planContent.trim())} onClick={() => void importPlan()} style={{ marginRight: 8 }}>{t('taskboard.import')}</button>
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
                    <div className="crumb">
                      {path.map((id, i) => {
                        const node = tasks.find((x) => x.id === id);
                        if (!node) return null;
                        return (
                          <React.Fragment key={id}>
                            {i > 0 && <span className="crumb-sep">/</span>}
                            <button type="button" className="crumb-button" onClick={() => { setViewPath(path.slice(0, i + 1)); setSelectedId(id); }}>{tbCleanTitle(node)}</button>
                          </React.Fragment>
                        );
                      })}
                      <span className="level-hint">{zh ? '第 ' + path.length + ' 层 · ' + (columns.length > path.length ? '可继续展开' : '叶节点') : (path.length + ' levels · ' + (columns.length > path.length ? 'expandable' : 'leaf'))}</span>
                    </div>
                    <div className="view-summary">当前展开 {path.length} 层，显示 {columns.slice(1).reduce((sum, c) => sum + c.length, 0)} 个节点（各展开层合计）；点击有子节点的卡片继续展开，点击面包屑逐层返回。</div>
                  </div>
                </div>
                <div className="graphviewport">
                  <div className="graph" ref={graphRef} style={{ height: layout.h, width: layout.width }}>
                    <svg className="wires" viewBox={'0 0 ' + layout.width + ' ' + layout.h} preserveAspectRatio="none">
                      {layout.wires.map((d, i) => <path key={i} d={d} fill="none" stroke="#94a5c0" strokeWidth="1.2" strokeLinejoin="round" />)}
                    </svg>
                    {columns.map((items, ci) => items.map((task) => {
                      const key = ci + ':' + task.id;
                      const left = GRAPH_PADDING + ci * (columnWidth + COLUMN_GAP);
                      return renderNode(
                        task,
                        ci === 0 ? 'root' : ci === 1 ? 'module' : 'cap',
                        key,
                        { left, width: columnWidth, top: layout.tops[key] ?? 0 },
                        () => openNode(task, ci),
                      );
                    }))}
                    {columns.length === 1 && pathEnd && (
                      <div className="empty" style={{ position: 'absolute', left: '32%', top: '46%' }}>{zh ? '该节点暂无子项' : 'No children'}</div>
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
                        <label className="statusrow"><span>{zh ? '他人认领时接管' : 'Take over if claimed'}</span>
                          <input type="checkbox" aria-label={zh ? '他人认领时接管' : 'Take over if claimed'} checked={takeoverDraft} onChange={(e) => setTakeoverDraft(e.target.checked)} />
                        </label>
                        <label className="statusrow"><span>{t('taskboard.sessionId')}</span>
                          <input aria-label={t('taskboard.sessionId')} value={sessionDraft} onChange={(e) => setSessionDraft(e.target.value)} style={{ flex: 1, border: '1px solid #d8e1ed', borderRadius: 6, padding: '4px 8px' }} />
                        </label>
                        <p><button type="button" className="locate" disabled={busy} onClick={() => void applyStatus()}>{zh ? '保存' : 'Save'}</button></p>
                      </div>
                      <div className="box">
                        <h3>{zh ? '认领状态' : 'Claim'}</h3>
                        {(() => {
                          const claim = inspectTask.claim as { owner?: string; at?: string; takeover_from?: string } | undefined;
                          if (!claim?.owner) return <p>{zh ? '未认领（首次进入执行态将自动认领）' : 'Unclaimed; auto-claimed on first execution update'}</p>;
                          return <p>认领人：{claim.owner}{claim.at ? ' · ' + tbShortFmt(claim.at) : ''}{claim.takeover_from ? '（接管自 ' + claim.takeover_from + '）' : ''}</p>;
                        })()}
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
