import { sourceStatusText } from '../../i18n/source-status-messages';
import { SourceStatusNotice } from '../page/SourceStatusNotice';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, RotateCcw, Send, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import { getContentTreeRevision } from '../../api/content-tree';
import { apiErrorMessage } from '../../api/error-message';
import { Toast } from '../../components/Toast';
import { ChangeSetStatusBadge } from './ChangeSetStatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { announceReviewChanged, REVIEW_CHANGED_EVENT } from './review-events';
import { useBoundedPolling } from '../source/useBoundedPolling';
import { MarkdownDiff } from '../../components/markdown-diff/MarkdownDiff';

const UpdatePageDiff: React.FC<{ item: any; spaceId: string }> = ({ item, spaceId }) => {
  const { language } = useLanguage(); const zh = language === 'zh-CN';
  const { user } = useAuth();
  const payload = item.payload || {}, changes = payload.changes || {};
  const key = JSON.stringify([user?.id, spaceId, payload.pageId, payload.expectedUpdatedAt]);
  const [loaded, setLoaded] = useState<{ key: string; page?: { content: string; title: string; updatedAt: string }; status: 'loading' | 'ready' | 'unavailable' }>({ key, status: 'loading' });
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoaded({ key, status: 'loading' });
    if (!user?.id || !spaceId || typeof payload.pageId !== 'string') { setLoaded({ key, status: 'unavailable' }); return; }
    void api.get(`/pages/${encodeURIComponent(payload.pageId)}`, { signal: controller.signal, timeout: 15000 }).then(({ data }) => {
      if (!active || controller.signal.aborted) return;
      if (data?.id !== payload.pageId || data?.spaceId !== spaceId || typeof data?.content !== 'string') setLoaded({ key, status: 'unavailable' });
      else setLoaded({ key, status: 'ready', page: data });
    }).catch(() => { if (active && !controller.signal.aborted) setLoaded({ key, status: 'unavailable' }); });
    return () => { active = false; controller.abort(); };
  }, [key, item, user?.id, spaceId, payload.pageId]);
  const current = loaded.key === key ? loaded : { status: 'loading' as const, page: undefined };
  const page = current.page;
  const matches = !!page && typeof payload.expectedUpdatedAt === 'string' && page.updatedAt === payload.expectedUpdatedAt;
  const candidate = typeof changes.content === 'string' ? changes.content : page?.content;
  const download = (text: string, name: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
  };
  const metadata = Object.fromEntries(Object.entries(changes).filter(([field]) => field !== 'content'));
  return <section className="mt-3 space-y-2 text-sm" aria-label={zh ? '页面更新差异' : 'Page update diff'}>
    {current.status === 'loading' ? <p role="status" className="text-gray-500">{zh ? '正在读取当前文档…' : 'Loading current document…'}</p> : null}
    {page ? <>
      <p className="font-medium">{matches ? (zh ? '当前文档（与提案基准版本一致）' : 'Current document (matches proposal base version)') : (zh ? '当前文档与候选比较' : 'Current document vs candidate')}</p>
      {!matches ? <p className="text-amber-800">{zh ? '提案基准版本缺失或已过期；当前文档不是历史快照，审批仍受服务端版本检查保护。' : 'Proposal base version is unavailable or stale. Current content is not a historical snapshot; server version checks still govern approval.'}</p> : null}
      {typeof changes.content === 'string' ? <MarkdownDiff before={page.content} after={changes.content} /> : <p className="text-gray-500">{zh ? '正文未提出修改。' : 'No content change proposed.'}</p>}
      <button type="button" onClick={() => download(page.content, 'review-current.md')} className="rounded-lg border px-3 py-1">{zh ? '下载当前原文' : 'Download current document'}</button>
    </> : null}
    {current.status === 'unavailable' ? <><p className="text-amber-800">{zh ? '无法读取当前文档，仅显示候选。' : 'Current document is unavailable; showing candidate only.'}</p>{typeof changes.content === 'string' ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border p-3">{changes.content.slice(0, 100_000)}</pre> : null}</> : null}
    {typeof candidate === 'string' ? <button type="button" onClick={() => download(candidate, 'review-candidate.md')} className="ml-2 rounded-lg border px-3 py-1">{zh ? '下载候选' : 'Download candidate'}</button> : null}
    {Object.keys(metadata).length ? <div><p className="font-medium">{zh ? '其他建议字段' : 'Other proposed fields'}</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap text-gray-600">{JSON.stringify(metadata, null, 2)}</pre></div> : null}
  </section>;
};

const CandidateDiff: React.FC<{ item: any; spaceId: string }> = ({ item, spaceId }) => {
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
  if (item.type === 'update_page') return <UpdatePageDiff item={item} spaceId={spaceId} />;
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
  if (!source && !evidence) return <p className="mt-3 text-xs text-gray-400">{sourceStatusText(language, 'sourceStatus.noAccessibleEvidence')}</p>;
  const metadata = evidence?.sourceVersion?.metadata || {};
  return (
    <div className="mt-3 rounded-lg border bg-blue-50/40 p-3 text-xs text-gray-600">
      <p><span className="font-medium text-gray-700">{zh ? '来源：' : 'Source:'}</span> {source?.name} · {source?.type}{sourcePath ? ` · ${sourcePath}` : ''}</p>
      {source?.uri ? <p className="mt-1 break-all text-gray-500">{source.uri}</p> : null}
      {evidence?.evidenceState ? <p>{sourceStatusText(language, `sourceStatus.evidence.${evidence.evidenceState}`)}</p> : null}
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
  const { language, t } = useLanguage();
  const zh = language === 'zh-CN';
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<Record<string, { userId: string; canDecide: boolean }>>({});
  const canDecide = (id: string) => permissions[id]?.userId === user?.id && permissions[id]?.canDecide === true;
  const [items, setItems] = useState<any[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [refreshSession, setRefreshSession] = useState(0);
  const listPendingRef = useRef(false);
  const expandedRef = useRef<string | null>(null);
  const scopeRef = useRef('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [mutatingIds, setMutatingIds] = useState<Set<string>>(() => new Set());
  const mountedRef = useRef(true);
  const listSequenceRef = useRef(0);
  const detailSequenceRef = useRef(new Map<string, number>());
  const detailedIdsRef = useRef(new Set<string>());
  const mutatingIdsRef = useRef(new Set<string>());
  const requestControllersRef = useRef(new Set<AbortController>());
  const [searchParams] = useSearchParams();
  const spaceId = searchParams.get('spaceId');
  const changeSetId = searchParams.get('changeSet');
  const scope = `${user?.id || ''}:${spaceId || ''}:${changeSetId || ''}`;
  scopeRef.current = scope;
  expandedRef.current = expanded;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestControllersRef.current.forEach((controller) => controller.abort());
      requestControllersRef.current.clear();
    };
  }, []);

  const load = useCallback(async (options?: { background?: boolean }) => {
    const requestedScope = scopeRef.current;
    const sequence = ++listSequenceRef.current;
    listPendingRef.current = true;
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    if (options?.background) setListRefreshing(true); else setListLoading(true);
    try {
      setError(null);
      if (!options?.background) setSuccess(null);
      const summaries = (await api.get('/review', {
        params: spaceId ? { spaceId } : undefined,
        signal: controller.signal, timeout: 15000,
      })).data;
      if (!mountedRef.current || controller.signal.aborted || sequence !== listSequenceRef.current || requestedScope !== scopeRef.current) return;
      setItems((current) => summaries.map((summary: any) => {
        const detail = detailedIdsRef.current.has(summary.id) ? current.find((item) => item.id === summary.id) : null;
        return detail ? (options?.background ? { ...detail, status: summary.status, items: summary.items } : detail) : summary;
      }));
    } catch (requestError: any) {
      if (!controller.signal.aborted && mountedRef.current && sequence === listSequenceRef.current && requestedScope === scopeRef.current) {
        setError(apiErrorMessage(requestError, t, 'review.loadFailed'));
      }
    } finally {
      requestControllersRef.current.delete(controller);
      if (mountedRef.current && sequence === listSequenceRef.current && requestedScope === scopeRef.current) {
        listPendingRef.current = false;
        setListRefreshing(false); setListLoading(false);
      }
    }
  }, [spaceId, t]);
  const expandChangeSet = useCallback(async (id: string, background = false) => {
    const requestedScope = scopeRef.current;
    const sequence = (detailSequenceRef.current.get(id) || 0) + 1;
    detailSequenceRef.current.set(id, sequence);
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    try {
      setError(null);
      if (!background) setSuccess(null);
      const detail = (await api.get(`/change-sets/${id}`, { signal: controller.signal, timeout: 15000 })).data;
      const targetSpaceId = detail.spaceId || detail.space?.id;
      const space = targetSpaceId ? (await api.get(`/spaces/${targetSpaceId}`, { signal: controller.signal })).data : null;
      const role = space?.members?.find((member: any) => member.userId === user?.id)?.role;
      if (!mountedRef.current || controller.signal.aborted || detailSequenceRef.current.get(id) !== sequence || requestedScope !== scopeRef.current) return false;
      setPermissions((current) => ({ ...current, [id]: { userId: user?.id, canDecide: role === 'owner' } }));
      detailedIdsRef.current.add(id);
      setItems((current) => current.some((item) => item.id === id)
        ? current.map((item) => item.id === id ? detail : item)
        : [detail, ...current]);
      return true;
    } catch (requestError: any) {
      if (!controller.signal.aborted && mountedRef.current && detailSequenceRef.current.get(id) === sequence && requestedScope === scopeRef.current) {
        setError(apiErrorMessage(requestError, t, 'review.detailFailed'));
      }
      return false;
    } finally {
      requestControllersRef.current.delete(controller);
    }
  }, [t, user?.id]);
  useEffect(() => {
    requestControllersRef.current.forEach((controller) => controller.abort());
    detailSequenceRef.current.clear(); detailedIdsRef.current.clear();
    setItems([]); setPermissions({}); setExpanded(null);
    void load();
  }, [load, user?.id, changeSetId]);
  const refreshInFlightRef = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current || listPendingRef.current || mutatingIdsRef.current.size) return;
    refreshInFlightRef.current = true;
    const requestedScope = scopeRef.current;
    try {
      await load({ background: true });
      if (requestedScope === scopeRef.current && expandedRef.current) {
        setListRefreshing(true);
        await expandChangeSet(expandedRef.current, true);
      }
    } finally {
      refreshInFlightRef.current = false;
      if (mountedRef.current && requestedScope === scopeRef.current) setListRefreshing(false);
    }
  }, [load, expandChangeSet]);
  useBoundedPolling(scope + ':' + refreshSession, true, refresh, 15000, 20);
  useEffect(() => {
    const changed = () => { void refresh(); };
    const focused = () => { setRefreshSession((value) => value + 1); void refresh(); };
    window.addEventListener(REVIEW_CHANGED_EVENT, changed);
    window.addEventListener('focus', focused);
    return () => { window.removeEventListener(REVIEW_CHANGED_EVENT, changed); window.removeEventListener('focus', focused); };
  }, [refresh]);
  useEffect(() => {
    if (changeSetId) {
      setExpanded(changeSetId);
      void expandChangeSet(changeSetId);
    }
  }, [changeSetId, expandChangeSet]);
  const visibleItems = useMemo(() => {
    const base = changeSetId ? items.filter((item) => item.id === changeSetId) : items;
    return statusFilter === 'all' ? base : base.filter((item) => item.status === statusFilter);
  }, [items, changeSetId, statusFilter]);

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
    if (!canDecide(id) || !beginMutation(id)) return;
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    try {
      setError(null);
      setSuccess(null);
      const body: { comment?: string; expectedTreeRevision?: string } = { comment: comments[id] || undefined };
      if (name === 'revert') {
        const changeSet = items.find((item) => item.id === id);
        const targetSpaceId = changeSet?.spaceId || changeSet?.space?.id;
        if (!targetSpaceId || changeSet.revertible === false) throw new Error('Revert unavailable');
        body.expectedTreeRevision = await getContentTreeRevision(targetSpaceId, controller.signal);
        if (!mountedRef.current || controller.signal.aborted) return;
      }
      await api.post(
        `/change-sets/${id}/${name}`,
        body,
        { signal: controller.signal },
      );
      if (!mountedRef.current || controller.signal.aborted) return;
      await Promise.all([expandChangeSet(id), load()]);
      if (!mountedRef.current || controller.signal.aborted) return;
      announceReviewChanged();
      setSuccess(t('review.actionSuccess'));
    } catch (requestError: any) {
      if (!controller.signal.aborted && mountedRef.current) {
        const message = apiErrorMessage(requestError, t, 'review.actionFailed');
        const status = requestError.response?.status;
        const code = requestError.response?.data?.code;
        if (status === 409 || code === 'CHANGESET_INVALID_STATE' || code === 'CHANGESET_CONFLICT' || code === 'SOURCE_VERSION_CONFLICT') {
          await Promise.all([expandChangeSet(id), load()]);
          announceReviewChanged();
        }
        if (mountedRef.current) setError(message);
      }
    } finally {
      requestControllersRef.current.delete(controller);
      finishMutation(id);
    }
  };
  const decide = async (setId: string, itemId: string, status: 'accepted' | 'rejected') => {
    if (!canDecide(setId) || !beginMutation(setId)) return;
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    try {
      setError(null);
      setSuccess(null);
      await api.patch(`/change-sets/${setId}/items/${itemId}`, { status }, { signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted) return;
      await Promise.all([expandChangeSet(setId), load()]);
      if (!mountedRef.current || controller.signal.aborted) return;
      announceReviewChanged();
      setSuccess(t('review.decisionSuccess'));
    } catch (requestError: any) {
      if (!controller.signal.aborted && mountedRef.current) {
        const message = apiErrorMessage(requestError, t, 'review.decisionFailed');
        const status = requestError.response?.status;
        const code = requestError.response?.data?.code;
        if (status === 409 || code === 'CHANGESET_INVALID_STATE' || code === 'CHANGESET_CONFLICT' || code === 'SOURCE_VERSION_CONFLICT') {
          await Promise.all([expandChangeSet(setId), load()]);
          announceReviewChanged();
        }
        if (mountedRef.current) setError(message);
      }
    } finally {
      requestControllersRef.current.delete(controller);
      finishMutation(setId);
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      {error
        ? <Toast kind="error" message={error} onClose={() => setError(null)} />
        : success
          ? <Toast kind="success" message={success} onClose={() => setSuccess(null)} />
          : null}
      <div className="mb-6"><h1 className="text-2xl font-semibold">{zh ? '审核' : 'Review'}</h1><p className="text-sm text-gray-500 mt-1">{zh ? '在可追溯的候选变更成为已发布知识前进行审批。' : 'Approve traceable candidate changes before they become published knowledge.'}</p></div>
      <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label={zh ? '按状态筛选' : 'Filter by status'}>
        {[
          ['all', zh ? '全部' : 'All'],
          ['pending_review', zh ? '待审核' : 'Pending'],
          ['approved', zh ? '已批准' : 'Approved'],
          ['published', zh ? '已发布' : 'Published'],
          ['rejected', zh ? '已拒绝' : 'Rejected'],
          ['reverted', zh ? '已回滚' : 'Reverted'],
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setStatusFilter(value)}
            aria-pressed={statusFilter === value}
            className={`h-7 px-3 rounded-full text-xs border transition ${statusFilter === value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-300'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {listLoading || listRefreshing ? <p role="status" className="mb-3 text-sm text-gray-500">{listLoading ? t('common.loading') : t('common.refetching')}</p> : null}
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
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2"><p className="font-medium truncate">{changeSet.title}</p><ChangeSetStatusBadge status={changeSet.status} /></div>
                <p className="text-xs text-gray-400 mt-1">{changeSet.space.name} · {changeSet.run?.source?.type || 'manual'}</p>
              </div>
              <span className="text-xs bg-amber-50 text-amber-700 rounded-full px-2 py-1 shrink-0">{changeSet.items.length} {zh ? '项变更' : 'changes'}</span>
            </button>
            {expanded === changeSet.id ? (
              <div className="px-5 md:px-11 pb-5">
                {changeSet.collaborationArtifactLink ? <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                  <p>{t('review.collaborationOwned')}</p>
                  <Link to={changeSet.collaborationArtifactLink.reviewPath} className="mt-2 inline-flex min-h-10 items-center font-medium text-blue-700 underline">{t('review.goToCollaboration')}</Link>
                </div> : null}
                {hasDuplicateCandidateContent(changeSet.items) ? <p role="note" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('review.duplicateAdvisory')}</p> : null}
                <div className="border rounded-lg divide-y mb-4">
                  {changeSet.items.map((item: any) => (
                    <div key={item.id} className="p-3">
                      <div className="flex justify-between gap-3"><p className="text-sm font-medium">{item.type.replaceAll('_', ' ')}</p><span className="text-xs text-gray-400">{item.status}</span></div>
                      <SourceStatusNotice status={item.sourceStatus || changeSet.sourceStatus} candidate details />
                      <CandidateDiff item={item} spaceId={changeSet.spaceId || changeSet.space?.id} />
                      <ExistingContentWarning pages={changeSet.duplicateContentWarnings?.find((warning: { itemId: string }) => warning.itemId === item.id)?.pages} />
                      <EvidencePanel changeSet={changeSet} item={item} />
                      {canDecide(changeSet.id) && !changeSet.collaborationArtifactLink && item.status === 'pending' && changeSet.status === 'pending_review' ? <div className="flex gap-3 mt-3"><button disabled={mutatingIds.has(changeSet.id)} onClick={() => void decide(changeSet.id, item.id, 'accepted')} className="text-xs font-medium text-green-700 disabled:opacity-50">{zh ? '接受候选项' : 'Accept candidate'}</button><button disabled={mutatingIds.has(changeSet.id)} onClick={() => void decide(changeSet.id, item.id, 'rejected')} className="text-xs font-medium text-red-700 disabled:opacity-50">{zh ? '拒绝候选项' : 'Reject candidate'}</button></div> : null}
                    </div>
                  ))}
                </div>
                {canDecide(changeSet.id) && !changeSet.collaborationArtifactLink && changeSet.status === 'pending_review' ? <textarea value={comments[changeSet.id] || ''} onChange={(event) => setComments((current) => ({ ...current, [changeSet.id]: event.target.value }))} placeholder={zh ? '审核意见（可选）' : 'Review comment (optional)'} className="w-full border rounded-lg p-2 text-sm mb-3" rows={2} /> : null}
                {canDecide(changeSet.id) && !changeSet.collaborationArtifactLink && changeSet.status === 'pending_review' && changeSet.items.some((item: any) => item.status === 'pending') ? <p className="mb-2 text-right text-xs text-amber-700">{t('review.decideBeforeApprove')}</p> : null}
                <div className="flex gap-2 justify-end">
                  {canDecide(changeSet.id) && !changeSet.collaborationArtifactLink && changeSet.status === 'pending_review' ? <>
                    <button disabled={mutatingIds.has(changeSet.id)} onClick={() => void action(changeSet.id, 'reject')} className="h-8 px-3 border border-red-200 text-red-700 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"><X size={14} /> {zh ? '拒绝' : 'Reject'}</button>
                    <button disabled={mutatingIds.has(changeSet.id) || changeSet.items.some((item: any) => item.status === 'pending')} onClick={() => void action(changeSet.id, 'approve')} className="h-8 px-3 border rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"><Check size={14} /> {zh ? '仅批准' : 'Approve only'}</button>
                    <button disabled={mutatingIds.has(changeSet.id)} onClick={() => void action(changeSet.id, 'review-publish')} className="h-8 px-3 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"><Send size={14} /> {zh ? '通过并发布' : 'Approve & publish'}</button>
                  </> : null}
                  {canDecide(changeSet.id) && !changeSet.collaborationArtifactLink && changeSet.status === 'approved' ? <button disabled={mutatingIds.has(changeSet.id)} onClick={() => void action(changeSet.id, 'publish')} className="h-8 px-3 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"><Send size={14} /> {zh ? '发布' : 'Publish'}</button> : null}
                  {canDecide(changeSet.id) && changeSet.status === 'published' && changeSet.revertible !== false ? <button disabled={mutatingIds.has(changeSet.id)} onClick={() => void action(changeSet.id, 'revert')} className="h-8 px-3 border rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"><RotateCcw size={14} /> {zh ? '回滚' : 'Revert'}</button> : null}
                </div>
              </div>
            ) : null}
          </div>
        ))}
        {!listLoading && !listRefreshing && !visibleItems.length ? <div className="py-16 text-center text-sm text-gray-500">{changeSetId ? (zh ? '此变更集不在你的审核范围内。' : 'This change set is not available in your review scope.') : statusFilter !== 'all' ? (zh ? '该状态下没有变更集。' : 'No change sets with this status.') : (zh ? '目前没有待审核事项。' : 'Nothing needs review.')}</div> : null}
      </div>
    </div>
  );
};

function hasDuplicateCandidateContent(items: any[]): boolean {
  const seen = new Set<string>();
  for (const item of items) {
    const content = item.type === 'create_page' ? item.payload?.content : item.type === 'update_page' ? item.payload?.changes?.content : undefined;
    if (typeof content !== 'string' || !content.trim() || item.status === 'rejected') continue;
    if (seen.has(content)) return true;
    seen.add(content);
  }
  return false;
}

const ExistingContentWarning: React.FC<{ pages?: Array<{ id: string; title: string }> }> = ({ pages }) => {
  const { t } = useLanguage();
  if (!pages?.length) return null;
  return <aside role="note" aria-label={t('review.existingDuplicates')} className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
    <p className="font-medium">{t('review.existingDuplicates')}</p>
    <p className="mt-1">{t('review.existingDuplicatesHelp')}</p>
    <ul className="mt-2 list-disc pl-5">
      {pages.map((page) => <li key={page.id}><Link to={`/pages/${encodeURIComponent(page.id)}`} className="inline-flex min-h-8 items-center text-blue-700 underline">{page.title.trim() || t('page.untitled')}</Link></li>)}
    </ul>
  </aside>;
};
