import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, RotateCcw, Send, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';

const CandidateDiff: React.FC<{ item: any }> = ({ item }) => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const payload = item.payload || {};
  if (item.type === 'create_page') return (
    <div className="mt-3 grid md:grid-cols-2 gap-2 text-xs">
      <div className="border border-red-100 bg-red-50/50 rounded p-3"><p className="font-medium text-red-700 mb-2">{zh ? '变更前' : 'Before'}</p><p className="text-gray-500">{zh ? '页面不存在。' : 'Page does not exist.'}</p></div>
      <div className="border border-green-100 bg-green-50/50 rounded p-3"><p className="font-medium text-green-700 mb-2">{zh ? '变更后' : 'After'}</p><p className="font-medium text-gray-800">{payload.title}</p><pre className="mt-2 whitespace-pre-wrap font-sans text-gray-600 max-h-48 overflow-auto">{payload.content || (zh ? '空页面' : 'Empty page')}</pre></div>
    </div>
  );
  if (item.type === 'create_relation') return (
    <div className="mt-3 grid md:grid-cols-2 gap-2 text-xs">
      <div className="border border-red-100 bg-red-50/50 rounded p-3"><p className="font-medium text-red-700 mb-2">{zh ? '变更前' : 'Before'}</p><p className="text-gray-500">{zh ? '关系不存在。' : 'Relationship does not exist.'}</p></div>
      <dl className="border border-green-100 bg-green-50/50 rounded p-3 space-y-1">
        <p className="font-medium text-green-700 mb-2">{zh ? '变更后' : 'After'}</p>
        <div><dt className="inline text-gray-500">{zh ? '从：' : 'From: '}</dt><dd className="inline">{payload.sourcePath || payload.sourcePageId}</dd></div>
        <div><dt className="inline text-gray-500">{zh ? '到：' : 'To: '}</dt><dd className="inline">{payload.targetPath || payload.targetPageId}</dd></div>
        <div><dt className="inline text-gray-500">{zh ? '关系：' : 'Relation: '}</dt><dd className="inline">{payload.relation}</dd></div>
        <div><dt className="inline text-gray-500">{zh ? '置信度：' : 'Confidence: '}</dt><dd className="inline">{Math.round((payload.confidence ?? 1) * 100)}%</dd></div>
      </dl>
    </div>
  );
  if (item.type === 'update_page') return (
    <div className="mt-3 grid md:grid-cols-2 gap-2 text-xs">
      <div className="border border-red-100 bg-red-50/50 rounded p-3"><p className="font-medium text-red-700 mb-2">{zh ? '变更前' : 'Before'}</p><p className="text-gray-500">{zh ? '审批前保持当前已发布内容不变。' : 'Current published values remain unchanged until approval.'}</p></div>
      <div className="border border-green-100 bg-green-50/50 rounded p-3"><p className="font-medium text-green-700 mb-2">{zh ? '建议字段' : 'Proposed fields'}</p><pre className="whitespace-pre-wrap font-sans text-gray-600 max-h-48 overflow-auto">{JSON.stringify(payload.changes, null, 2)}</pre></div>
    </div>
  );
  if (item.type === 'archive_page') return <p className="mt-3 text-xs border border-amber-100 bg-amber-50 rounded p-3">{zh ? '归档已发布页面：' : 'Archive the published page for '}<strong>{payload.sourcePath || payload.pageId}</strong>.</p>;
  if (item.type === 'archive_relation') return <p className="mt-3 text-xs border border-amber-100 bg-amber-50 rounded p-3">{zh ? '移除来源中已不存在的自动编译关系。' : 'Remove an automatically compiled relationship that is no longer present in the source.'}</p>;
  return <pre className="mt-3 text-xs bg-gray-50 rounded p-3 overflow-auto">{JSON.stringify(payload, null, 2)}</pre>;
};

const EvidencePanel: React.FC<{ changeSet: any; item: any }> = ({ changeSet, item }) => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const payload = item.payload || {};
  const sourcePath = payload.sourcePath;
  const evidences = changeSet.run?.evidences || [];
  const evidence = evidences.find((candidate: any) => candidate.id === payload.evidenceId) ||
    evidences.find((candidate: any) => candidate.location?.sourcePath === sourcePath);
  const source = changeSet.run?.source;
  if (!source && !evidence) return <p className="mt-3 text-xs text-gray-400">{zh ? '人工提案，没有提取的来源证据。' : 'Manual proposal; no extracted source evidence.'}</p>;
  const metadata = evidence?.sourceVersion?.metadata || {};
  return (
    <div className="mt-3 rounded-lg border bg-blue-50/40 p-3 text-xs text-gray-600">
      <p><span className="font-medium text-gray-700">{zh ? '来源：' : 'Source:'}</span> {source?.name} · {source?.type}{sourcePath ? ` · ${sourcePath}` : ''}</p>
      {source?.uri ? <p className="mt-1 break-all text-gray-500">{source.uri}</p> : null}
      {evidence?.quote ? <blockquote className="mt-2 border-l-2 border-blue-300 pl-3 whitespace-pre-wrap">{evidence.quote}</blockquote> : null}
      <p className="mt-2 text-gray-400">
        {evidence ? `${zh ? '置信度' : 'Confidence'} ${Math.round((evidence.confidence ?? 1) * 100)}% · ${zh ? '来源版本' : 'source version'} ${evidence.sourceVersion?.version ?? (zh ? '未知' : 'unknown')}` : (zh ? '没有匹配片段' : 'No matching excerpt')}
        {metadata.commit ? ` · commit ${metadata.commit}` : ''}
      </p>
      {evidence?.location ? <p className="mt-1 text-gray-400 break-all">{zh ? '位置' : 'Location'}: {JSON.stringify(evidence.location)}</p> : null}
    </div>
  );
};

export const ReviewPage: React.FC = () => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const [items, setItems] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [mutatingIds, setMutatingIds] = useState<Set<string>>(() => new Set());
  const mountedRef = useRef(true);
  const zhRef = useRef(zh);
  const listSequenceRef = useRef(0);
  const detailSequenceRef = useRef(new Map<string, number>());
  const detailedIdsRef = useRef(new Set<string>());
  const mutatingIdsRef = useRef(new Set<string>());
  const requestControllersRef = useRef(new Set<AbortController>());
  const [searchParams] = useSearchParams();
  const spaceId = searchParams.get('spaceId');
  const changeSetId = searchParams.get('changeSet');

  useEffect(() => {
    zhRef.current = zh;
  }, [zh]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestControllersRef.current.forEach((controller) => controller.abort());
      requestControllersRef.current.clear();
    };
  }, []);

  const load = useCallback(async () => {
    const sequence = ++listSequenceRef.current;
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    try {
      setError(null);
      const summaries = (await api.get('/review', {
        params: spaceId ? { spaceId } : undefined,
        signal: controller.signal,
      })).data;
      if (!mountedRef.current || controller.signal.aborted || sequence !== listSequenceRef.current) return;
      setItems((current) => summaries.map((summary: any) => {
        const detail = detailedIdsRef.current.has(summary.id)
          ? current.find((item) => item.id === summary.id)
          : null;
        return detail || summary;
      }));
    } catch (requestError: any) {
      if (!controller.signal.aborted && mountedRef.current && sequence === listSequenceRef.current) {
        setError(requestError.response?.data?.message || (zhRef.current ? '审核队列加载失败' : 'Failed to load review queue'));
      }
    } finally {
      requestControllersRef.current.delete(controller);
    }
  }, [spaceId]);
  const expandChangeSet = useCallback(async (id: string) => {
    const sequence = (detailSequenceRef.current.get(id) || 0) + 1;
    detailSequenceRef.current.set(id, sequence);
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    try {
      setError(null);
      const detail = (await api.get(`/change-sets/${id}`, { signal: controller.signal })).data;
      if (!mountedRef.current || controller.signal.aborted || detailSequenceRef.current.get(id) !== sequence) return false;
      detailedIdsRef.current.add(id);
      setItems((current) => current.some((item) => item.id === id)
        ? current.map((item) => item.id === id ? detail : item)
        : [detail, ...current]);
      return true;
    } catch (requestError: any) {
      if (!controller.signal.aborted && mountedRef.current && detailSequenceRef.current.get(id) === sequence) {
        setError(requestError.response?.data?.message || (zhRef.current ? '变更集证据加载失败' : 'Failed to load change set evidence'));
      }
      return false;
    } finally {
      requestControllersRef.current.delete(controller);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (changeSetId) {
      setExpanded(changeSetId);
      void expandChangeSet(changeSetId);
    }
  }, [changeSetId, expandChangeSet]);
  const visibleItems = useMemo(() => changeSetId ? items.filter((item) => item.id === changeSetId) : items, [items, changeSetId]);

  const beginMutation = (id: string) => {
    if (mutatingIdsRef.current.has(id)) return false;
    mutatingIdsRef.current.add(id);
    setMutatingIds(new Set(mutatingIdsRef.current));
    return true;
  };

  const finishMutation = (id: string) => {
    mutatingIdsRef.current.delete(id);
    if (mountedRef.current) setMutatingIds(new Set(mutatingIdsRef.current));
  };

  const action = async (id: string, name: string) => {
    if (!beginMutation(id)) return;
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    try {
      setError(null);
      await api.post(
        `/change-sets/${id}/${name}`,
        { comment: comments[id] || undefined },
        { signal: controller.signal },
      );
      if (!mountedRef.current || controller.signal.aborted) return;
      await expandChangeSet(id);
    } catch (requestError: any) {
      if (!controller.signal.aborted && mountedRef.current) {
        setError(requestError.response?.data?.message || (zhRef.current ? '变更集操作失败' : `Failed to ${name} change set`));
      }
    } finally {
      requestControllersRef.current.delete(controller);
      finishMutation(id);
    }
  };
  const decide = async (setId: string, itemId: string, status: 'accepted' | 'rejected') => {
    if (!beginMutation(setId)) return;
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    try {
      setError(null);
      await api.patch(`/change-sets/${setId}/items/${itemId}`, { status }, { signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted) return;
      await expandChangeSet(setId);
    } catch (requestError: any) {
      if (!controller.signal.aborted && mountedRef.current) {
        setError(requestError.response?.data?.message || (zhRef.current ? '候选变更处理失败' : 'Failed to decide candidate change'));
      }
    } finally {
      requestControllersRef.current.delete(controller);
      finishMutation(setId);
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6"><h1 className="text-2xl font-semibold">{zh ? '审核' : 'Review'}</h1><p className="text-sm text-gray-500 mt-1">{zh ? '在可追溯的候选变更成为已发布知识前进行审批。' : 'Approve traceable candidate changes before they become published knowledge.'}</p></div>
      {error ? <div className="p-3 bg-red-50 text-red-700 rounded-lg mb-4">{error}</div> : null}
      <div className="border rounded-[14px] bg-white divide-y">
        {visibleItems.map((changeSet) => (
          <div key={changeSet.id}>
            <button onClick={() => {
              if (expanded === changeSet.id) setExpanded(null);
              else {
                setExpanded(changeSet.id);
                void expandChangeSet(changeSet.id);
              }
            }} className="w-full p-4 flex items-center gap-3 text-left">
              {expanded === changeSet.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <div className="flex-1"><p className="font-medium">{changeSet.title}</p><p className="text-xs text-gray-400 mt-1">{changeSet.space.name} · {changeSet.run?.source?.type || 'manual'} · {changeSet.status}</p></div>
              <span className="text-xs bg-amber-50 text-amber-700 rounded-full px-2 py-1">{changeSet.items.length} {zh ? '项变更' : 'changes'}</span>
            </button>
            {expanded === changeSet.id ? (
              <div className="px-5 md:px-11 pb-5">
                <div className="border rounded-lg divide-y mb-4">
                  {changeSet.items.map((item: any) => (
                    <div key={item.id} className="p-3">
                      <div className="flex justify-between gap-3"><p className="text-sm font-medium">{item.type.replaceAll('_', ' ')}</p><span className="text-xs text-gray-400">{item.status}</span></div>
                      <CandidateDiff item={item} />
                      <EvidencePanel changeSet={changeSet} item={item} />
                      {item.status === 'pending' && changeSet.status === 'pending_review' ? <div className="flex gap-3 mt-3"><button disabled={mutatingIds.has(changeSet.id)} onClick={() => void decide(changeSet.id, item.id, 'accepted')} className="text-xs font-medium text-green-700 disabled:opacity-50">{zh ? '接受候选项' : 'Accept candidate'}</button><button disabled={mutatingIds.has(changeSet.id)} onClick={() => void decide(changeSet.id, item.id, 'rejected')} className="text-xs font-medium text-red-700 disabled:opacity-50">{zh ? '拒绝候选项' : 'Reject candidate'}</button></div> : null}
                    </div>
                  ))}
                </div>
                {changeSet.status === 'pending_review' ? <textarea value={comments[changeSet.id] || ''} onChange={(event) => setComments((current) => ({ ...current, [changeSet.id]: event.target.value }))} placeholder={zh ? '审核意见（可选）' : 'Review comment (optional)'} className="w-full border rounded-lg p-2 text-sm mb-3" rows={2} /> : null}
                <div className="flex gap-2 justify-end">
                  {changeSet.status === 'pending_review' ? <>
                    <button disabled={mutatingIds.has(changeSet.id)} onClick={() => void action(changeSet.id, 'reject')} className="h-8 px-3 border border-red-200 text-red-700 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"><X size={14} /> {zh ? '拒绝' : 'Reject'}</button>
                    <button disabled={mutatingIds.has(changeSet.id)} onClick={() => void action(changeSet.id, 'approve')} className="h-8 px-3 border rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"><Check size={14} /> {zh ? '仅批准' : 'Approve only'}</button>
                    <button disabled={mutatingIds.has(changeSet.id)} onClick={() => void action(changeSet.id, 'review-publish')} className="h-8 px-3 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"><Send size={14} /> {zh ? '通过并发布' : 'Approve & publish'}</button>
                  </> : null}
                  {changeSet.status === 'approved' ? <button disabled={mutatingIds.has(changeSet.id)} onClick={() => void action(changeSet.id, 'publish')} className="h-8 px-3 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"><Send size={14} /> {zh ? '发布' : 'Publish'}</button> : null}
                  {changeSet.status === 'published' ? <button disabled={mutatingIds.has(changeSet.id)} onClick={() => void action(changeSet.id, 'revert')} className="h-8 px-3 border rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"><RotateCcw size={14} /> {zh ? '回滚' : 'Revert'}</button> : null}
                </div>
              </div>
            ) : null}
          </div>
        ))}
        {!visibleItems.length ? <div className="py-16 text-center text-sm text-gray-500">{changeSetId ? (zh ? '此变更集不在你的审核范围内。' : 'This change set is not available in your review scope.') : (zh ? '目前没有待审核事项。' : 'Nothing needs review.')}</div> : null}
      </div>
    </div>
  );
};
