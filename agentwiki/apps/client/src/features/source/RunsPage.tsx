import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Ban, RefreshCw, RotateCcw } from 'lucide-react';
import api from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import { apiErrorMessage } from '../../api/error-message';
import { runtimeLabel } from '../../i18n/runtime-label';
import { IngestRunDetails } from './IngestRunDetails';
import { isActiveIngestRun, useBoundedPolling } from './useBoundedPolling';

const CANCELLABLE = new Set(['queued', 'reserved', 'fetching', 'extracting', 'compiling', 'indexing']);
const RETRYABLE = new Set(['failed', 'partial', 'cancelled']);

export const RunsPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { id } = useParams<{ id: string }>();
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const requestedRunId = searchParams.get('run');
  const [detail, setDetail] = useState<any>(null);
  const [refreshSession, setRefreshSession] = useState(0);
  const [runs, setRuns] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [busyRunIds, setBusyRunIds] = useState<Set<string>>(() => new Set());
  const loadSequenceRef = useRef(0);
  const activeSpaceIdRef = useRef(id);
  activeSpaceIdRef.current = id;
  const busyRunIdsRef = useRef(new Set<string>());
  const load = useCallback(async (requestedSpaceId = id) => {
    if (!requestedSpaceId || activeSpaceIdRef.current !== requestedSpaceId) return;
    const sequence = ++loadSequenceRef.current;
    setLoading(true);
    try {
      const { data } = await api.get('/spaces/' + requestedSpaceId + '/runs', { timeout: 15000 });
      if (sequence !== loadSequenceRef.current || activeSpaceIdRef.current !== requestedSpaceId) return;
      setRuns(data);
      setError('');
      return !data.some(isActiveIngestRun);
    } catch (requestError: unknown) {
      if (sequence === loadSequenceRef.current && activeSpaceIdRef.current === requestedSpaceId) {
        setError(apiErrorMessage(requestError, t, 'run.loadFailed'));
      }
      return true;
    } finally {
      if (sequence === loadSequenceRef.current && activeSpaceIdRef.current === requestedSpaceId) setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    setRuns([]);
    setLoading(true);
    setError('');
    busyRunIdsRef.current.clear();
    setBusyRunIds(new Set());
    void load();

    return () => {
      loadSequenceRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    setQuery('');
    setSourceFilter('');
    setStatusFilter('');
  }, [id]);

  const activeKey = runs.filter(isActiveIngestRun).map((run) => run.id).join(',');
  useBoundedPolling(id + ':' + activeKey + ':' + refreshSession, !!activeKey, async () => load());
  const sourceOptions = useMemo(() => [...new Map(runs.map((run) => [run.source?.id || run.source?.name || '', run.source?.name || t('common.notAvailable')])).entries()]
    .filter(([value]) => value), [runs, t]);
  const visibleRuns = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return runs.filter((run) => {
      const sourceKey = run.source?.id || run.source?.name || '';
      const haystack = [run.source?.name, run.status, run.stage, run.error, run.result?.failure?.code]
        .filter(Boolean).join(' ').toLocaleLowerCase();
      return (!normalized || haystack.includes(normalized))
        && (!sourceFilter || sourceKey === sourceFilter)
        && (!statusFilter || run.status === statusFilter);
    });
  }, [query, runs, sourceFilter, statusFilter]);
  useEffect(() => {
    if (!requestedRunId || !runs.some((run) => run.id === requestedRunId)) { setDetail(null); return; }
    const controller = new AbortController();
    void api.get(`/runs/${requestedRunId}`, { signal: controller.signal, timeout: 15000 }).then(({ data }) => {
      if (!controller.signal.aborted && activeSpaceIdRef.current === id && data.spaceId === id) setDetail(data);
    }).catch((err: unknown) => { if (!controller.signal.aborted) setError(apiErrorMessage(err, t, 'run.loadFailed')); });
    return () => controller.abort();
  }, [requestedRunId, runs, id, t]);

  const runAction = async (runId: string, action: 'retry' | 'cancel') => {
    const actionSpaceId = id;
    if (!actionSpaceId) return;
    if (busyRunIdsRef.current.has(runId)) return;
    busyRunIdsRef.current.add(runId);
    setBusyRunIds(new Set(busyRunIdsRef.current));
    try {
      setError('');
      await api.post(`/runs/${runId}/${action}`);
      await load(actionSpaceId);
    } catch (requestError: unknown) {
      if (activeSpaceIdRef.current === actionSpaceId) setError(apiErrorMessage(requestError, t, 'run.actionFailed'));
    } finally {
      busyRunIdsRef.current.delete(runId);
      if (activeSpaceIdRef.current === actionSpaceId) setBusyRunIds(new Set(busyRunIdsRef.current));
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      {!embedded ? <Link to={'/spaces/' + id} className="text-sm text-gray-500">← {t('common.space')}</Link> : null}
      <div className={`flex items-center justify-between mb-6${embedded ? '' : ' mt-3'}`}>
        <div>
          <h1 className="text-2xl font-semibold">{t('run.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('run.description')}</p>
        </div>
        <button onClick={() => { setRefreshSession((value) => value + 1); void load(); }} className="p-2 border rounded-lg" title={t('run.refresh')}><RefreshCw size={16} /></button>
      </div>
      {error ? <div role="alert" className="p-3 mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div> : null}
      <div className="mb-4 grid gap-2 rounded-[14px] border bg-white p-3 sm:grid-cols-[minmax(0,1fr)_12rem_12rem]">
        <input aria-label={t('run.search')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('run.searchPlaceholder')} className="h-9 rounded-lg border px-3 text-sm" />
        <select aria-label={t('run.filterSource')} value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="h-9 rounded-lg border px-3 text-sm">
          <option value="">{t('run.allSources')}</option>
          {sourceOptions.map(([value, label], index) => <option key={value} value={value}>{index + 1} · {label}</option>)}
        </select>
        <select aria-label={t('run.filterStatus')} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded-lg border px-3 text-sm">
          <option value="">{t('run.allStatuses')}</option>
          {[...new Set(runs.map((run) => run.status).filter(Boolean))].map((status) => <option key={status} value={status}>{runtimeLabel(status, t)}</option>)}
        </select>
        <p className="text-xs text-gray-500 sm:col-span-3">{t('run.resultCount', { count: visibleRuns.length })}</p>
      </div>
      <div className="border rounded-[14px] bg-white divide-y">
        {visibleRuns.map((run) => (
          <div key={run.id} className="p-4 flex items-center gap-4">
            <div className={'w-2 h-2 rounded-full ' + (run.status === 'completed' ? 'bg-green-500' : run.status === 'failed' ? 'bg-red-500' : 'bg-blue-500')} />
            <div className="flex-1">
              <p className="font-medium">{run.source.name}</p>
              <IngestRunDetails run={requestedRunId === run.id && detail?.id === run.id ? detail : run} spaceId={id} />
            </div>
            {RETRYABLE.has(run.status) ? <button disabled={busyRunIds.has(run.id)} onClick={() => void runAction(run.id, 'retry')} className="p-2 border rounded-lg disabled:opacity-50" title={t('run.retry')}><RotateCcw size={15} /></button> : null}
            {CANCELLABLE.has(run.status) ? <button disabled={busyRunIds.has(run.id)} onClick={() => void runAction(run.id, 'cancel')} className="p-2 border rounded-lg text-red-600 disabled:opacity-50" title={t('run.cancel')}><Ban size={15} /></button> : null}
          </div>
        ))}
        {loading && !runs.length ? <div className="py-14 text-center text-sm text-gray-400">{t('common.loading')}</div> : null}
        {!loading && !runs.length ? <div className="py-14 text-center text-sm text-gray-500">{t('run.empty')}</div> : null}
        {!loading && runs.length > 0 && !visibleRuns.length ? <div className="py-14 text-center text-sm text-gray-500">{t('run.noMatches')}</div> : null}
      </div>
    </div>
  );
};
