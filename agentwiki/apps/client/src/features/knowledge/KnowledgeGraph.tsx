import { bugGraphText } from '../../i18n/bug-graph-messages';
import { sourceStatusText } from '../../i18n/source-status-messages';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { apiErrorMessage } from '../../api/error-message';
import api from '../../api/client';
import { Plus, Minus, X, Link2, Trash2, ChevronDown, Folder, Search, Network, Maximize2, RotateCcw, MoreHorizontal, ExternalLink, FileText, ArrowRight, ArrowLeft } from 'lucide-react';
import { ModalDialog } from '../../components/ModalDialog';
import { useGraphViewport } from './useGraphViewport';
import { buildGraphGroups, type DisplayGraphNode, type GraphFolder, type GraphGroup, type GraphPage } from './graphGrouping';
import { layoutFolderGraph, type FolderGraphBox } from './graphFolderLayout';
import { useLanguage } from '../../context/LanguageContext';
import './KnowledgeGraph.css';

interface KnowledgeEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  strength: number;
  confidence: number;
  origin: string;
  evidenceId?: string;
  createdByAgentId?: string;
  createdByAgent?: { id: string; name: string } | null;
  evidence?: { quote?: string; location?: unknown; confidence: number } | null;
  sourceInfo?: { id: string; name: string; type: string; uri?: string } | null;
  sourceVersion?: number | null;
  sourceMetadata?: { commit?: string } | null;
  approvalStatus?: string;
  approval?: { decision: string; createdAt: string; reviewer?: { name?: string; email?: string } } | null;
  publishedAt?: string | null;
}

const ORIGIN_LABELS: Record<string, { zh: string; en: string; className: string }> = {
  auto_wikilink: { zh: '自动·链接', en: 'Auto·Link', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  auto_similar: { zh: '自动·相似', en: 'Auto·Similar', className: 'bg-purple-50 text-purple-700 border-purple-200' },
  auto_llm: { zh: '自动·LLM', en: 'Auto·LLM', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  manual: { zh: '手动', en: 'Manual', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  compiled: { zh: '采集', en: 'Compiled', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  change_set: { zh: '审核', en: 'Reviewed', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  obsidian_sync: { zh: '同步', en: 'Sync', className: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
};

const OriginBadge: React.FC<{ origin: string; zh: boolean }> = ({ origin, zh }) => {
  const label = ORIGIN_LABELS[origin];
  if (!label) return null;
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${label.className}`}>
      {zh ? label.zh : label.en}
    </span>
  );
};

function keepPageInFolder(node: DisplayGraphNode, boxes: FolderGraphBox[]): DisplayGraphNode {
  const box = boxes.find(item => item.group.id === node.groupId);
  if (!box) return node;
  return { ...node, x: Math.max(box.x + 40, Math.min(box.x + box.width - 40, node.x)),
    y: Math.max(box.y + 74, Math.min(box.y + box.height - 47, node.y)) };
}

export const KnowledgeGraph: React.FC = () => {
  const { spaceId } = useParams<{ spaceId: string }>();
  const navigate = useNavigate();
  const { language, t } = useLanguage();
  const zh = language === 'zh-CN';
  const gt = useCallback((key: Parameters<typeof bugGraphText>[1], params?: Record<string, string | number>) => bugGraphText(language, key, params), [language]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasClickTarget = useRef<string | null | undefined>(undefined);
  const [nodes, setNodes] = useState<GraphPage[]>([]);
  const [folders, setFolders] = useState<GraphFolder[]>([]);
  const [graphNodes, setGraphNodes] = useState<DisplayGraphNode[]>([]);
  const movedPositions = useRef({ spaceId, grouped: new Map<string, { x: number; y: number }>(), pages: new Map<string, { x: number; y: number }>() });
  const [edges, setEdges] = useState<KnowledgeEdge[]>([]);
  const [search, setSearch] = useState('');
  const [relationType, setRelationType] = useState('');
  const [pageFilter, setPageFilter] = useState<'all' | 'connected' | 'unconnected'>('all');
  const [focusedNode, setFocusedNode] = useState<string | null>(null);
  const [grouped, setGrouped] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const requestVersion = useRef(0);
  const activeSpaceId = useRef(spaceId);
  activeSpaceId.current = spaceId;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ failure: unknown; fallbackKey: string } | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkTarget, setLinkTarget] = useState('');
  const [linkRelation, setLinkRelation] = useState('related_to');
  const [linkStrength, setLinkStrength] = useState(0.8);
  const [creating, setCreating] = useState(false);
  const [hiddenOrigins, setHiddenOrigins] = useState<Set<string>>(new Set());
  const visibleEdges = useMemo(() => edges.filter(edge => !hiddenOrigins.has(edge.origin)
    && (!relationType || edge.relation === relationType)), [edges, hiddenOrigins, relationType]);
  const connectedIds = useMemo(() => new Set(visibleEdges.flatMap(edge => [edge.source, edge.target])), [visibleEdges]);
  const focusIds = useMemo(() => focusedNode ? new Set([focusedNode, ...visibleEdges.flatMap(edge =>
    edge.source === focusedNode ? [edge.target] : edge.target === focusedNode ? [edge.source] : [])]) : null, [focusedNode, visibleEdges]);
  const groups = useMemo(() => buildGraphGroups(nodes, folders), [nodes, folders]);
  const query = search.trim().toLocaleLowerCase();
  const filteredNodes = useMemo(() => nodes.filter(node =>
    (!query || `${node.title} ${node.path ?? ''}`.toLocaleLowerCase().includes(query))
    && (!relationType || pageFilter === 'unconnected' || connectedIds.has(node.id))
    && (pageFilter === 'all' || connectedIds.has(node.id) === (pageFilter === 'connected'))
    && (!focusIds || focusIds.has(node.id))), [nodes, query, relationType, connectedIds, pageFilter, focusIds]);
  const filtering = Boolean(query || relationType || pageFilter !== 'all' || focusedNode);
  const filteredGroups = useMemo(() => {
    const matches = new Set(filteredNodes.map(node => node.id));
    return groups.map(group => ({ ...group, pages: group.pages.filter(page => matches.has(page.id)) }))
      .filter(group => !filtering || group.pages.length > 0);
  }, [groups, filteredNodes, filtering]);
  // Preview ranking uses the complete real graph, so toggling origins does not shuffle nodes.
  const folderLayout = useMemo(() => layoutFolderGraph(filteredGroups, expandedGroups, edges, selectedNode), [filteredGroups, expandedGroups, edges, selectedNode]);
  const projectedNodes = useMemo(() => grouped ? folderLayout.nodes : filteredNodes.map(node => ({ ...node, kind: 'page' as const })), [grouped, folderLayout.nodes, filteredNodes]);
  const currentLayout = useRef({ nodes: projectedNodes, boxes: folderLayout.boxes });
  currentLayout.current = { nodes: projectedNodes, boxes: folderLayout.boxes };
  useEffect(() => {
    if (movedPositions.current.spaceId !== spaceId) movedPositions.current = { spaceId, grouped: new Map(), pages: new Map() };
    const positions = grouped ? movedPositions.current.grouped : movedPositions.current.pages;
    setGraphNodes(projectedNodes.map(node => {
      const position = positions.get(node.id);
      if (!position) return node;
      // Group movement is stored relative to the layout, so compacted search results
      // move the page together with its folder instead of leaving it at an old column.
      const placed = { ...node, x: grouped ? node.x + position.x : position.x, y: grouped ? node.y + position.y : position.y };
      return grouped ? keepPageInFolder(placed, currentLayout.current.boxes) : placed;
    }));
  }, [projectedNodes, grouped, spaceId]);
  const moveGraphNodes = useCallback<React.Dispatch<React.SetStateAction<DisplayGraphNode[]>>>(update => {
    setGraphNodes(current => {
      const updated = typeof update === 'function' ? update(current) : update;
      const next = grouped ? updated.map(node => keepPageInFolder(node, currentLayout.current.boxes)) : updated;
      if (movedPositions.current.spaceId === spaceId) {
        const positions = grouped ? movedPositions.current.grouped : movedPositions.current.pages;
        const previous = new Map(current.map(node => [node.id, node]));
        next.forEach(node => {
          const old = previous.get(node.id);
          if (old && (old.x !== node.x || old.y !== node.y)) {
            const seed = grouped ? currentLayout.current.nodes.find(item => item.id === node.id) : undefined;
            positions.set(node.id, { x: node.x - (seed?.x ?? 0), y: node.y - (seed?.y ?? 0) });
          }
        });
      }
      return next;
    });
  }, [grouped, spaceId]);
  const viewport = useGraphViewport(canvasRef, graphNodes, moveGraphNodes, !loading && !error && (graphNodes.length > 0 || filteredGroups.length > 0), grouped ? folderLayout.bounds : undefined, grouped ? 0.65 : 0.25);
  const graphNodeIds = graphNodes.map(node => node.id).join('|');
  const boundsKey = grouped ? JSON.stringify(folderLayout.bounds) : '';
  useEffect(() => { viewport.fitReadable(); }, [graphNodeIds, boundsKey]);
  useEffect(() => { if (selectedNode) viewport.reveal(selectedNode); }, [selectedNode, graphNodeIds]);
  const groupTitle = (group: GraphGroup) => group.folder?.name ?? gt(group.kind === 'ungrouped' ? 'graph.ungrouped' : 'graph.folderUnavailable');
  const toggleGroup = (id: string) => setExpandedGroups(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectPage = (id: string | null) => setSelectedNode(id);
  useEffect(() => {
    if (selectedNode && !filteredNodes.some(node => node.id === selectedNode)) setSelectedNode(null);
  }, [filteredNodes, selectedNode]);
  const clearFilters = () => { setSearch(''); setRelationType(''); setPageFilter('all'); setFocusedNode(null); setHiddenOrigins(new Set()); };

  const fetchGraph = useCallback(async () => {
    if (!spaceId || activeSpaceId.current !== spaceId) return;
    const version = ++requestVersion.current;
    try {
      const graphRes = await api.get(`/knowledge/graph/${spaceId}`);
      if (version !== requestVersion.current) return;
      setNodes(graphRes.data.nodes || []);
      setEdges(graphRes.data.edges || []);
      setFolders(graphRes.data.folders || []);
      setError(null);
    } catch (err: unknown) {
      if (version === requestVersion.current) setError({ failure: err, fallbackKey: 'graph.loadFailed' });
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    setLoading(true);
    canvasClickTarget.current = undefined;
    setSelectedNode(null); setFocusedNode(null); setPageFilter('all');
    setLinkingFrom(null); setLinkTarget(''); setCreating(false);
    setShowLinkModal(false); setExpandedGroups(new Set());
    setSearch(''); setRelationType(''); setHiddenOrigins(new Set());
    void fetchGraph();
    return () => { requestVersion.current++; };
  }, [fetchGraph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width, height } = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const { scale, x, y } = viewport.view;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * x, dpr * y);
    const byId = new Map(graphNodes.map(node => [node.id, node]));
    visibleEdges.forEach(edge => {
      const source = byId.get(edge.source); const target = byId.get(edge.target);
      if (!source || !target || source.id === target.id) return;
      const active = edge.source === selectedNode || edge.target === selectedNode;
      const bend = Math.max(48, Math.abs(target.x - source.x) * 0.45);
      const sign = target.x >= source.x ? 1 : -1;
      const endX = target.x - sign * (target.radius + 3);
      ctx.beginPath(); ctx.moveTo(source.x + sign * source.radius, source.y);
      ctx.bezierCurveTo(source.x + sign * bend, source.y, target.x - sign * bend, target.y, endX, target.y);
      ctx.strokeStyle = active ? '#9aaac8' : '#c2cad8'; ctx.lineWidth = active ? 1.5 : 1.1;
      ctx.setLineDash(edge.origin === 'auto_similar' ? [5, 5] : []); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(endX, target.y); ctx.lineTo(endX - sign * 6, target.y - 3); ctx.lineTo(endX - sign * 6, target.y + 3);
      ctx.fillStyle = active ? '#9aaac8' : '#c2cad8'; ctx.fill();
    });
    graphNodes.forEach(node => {
      const selected = selectedNode === node.id; const linking = linkingFrom === node.id;
      ctx.beginPath(); ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = linking ? '#fef3c7' : selected ? '#4779ff' : '#edf3ff'; ctx.fill();
      if (selected) { ctx.strokeStyle = '#c4d4ff'; ctx.lineWidth = 7; ctx.stroke(); }
      ctx.strokeStyle = linking ? '#d97706' : '#6e97ff'; ctx.lineWidth = selected ? 1.8 : 1.15; ctx.stroke();
    });
  }, [graphNodes, visibleEdges, selectedNode, linkingFrom, viewport.view]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || viewport.suppressClick.current || e.detail > 1) return;
    viewport.suppressDoubleClick.current = false;
    const clicked = viewport.hit(e);
    canvasClickTarget.current = clicked?.id ?? null;
    if (clicked && linkingFrom && clicked.id !== linkingFrom) { setLinkTarget(clicked.id); setShowLinkModal(true); }
    else setSelectedNode(clicked && selectedNode !== clicked.id ? clicked.id : null);
  };
  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || viewport.suppressClick.current || viewport.suppressDoubleClick.current) return;
    const target = canvasClickTarget.current === undefined ? viewport.hit(e)?.id : canvasClickTarget.current;
    canvasClickTarget.current = undefined;
    if (target && filteredNodes.some(node => node.id === target)) navigate(`/pages/${target}`);
  };
  const handleCreateLink = async () => {
    if (!linkingFrom || !linkTarget || !linkRelation.trim()) return;
    const operationSpace = spaceId;
    setCreating(true);
    try {
      await api.post('/knowledge/relations', { relation: linkRelation.trim(), sourcePageId: linkingFrom, targetPageId: linkTarget, strength: linkStrength });
      if (activeSpaceId.current !== operationSpace) return;
      setShowLinkModal(false); setLinkingFrom(null); setLinkTarget(''); setLinkRelation('related_to'); setLinkStrength(0.8);
      await fetchGraph();
    } catch (err: unknown) {
      if (activeSpaceId.current === operationSpace) setError({ failure: err, fallbackKey: 'graph.createFailed' });
    } finally { if (activeSpaceId.current === operationSpace) setCreating(false); }
  };
  const handleDeleteRelation = async (relationId: string) => {
    if (!window.confirm(zh ? '确定删除此关系吗？' : 'Delete this relation?')) return;
    const operationSpace = spaceId;
    try { await api.delete('/knowledge/relations/' + relationId); if (activeSpaceId.current === operationSpace) await fetchGraph(); }
    catch (err: unknown) { if (activeSpaceId.current === operationSpace) setError({ failure: err, fallbackKey: 'graph.deleteFailed' }); }
  };
  const startLinking = () => { if (selectedNode) { setLinkingFrom(selectedNode); setShowLinkModal(true); } };
  const closeLinkDialog = () => { if (!creating) { setShowLinkModal(false); setLinkingFrom(null); } };
  const selectedPage = nodes.find(node => node.id === selectedNode);
  const selectedEdges = visibleEdges.filter(edge => edge.source === selectedNode || edge.target === selectedNode);
  const relatedPages = [...new Set(selectedEdges.map(edge => edge.source === selectedNode ? edge.target : edge.source))].map(id => ({
    id, page: nodes.find(node => node.id === id), edges: selectedEdges.filter(edge => edge.source === id || edge.target === id),
  }));
  const allPages = nodes;
  const selectedVisual = graphNodes.find(node => node.id === selectedNode);
  const canvasWidth = canvasRef.current?.getBoundingClientRect().width || 800;
  const canvasHeight = canvasRef.current?.getBoundingClientRect().height || 620;
  const selectedPoint = selectedVisual ? { x: selectedVisual.x * viewport.view.scale + viewport.view.x, y: selectedVisual.y * viewport.view.scale + viewport.view.y } : null;
  const popupVisible = selectedPoint && selectedPoint.x >= 0 && selectedPoint.x <= canvasWidth && selectedPoint.y >= 0 && selectedPoint.y <= canvasHeight;

  if (loading) return <div role="status" className="text-center py-8 text-gray-500">{zh ? '正在加载知识图谱…' : 'Loading knowledge graph…'}</div>;
  if (error) return <div className="text-center py-8"><p role="alert" className="text-red-500 mb-2">{apiErrorMessage(error.failure, t, error.fallbackKey)}</p><Link to={spaceId ? `/spaces/${spaceId}` : '/'} className="text-blue-600 hover:underline">{zh ? '返回' : 'Go back'}</Link></div>;

  return <div className="knowledge-graph">
    <header className="graph-heading">
      <nav aria-label={zh ? '面包屑' : 'Breadcrumb'}><Link to={spaceId ? `/spaces/${spaceId}` : '/'}>{zh ? '空间' : 'Space'}</Link><span>/</span><span>{zh ? '知识图谱' : 'Knowledge graph'}</span></nav>
      <h1>{zh ? '关系网络' : 'Connections'}</h1><p>{gt('graph.subtitle')}</p>
    </header>
    <div className="graph-toolbar">
      <label className="graph-search"><Search size={18} /><span className="sr-only">{gt('graph.search')}</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={gt('graph.searchPlaceholder')} /></label>
      <div className="graph-count-filters" aria-label={gt('graph.pageFilter')}>
        {(['all', 'connected', 'unconnected'] as const).map(filter => <button key={filter} type="button" aria-pressed={pageFilter === filter} onClick={() => { setPageFilter(filter); setFocusedNode(null); }}>
          {gt(`graph.${filter}`)} <span>{filter === 'all' ? nodes.length : nodes.filter(node => connectedIds.has(node.id) === (filter === 'connected')).length}</span>
        </button>)}
      </div>
      <details className="graph-filter-menu"><summary><Network size={18} />{gt('graph.relationTypes')}<ChevronDown size={14} /></summary>
        <div className="graph-filter-popover">
          <label>{gt('graph.relationFilter')}<select value={relationType} onChange={event => setRelationType(event.target.value)}><option value="">{gt('graph.allRelations')}</option>{[...new Set(edges.map(edge => edge.relation))].sort().map(relation => <option key={relation} value={relation}>{relation}</option>)}</select></label>
          <p>{gt('graph.origins')}</p><div className="graph-origin-filters">{[...new Set(edges.map(edge => edge.origin))].map(origin => {
            const label = ORIGIN_LABELS[origin];
            return <button key={origin} type="button" aria-pressed={!hiddenOrigins.has(origin)} className={hiddenOrigins.has(origin) ? 'line-through' : ''} onClick={() => setHiddenOrigins(current => { const next = new Set(current); if (next.has(origin)) next.delete(origin); else next.add(origin); return next; })}>{label ? (zh ? label.zh : label.en) : origin}</button>;
          })}</div>
          <p>{gt('graph.view')}</p><div className="graph-origin-filters"><button type="button" aria-pressed={grouped} onClick={() => setGrouped(true)}>{gt('graph.grouped')}</button><button type="button" aria-pressed={!grouped} onClick={() => setGrouped(false)}>{gt('graph.allPages')}</button></div>
        </div>
      </details>
      <div className="graph-view-actions"><button type="button" onClick={viewport.fit}><Maximize2 size={17} />{zh ? '适应图谱' : 'Fit graph'}</button><button type="button" onClick={viewport.reset}><RotateCcw size={17} />{zh ? '重置视图' : 'Reset view'}</button></div>
    </div>
    <p role="status" className={filtering || hiddenOrigins.size ? 'graph-result-count' : 'sr-only'}>{gt('graph.resultCount', { count: filteredNodes.length, total: nodes.length })}{filtering && <button type="button" onClick={clearFilters}>{gt('graph.clearFilters')}</button>}</p>
    {linkingFrom && <div className="mb-3 rounded-md bg-amber-50 p-3 text-sm text-amber-700">{zh ? '正在从以下页面建立关系：' : 'Linking from:'} <strong>{nodes.find(node => node.id === linkingFrom)?.title}</strong></div>}
    <div className="graph-workspace grid lg:grid-cols-[minmax(0,1fr)_292px]">
      <div className={`graph-stage ${viewport.view.scale < 0.45 ? 'is-overview' : ''}`}>
        <canvas ref={canvasRef} aria-hidden="true" className="graph-canvas" onClick={handleCanvasClick} onDoubleClick={handleCanvasDoubleClick} />
        <div className="graph-folders-layer">
          {grouped && folderLayout.boxes.map(box => <section key={box.group.id} className="graph-folder-box" data-folder-id={box.group.id} style={{ left: box.x * viewport.view.scale + viewport.view.x, top: box.y * viewport.view.scale + viewport.view.y, width: box.width * viewport.view.scale, height: box.height * viewport.view.scale }}>
            <button type="button" className="graph-folder-title" aria-expanded={expandedGroups.has(box.group.id)} title={box.group.folder?.path} aria-label={`${groupTitle(box.group)} ${box.group.folder?.path ? `${box.group.folder.path} ` : ''}${gt('graph.pageCount', { count: box.group.pages.length })}`} onClick={() => toggleGroup(box.group.id)}><Folder size={21} /><strong>{groupTitle(box.group)}</strong><span>· {gt('graph.pageCount', { count: box.group.pages.length })}</span><MoreHorizontal size={17} className="graph-folder-menu-icon" /></button>
            {box.group.pages.length === 0 && <p className="graph-empty-folder">{gt('graph.emptyFolder')}</p>}
          </section>)}
        </div>
        <div className="graph-labels-layer">
          {graphNodes.map(node => <button type="button" key={node.id} className={`graph-node-label ${selectedNode === node.id ? 'is-selected' : ''}`} aria-label={`${node.title} ${node.path || gt('graph.pathUnavailable')}`} aria-pressed={selectedNode === node.id} title={node.path || node.title} data-node-id={node.id} style={{ width: Math.max(74, Math.min(120, 140 * viewport.view.scale)), left: node.x * viewport.view.scale + viewport.view.x, top: (node.y + node.radius) * viewport.view.scale + viewport.view.y + 8 }} onClick={() => selectPage(node.id)} onDoubleClick={() => navigate(`/pages/${node.id}`)}>{node.title}</button>)}
          {grouped && folderLayout.boxes.filter(box => box.hiddenCount > 0).map(box => <button key={box.group.id} type="button" className="graph-more-node" aria-label={gt('graph.expandFolder', { folder: groupTitle(box.group), count: box.hiddenCount })} onClick={() => toggleGroup(box.group.id)} style={{ left: box.moreX * viewport.view.scale + viewport.view.x, top: box.moreY * viewport.view.scale + viewport.view.y }}><span><Plus size={20} /></span>{gt('graph.more')}</button>)}
        </div>
        {popupVisible && selectedPoint && selectedPage && <div className="graph-node-popup" style={{ left: Math.max(8, Math.min(canvasWidth - 208, selectedPoint.x + 28)), top: Math.max(12, Math.min(canvasHeight - 150, selectedPoint.y - 92)) }}><strong>{selectedPage.path || selectedPage.title}</strong><p>{gt('graph.relatedPages')} {relatedPages.length}</p><button type="button" onClick={() => { setFocusedNode(selectedNode); setPageFilter('all'); setSearch(''); }}>{gt('graph.onlyRelated')}</button></div>}
        {nodes.length === 0 && folders.length === 0 ? <div className="graph-empty-state"><Network size={32} /><p>{zh ? '还没有知识图谱数据。创建页面并添加页面间关系后即可形成图谱。' : 'No knowledge graph data yet. Create pages and add links between them to build the graph.'}</p></div> : filteredGroups.length === 0 && filteredNodes.length === 0 && <div className="graph-empty-state"><Search size={28} /><p>{gt('graph.noMatches')}</p></div>}
        <div className="graph-legend"><span><i />{gt('graph.manualLegend')}</span><span><i className="is-dashed" />{gt('graph.similarLegend')}</span></div>
        <div className="graph-zoom"><button type="button" onClick={() => viewport.zoom(1 / 1.25)} aria-label={zh ? '缩小图谱' : 'Zoom out'}><Minus size={16} /></button><output aria-label={zh ? '图谱缩放比例' : 'Graph zoom'}>{Math.round(viewport.view.scale * 100)}%</output><button type="button" onClick={() => viewport.zoom(1.25)} aria-label={zh ? '放大图谱' : 'Zoom in'}><Plus size={16} /></button></div>
      </div>
      {selectedNode ? <aside aria-label={gt('graph.pageDetails')} className="graph-details">
        <div className="graph-details-heading"><h2>{gt('graph.pageDetails')}</h2><button type="button" aria-label={gt('graph.closeDetails')} onClick={() => setSelectedNode(null)}><X size={17} /></button></div>
        <h3 className="graph-page-title">{selectedPage?.title}</h3><dl className="graph-page-path"><dt>{gt('graph.pagePath')}</dt><dd><Folder size={17} /><span>{selectedPage?.path || gt('graph.pathUnavailable')}</span></dd></dl>
        <Link to={`/pages/${selectedNode}`} className="graph-open-page"><ExternalLink size={17} />{zh ? '打开页面' : 'Open page'}</Link>
        <div className="graph-related-heading"><h3>{gt('graph.relatedPages')} <span>{relatedPages.length}</span></h3><p className="sr-only">{gt('graph.connectedCount', { pages: relatedPages.length, relations: selectedEdges.length })}</p></div>
        {relatedPages.length === 0 && <p className="graph-no-relations">{gt('graph.noRelations')}</p>}
        <div className="graph-related-pages">{relatedPages.map(related => <article key={related.id}>
          <Link to={`/pages/${related.id}`} className="graph-related-page"><span className="graph-file-icon"><FileText size={21} /></span><span><strong>{related.page?.title || (zh ? '未知' : 'Unknown')}</strong><small>{related.page?.path || gt('graph.pathUnavailable')}</small></span></Link>
          <details className="graph-relation-evidence"><summary>{gt('graph.relationshipDetails', { count: related.edges.length })}</summary>{related.edges.map(edge => <div key={edge.id} className="graph-evidence-item"><div className="graph-evidence-title">{edge.source === selectedNode ? <ArrowRight size={13} aria-label={zh ? '出向关系' : 'Outgoing relation'} /> : <ArrowLeft size={13} aria-label={zh ? '入向关系' : 'Incoming relation'} />}<span>({edge.relation})</span><OriginBadge origin={edge.origin} zh={zh} /><button type="button" title={zh ? '删除关系' : 'Delete relation'} onClick={() => handleDeleteRelation(edge.id)}><Trash2 size={14} /></button></div>
                          <dl className="mt-2 grid gap-1 text-xs text-gray-500">
                            <div><dt className="inline font-medium text-gray-600">{zh ? '来源方式：' : 'Origin: '}</dt><dd className="inline">{edge.origin}</dd></div>
                            <div><dt className="inline font-medium text-gray-600">{zh ? '置信度：' : 'Confidence: '}</dt><dd className="inline">{Math.round((edge.confidence ?? 1) * 100)}%</dd></div>
                            <div><dt className="inline font-medium text-gray-600">{zh ? '生成者：' : 'Generated by: '}</dt><dd className="inline">{edge.createdByAgent?.name || (edge.origin === 'manual' ? (zh ? '人工' : 'Human') : (zh ? '未知' : 'Unknown'))}</dd></div>
                            <div><dt className="inline font-medium text-gray-600">{zh ? '审批：' : 'Approval: '}</dt><dd className="inline">{edge.approvalStatus || (zh ? '未知' : 'unknown')}{edge.approval?.reviewer ? ` · ${edge.approval.reviewer.name || edge.approval.reviewer.email}` : ''}</dd></div>
                            <div className="break-words"><dt className="inline font-medium text-gray-600">{zh ? '来源：' : 'Source: '}</dt><dd className="inline break-all">{edge.sourceInfo ? `${edge.sourceInfo.name} · ${edge.sourceInfo.type}${edge.sourceVersion ? ` · v${edge.sourceVersion}` : ''}` : sourceStatusText(language, 'sourceStatus.unavailable')}{edge.sourceMetadata?.commit ? ` · ${edge.sourceMetadata.commit}` : ''}</dd></div>
                            <div className="break-words"><dt className="inline font-medium text-gray-600">{zh ? '证据：' : 'Evidence: '}</dt><dd className="inline">{edge.evidence?.quote || (zh ? '没有证据片段' : 'No evidence excerpt')}</dd></div>
                          </dl>          </div>)}</details>
        </article>)}</div>
        <button type="button" onClick={startLinking} className="graph-link-page"><Link2 size={16} />{zh ? '建立关系…' : 'Link to…'}</button>
      </aside> : <div className="graph-details graph-details-empty hidden lg:block"><h2>{gt('graph.pageDetails')}</h2><div><Network size={30} /><p>{gt('graph.selectHint')}</p></div></div>}
    </div>
    <div className="graph-accessible-browser">
      <p>{gt('graph.navigationHint')}</p>
      <label htmlFor="knowledge-node-browser">{zh ? '浏览图谱节点' : 'Browse graph nodes'}</label><select id="knowledge-node-browser" value={selectedNode ?? ''} onChange={event => selectPage(event.target.value || null)}><option value="">{zh ? '选择页面…' : 'Select a page…'}</option>{filteredNodes.map(node => <option key={node.id} value={node.id}>{node.title}</option>)}</select>
      {selectedNode && <Link to={`/pages/${selectedNode}`}>{zh ? '打开所选页面' : 'Open selected page'}</Link>}
    </div>
      {showLinkModal && linkingFrom && (
        <ModalDialog
          labelledBy="knowledge-link-dialog-title"
          onRequestClose={closeLinkDialog}
          closeDisabled={creating}
          className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-[14px] bg-white p-6 shadow-xl"
        >
            <div className="flex items-center justify-between mb-4">
              <h2 id="knowledge-link-dialog-title" className="text-xl font-bold">{zh ? '创建关系' : 'Create link'}</h2>
              <button
                type="button"
                onClick={closeLinkDialog}
                disabled={creating}
                aria-label={zh ? '关闭创建关系窗口' : 'Close create link dialog'}
                className="p-1 hover:bg-gray-100 rounded disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">{zh ? '从' : 'From'}</label>
                <div className="px-3 py-2 bg-gray-50 rounded-md text-sm text-gray-600">
                  {nodes.find(n => n.id === linkingFrom)?.title}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{zh ? '到' : 'To'} *</label>
                <select
                  value={linkTarget}
                  onChange={e => setLinkTarget(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">{zh ? '选择页面…' : 'Select a page…'}</option>
                  {allPages.filter(p => p.id !== linkingFrom).map(page => (
                    <option key={page.id} value={page.id}>{page.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{zh ? '关系类型' : 'Relation type'}</label>
                <input
                  type="text"
                  value={linkRelation}
                  onChange={e => setLinkRelation(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. related_to, depends_on, extends"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{zh ? '强度' : 'Strength'}: {linkStrength.toFixed(1)}</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={linkStrength}
                  onChange={e => setLinkStrength(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={closeLinkDialog} disabled={creating} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md disabled:opacity-50">
                  {zh ? '取消' : 'Cancel'}
                </button>
                <button
                  onClick={handleCreateLink}
                  disabled={creating || !linkTarget}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  <Plus size={18} />
                  {creating ? (zh ? '创建中…' : 'Creating…') : (zh ? '创建关系' : 'Create link')}
                </button>
              </div>
            </div>
        </ModalDialog>
      )}
  </div>;
};
