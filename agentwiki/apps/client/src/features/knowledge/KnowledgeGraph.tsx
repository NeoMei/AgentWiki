import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { ArrowLeft, Plus, X, Link2, Trash2 } from 'lucide-react';
import { ModalDialog } from '../../components/ModalDialog';
import { SpaceNav } from '../../components/SpaceNav';
import { useLanguage } from '../../context/LanguageContext';

interface KnowledgeNode {
  id: string;
  title: string;
  x: number;
  y: number;
  radius: number;
}

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

interface Page {
  id: string;
  title: string;
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

export const KnowledgeGraph: React.FC = () => {
  const { spaceId } = useParams<{ spaceId: string }>();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodes, setNodes] = useState<KnowledgeNode[]>([]);
  const [edges, setEdges] = useState<KnowledgeEdge[]>([]);
  const [allPages, setAllPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkTarget, setLinkTarget] = useState('');
  const [linkRelation, setLinkRelation] = useState('related_to');
  const [linkStrength, setLinkStrength] = useState(0.8);
  const [creating, setCreating] = useState(false);
  const [hiddenOrigins, setHiddenOrigins] = useState<Set<string>>(new Set());
  const visibleEdges = edges.filter((edge) => !hiddenOrigins.has(edge.origin));

  const fetchGraph = async () => {
    if (!spaceId) return;
    try {
      const [graphRes, pagesRes] = await Promise.all([
        api.get(`/knowledge/graph/${spaceId}`),
        api.get(`/pages?spaceId=${spaceId}`),
      ]);
      setNodes(graphRes.data.nodes || []);
      setEdges(graphRes.data.edges || []);
      setAllPages((pagesRes.data.data || []).map((p: any) => ({ id: p.id, title: p.title })));
    } catch (err: any) {
      setError(err.response?.data?.message || (zh ? '知识图谱加载失败' : 'Failed to load knowledge graph'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGraph();
  }, [spaceId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvas.offsetWidth * 2;
    canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);

    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    ctx.clearRect(0, 0, width, height);

    // Draw edges
    visibleEdges.forEach(edge => {
      const source = nodes.find(n => n.id === edge.source);
      const target = nodes.find(n => n.id === edge.target);
      if (source && target) {
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        const isActive = selectedNode && (edge.source === selectedNode || edge.target === selectedNode);
        ctx.strokeStyle = isActive ? `rgba(59, 130, 246, ${edge.strength * 0.8})` : `rgba(100, 100, 100, ${edge.strength * 0.4})`;
        ctx.lineWidth = isActive ? edge.strength * 4 : edge.strength * 3;
        ctx.stroke();
      }
    });

    // Draw nodes
    nodes.forEach(node => {
      const isSelected = selectedNode === node.id;
      const isLinking = linkingFrom === node.id;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      if (isLinking) {
        ctx.fillStyle = '#F59E0B';
        ctx.strokeStyle = '#D97706';
      } else if (isSelected) {
        ctx.fillStyle = '#3B82F6';
        ctx.strokeStyle = '#1D4ED8';
      } else {
        ctx.fillStyle = '#60A5FA';
        ctx.strokeStyle = '#3B82F6';
      }
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#1F2937';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.title.length > 20 ? node.title.substring(0, 20) + '...' : node.title, node.x, node.y + node.radius + 15);
    });
  }, [nodes, visibleEdges, selectedNode, linkingFrom]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const clicked = nodes.find(node => {
      const dx = x - node.x;
      const dy = y - node.y;
      return Math.sqrt(dx * dx + dy * dy) < node.radius + 5;
    });

    if (clicked) {
      // If in linking mode and clicked a different node, open link modal
      if (linkingFrom && clicked.id !== linkingFrom) {
        setLinkTarget(clicked.id);
        setShowLinkModal(true);
      } else {
        setSelectedNode(selectedNode === clicked.id ? null : clicked.id);
      }
    } else {
      setSelectedNode(null);
    }
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const clicked = nodes.find(node => {
      const dx = x - node.x;
      const dy = y - node.y;
      return Math.sqrt(dx * dx + dy * dy) < node.radius + 5;
    });

    if (clicked) {
      navigate(`/pages/${clicked.id}`);
    }
  };

  const handleCreateLink = async () => {
    if (!linkingFrom || !linkTarget || !linkRelation.trim()) return;
    setCreating(true);
    try {
      await api.post('/knowledge/relations', {
        relation: linkRelation.trim(),
        sourcePageId: linkingFrom,
        targetPageId: linkTarget,
        strength: linkStrength,
      });
      setShowLinkModal(false);
      setLinkingFrom(null);
      setLinkTarget('');
      setLinkRelation('related_to');
      setLinkStrength(0.8);
      await fetchGraph();
    } catch (err: any) {
      setError(err.response?.data?.message || (zh ? '关系创建失败' : 'Failed to create link'));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteRelation = async (relationId: string) => {
    if (!window.confirm(zh ? '确定删除此关系吗？' : 'Delete this relation?')) return;
    try {
      await api.delete('/knowledge/relations/' + relationId);
      await fetchGraph();
    } catch (err: any) {
      setError(err.response?.data?.message || (zh ? '关系删除失败' : 'Failed to delete relation'));
    }
  };

  const startLinking = () => {
    if (!selectedNode) return;
    setLinkingFrom(selectedNode);
    setShowLinkModal(true);
  };

  const closeLinkDialog = () => {
    if (creating) return;
    setShowLinkModal(false);
    setLinkingFrom(null);
  };

  if (loading) return <div className="text-center py-8 text-gray-500">{zh ? '正在加载知识图谱…' : 'Loading knowledge graph…'}</div>;
  if (error) return (
    <div className="text-center py-8">
      <p className="text-red-500 mb-2">{error}</p>
      <Link to={spaceId ? `/spaces/${spaceId}` : '/'} className="text-blue-600 hover:underline">{zh ? '返回' : 'Go back'}</Link>
    </div>
  );

  return (
    <div>
      <SpaceNav spaceId={spaceId} />
      <div className='flex flex-wrap items-center gap-2 mb-3'>
        {[...new Set(edges.map((edge) => edge.origin))].map((origin) => {
          const hidden = hiddenOrigins.has(origin);
          const label = ORIGIN_LABELS[origin];
          if (!label) return null;
          const toggle = () => setHiddenOrigins((current) => {
            const next = new Set(current);
            if (next.has(origin)) next.delete(origin);
            else next.add(origin);
            return next;
          });
          const chipClass = hidden
            ? 'bg-white text-gray-400 border-gray-200 line-through'
            : label.className;
          return (
            <button
              key={origin}
              type='button'
              onClick={toggle}
              className={'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ' + chipClass}
            >
              {zh ? label.zh : label.en}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3 mb-4">
        <Link to={spaceId ? `/spaces/${spaceId}` : '/'} className="p-2 hover:bg-gray-100 rounded" title={zh ? '返回空间' : 'Back to space'}>
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <div className="text-sm text-gray-400">{zh ? '知识图谱' : 'Knowledge graph'}</div>
          <h1 className="text-2xl font-bold">{zh ? '关系网络' : 'Connections'}</h1>
        </div>
      </div>

      {linkingFrom && (
        <div className="mb-3 p-3 bg-amber-50 rounded-md flex items-center justify-between">
          <span className="text-sm text-amber-700">
            {zh ? '正在从以下页面建立关系：' : 'Linking from:'} <strong>{nodes.find(n => n.id === linkingFrom)?.title}</strong> — {zh ? '点击另一个节点或在下方选择' : 'click another node or pick below'}
          </span>
          <button onClick={() => { setLinkingFrom(null); setShowLinkModal(false); }} className="p-1 hover:bg-amber-100 rounded">
            <X size={16} />
          </button>
        </div>
      )}

      {nodes.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {zh ? '还没有知识图谱数据。创建页面并添加页面间关系后即可形成图谱。' : 'No knowledge graph data yet. Create pages and add links between them to build the graph.'}
        </div>
      ) : (
        <>
          <div className="text-sm text-gray-400 mb-2">
            <span className="hidden sm:inline">{zh ? '单击选择 · 双击打开 · 使用“建立关系”按钮连接页面' : 'Click to select · Double-click to open · Use “Link” to connect pages'}</span>
            <span className="sm:hidden">{zh ? '轻触选择 · 双击打开' : 'Tap to select · Double-tap to open'}</span>
          </div>
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <canvas
              ref={canvasRef}
              className="w-full h-[500px] cursor-pointer"
              onClick={handleCanvasClick}
              onDoubleClick={handleCanvasDoubleClick}
            />
          </div>
          {selectedNode && (
            <div className="mt-4 p-4 bg-blue-50 rounded-lg flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="font-semibold text-blue-900">
                  {nodes.find(n => n.id === selectedNode)?.title}
                </h3>
                <p className="text-sm text-blue-700 mt-1">
                  {zh ? `已连接 ${visibleEdges.filter(e => e.source === selectedNode || e.target === selectedNode).length} 个其他页面` : `Connected to ${visibleEdges.filter(e => e.source === selectedNode || e.target === selectedNode).length} other page(s)`}
                </p>
                {visibleEdges.filter(e => e.source === selectedNode || e.target === selectedNode).length > 0 && (
                  <div className="mt-2 space-y-1">
                    {visibleEdges.filter(e => e.source === selectedNode || e.target === selectedNode).map(edge => {
                      const otherId = edge.source === selectedNode ? edge.target : edge.source;
                      const otherNode = nodes.find(n => n.id === otherId);
                      return (
                        <div key={edge.id} className="text-sm bg-white/70 rounded p-3 border border-blue-100">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-700 font-medium">
                              {edge.source === selectedNode ? '→' : '←'} {otherNode?.title || (zh ? '未知' : 'Unknown')}
                            </span>
                            <span className="text-xs text-gray-500">({edge.relation})</span>
                            <OriginBadge origin={edge.origin} zh={zh} />
                          <button
                            onClick={() => handleDeleteRelation(edge.id)}
                            className="ml-auto p-1 text-gray-400 hover:text-red-600 rounded"
                            title={zh ? '删除关系' : 'Delete relation'}
                          >
                            <Trash2 size={14} />
                          </button>
                          </div>
                          <dl className="mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
                            <div><dt className="inline font-medium text-gray-600">{zh ? '来源方式：' : 'Origin: '}</dt><dd className="inline">{edge.origin}</dd></div>
                            <div><dt className="inline font-medium text-gray-600">{zh ? '置信度：' : 'Confidence: '}</dt><dd className="inline">{Math.round((edge.confidence ?? 1) * 100)}%</dd></div>
                            <div><dt className="inline font-medium text-gray-600">{zh ? '生成者：' : 'Generated by: '}</dt><dd className="inline">{edge.createdByAgent?.name || (edge.origin === 'manual' ? (zh ? '人工' : 'Human') : (zh ? '未知' : 'Unknown'))}</dd></div>
                            <div><dt className="inline font-medium text-gray-600">{zh ? '审批：' : 'Approval: '}</dt><dd className="inline">{edge.approvalStatus || (zh ? '未知' : 'unknown')}{edge.approval?.reviewer ? ` · ${edge.approval.reviewer.name || edge.approval.reviewer.email}` : ''}</dd></div>
                            <div className="sm:col-span-2"><dt className="inline font-medium text-gray-600">{zh ? '来源：' : 'Source: '}</dt><dd className="inline break-all">{edge.sourceInfo ? `${edge.sourceInfo.name} · ${edge.sourceInfo.type}${edge.sourceVersion ? ` · v${edge.sourceVersion}` : ''}` : (zh ? '没有外部来源' : 'No external source')}{edge.sourceMetadata?.commit ? ` · ${edge.sourceMetadata.commit}` : ''}</dd></div>
                            <div className="sm:col-span-2"><dt className="inline font-medium text-gray-600">{zh ? '证据：' : 'Evidence: '}</dt><dd className="inline">{edge.evidence?.quote || (zh ? '没有证据片段' : 'No evidence excerpt')}</dd></div>
                          </dl>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={startLinking}
                  className="flex items-center gap-1 px-3 py-2 bg-amber-100 text-amber-700 rounded-md hover:bg-amber-200 text-sm"
                >
                  <Link2 size={16} />
                  {zh ? '建立关系…' : 'Link to…'}
                </button>
                <Link
                  to={`/pages/${selectedNode}`}
                  className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
                >
                  {zh ? '打开页面' : 'Open page'}
                </Link>
              </div>
            </div>
          )}
        </>
      )}

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
    </div>
  );
};
