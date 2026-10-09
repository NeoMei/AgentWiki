import { runtimeLabel } from '../../i18n/runtime-label';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { FileUp, GitBranch, Globe, Play, Plus, Type } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { apiErrorMessage } from '../../api/error-message';
import { RunsPage } from './RunsPage';
import { IngestRunDetails } from './IngestRunDetails';
import { isActiveIngestRun, useBoundedPolling } from './useBoundedPolling';

export const LegacyRunsRoute: React.FC = () => {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('view', 'runs');
  if (runId) params.set('run', runId);
  return <Navigate replace to={`/spaces/${id}/sources?${params}`} />;
};

export const SourcesPage: React.FC = () => {
  const { t } = useLanguage();
  const [params, setParams] = useSearchParams();
  const runsActive = params.get('view') === 'runs';
  const selectView = (runs: boolean) => {
    const next = new URLSearchParams(params);
    if (runs) next.set('view', 'runs');
    else { next.delete('view'); next.delete('run'); }
    setParams(next);
  };
  return <div className="max-w-5xl mx-auto">
    <div role="tablist" aria-label={t('source.title')} className="mb-6 flex gap-1 border-b">
      {[false, true].map(runs => <button key={String(runs)} type="button" role="tab"
        id={runs ? 'sources-runs-tab' : 'sources-list-tab'}
        aria-controls="sources-view-panel" aria-selected={runsActive === runs} tabIndex={runsActive === runs ? 0 : -1}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const nextRuns = event.key === 'Home' ? false : event.key === 'End' ? true : !runs;
          selectView(nextRuns);
          document.getElementById(nextRuns ? 'sources-runs-tab' : 'sources-list-tab')?.focus();
        }}
        className={`h-10 border-b-2 px-3 text-sm ${runsActive === runs ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-gray-500'}`}
        onClick={() => selectView(runs)}>{t(runs ? 'space.runs' : 'space.sources')}</button>)}
    </div>
    <div role="tabpanel" id="sources-view-panel" aria-labelledby={runsActive ? 'sources-runs-tab' : 'sources-list-tab'}>
      {runsActive ? <RunsPage /> : <SourcesView />}
    </div>
  </div>;
};

const SourcesView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t } = useLanguage();
  const { user } = useAuth();
  const [writePermission, setWritePermission] = useState<{ spaceId: string; userId: string; allowed: boolean } | null>(null);
  const canWrite = writePermission?.spaceId === id && writePermission?.userId === user?.id && writePermission?.allowed === true;
  const [sources, setSources] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ type: 'text', name: '', uri: '', content: '' });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<any | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshSession, setRefreshSession] = useState(0);
  const selectedIdRef = useRef<string | null>(null);
  const detailSequenceRef = useRef(0);
  const runActionsRef = useRef(new Map<string, symbol>());
  const [submitting, setSubmitting] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<string>>(() => new Set());
  const loadSequenceRef = useRef(0);
  const activeSpaceIdRef = useRef(id);
  activeSpaceIdRef.current = id;
  const submittingRef = useRef<symbol | null>(null);
  const runningIdsRef = useRef(new Set<string>());

  const load = useCallback(async (requestedSpaceId = id) => {
    if (!requestedSpaceId || activeSpaceIdRef.current !== requestedSpaceId) return;
    const sequence = ++loadSequenceRef.current;
    setLoading(true);
    try {
      const [{ data }, { data: space }] = await Promise.all([
        api.get('/spaces/' + requestedSpaceId + '/sources', { timeout: 15000 }),
        api.get('/spaces/' + requestedSpaceId, { timeout: 15000 }),
      ]);
      if (sequence !== loadSequenceRef.current || activeSpaceIdRef.current !== requestedSpaceId) return;
      const role = space.members?.find((member: any) => member.userId === user?.id)?.role;
      setWritePermission({ spaceId: requestedSpaceId, userId: user?.id, allowed: ['owner', 'admin', 'editor'].includes(role) });
      setSources(data);
      setError(null);
    } catch (err: unknown) {
      if (sequence === loadSequenceRef.current && activeSpaceIdRef.current === requestedSpaceId) {
        setError(apiErrorMessage(err, t, 'source.loadFailed'));
      }
    } finally {
      if (sequence === loadSequenceRef.current && activeSpaceIdRef.current === requestedSpaceId) setLoading(false);
    }
  }, [id, t, user?.id]);
  useEffect(() => {
    activeSpaceIdRef.current = id;
    setSources([]);
    setWritePermission(null);
    setDetail(null);
    setSelectedId(null);
    selectedIdRef.current = null;
    detailSequenceRef.current += 1;
    setDetailLoading(false);
    setError(null);
    setShowCreate(false);
    setSubmitting(false);
    submittingRef.current = null;
    runningIdsRef.current.clear();
    runActionsRef.current.clear();
    setRunningIds(new Set());
    void load();
    return () => { loadSequenceRef.current += 1; detailSequenceRef.current += 1; activeSpaceIdRef.current = undefined; };
  }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!id || !canWrite || submittingRef.current) return;
    const actionSpaceId = id;
    const submission = Symbol('source-submission');
    submittingRef.current = submission;
    setSubmitting(true);
    setError(null);
    try {
      let created: any;
      if (form.type === 'file' && file) {
        const body = new FormData();
        body.append('file', file);
        body.append('name', form.name.trim());
        created = (await api.post('/spaces/' + id + '/sources/file', body, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
      } else {
        created = (await api.post('/spaces/' + id + '/sources', {
          type: form.type, name: form.name,
          uri: form.type === 'url' ? form.uri : undefined,
          content: form.type === 'text' ? form.content : undefined,
        })).data;
      }
      if (activeSpaceIdRef.current !== actionSpaceId || submittingRef.current !== submission) return;
      setShowCreate(false);
      setForm({ type: 'text', name: '', uri: '', content: '' });
      setFile(null);
      if (created?.id) setSources((current) => [{ ...created, _count: created._count || { versions: created.versions?.length, runs: created.runs?.length } }, ...current.filter((source) => source.id !== created.id)]);
      submittingRef.current = null;
      setSubmitting(false);
      await load(actionSpaceId);
    } catch (err: unknown) {
      if (activeSpaceIdRef.current === actionSpaceId) setError(apiErrorMessage(err, t, 'source.createFailed'));
    }
    finally {
      if (submittingRef.current === submission) {
        submittingRef.current = null;
        if (activeSpaceIdRef.current === actionSpaceId) setSubmitting(false);
      }
    }
  };

  const readDetail = useCallback(async (sourceId: string, requestedSpaceId = id) => {
    if (activeSpaceIdRef.current !== requestedSpaceId || selectedIdRef.current !== sourceId) return true;
    const sequence = ++detailSequenceRef.current;
    setDetailLoading(true);
    try {
      const { data } = await api.get('/sources/' + sourceId, { timeout: 15000 });
      if (sequence !== detailSequenceRef.current || activeSpaceIdRef.current !== requestedSpaceId || selectedIdRef.current !== sourceId) return true;
      setDetail(data);
      setSources((current) => current.map((source) => source.id === sourceId ? { ...source, _count: data._count || { versions: data.versions?.length || 0, runs: data.runs?.length || 0 } } : source));
      return !data.runs?.some(isActiveIngestRun);
    } catch (err: unknown) {
      if (sequence === detailSequenceRef.current && activeSpaceIdRef.current === requestedSpaceId) setError(apiErrorMessage(err, t, 'source.loadFailed'));
      return true;
    } finally {
      if (sequence === detailSequenceRef.current && activeSpaceIdRef.current === requestedSpaceId) setDetailLoading(false);
    }
  }, [id, t]);

  const selectSource = (sourceId: string) => {
    const next = selectedIdRef.current === sourceId ? null : sourceId;
    selectedIdRef.current = next;
    setSelectedId(next);
    setDetail(null);
    detailSequenceRef.current += 1;
    setDetailLoading(false);
    setError(null);
    if (next) void readDetail(next);
  };
  const activeRunKey = detail?.runs?.filter(isActiveIngestRun).map((run: any) => run.id).join(',') || '';
  const polling = useBoundedPolling(id + ':' + selectedId + ':' + activeRunKey + ':' + refreshSession, !!selectedId && !!activeRunKey, async () => readDetail(selectedId!));

  const runSource = async (sourceId: string) => {
    const actionSpaceId = id;
    if (!actionSpaceId || !canWrite || runningIdsRef.current.has(sourceId)) return;
    const token = Symbol('run');
    runActionsRef.current.set(sourceId, token);
    runningIdsRef.current.add(sourceId);
    setRunningIds(new Set(runningIdsRef.current));
    selectedIdRef.current = sourceId;
    setSelectedId(sourceId);
    setDetail((current: any) => current?.id === sourceId ? current : { ...sources.find((source) => source.id === sourceId), versions: [], runs: [] });
    detailSequenceRef.current += 1;
    setError(null);
    try {
      const { data: run } = await api.post('/sources/' + sourceId + '/runs');
      if (activeSpaceIdRef.current !== actionSpaceId || runActionsRef.current.get(sourceId) !== token) return;
      if (run?.id && selectedIdRef.current === sourceId) {
        setDetail((current: any) => ({ ...current, runs: [run, ...(current?.runs || []).filter((existing: any) => existing.id !== run.id)] }));
        void readDetail(sourceId, actionSpaceId);
      } else if (!run?.id) await load(actionSpaceId);
    } catch (err: unknown) {
      if (activeSpaceIdRef.current === actionSpaceId) setError(apiErrorMessage(err, t, 'source.runFailed'));
    } finally {
      if (runActionsRef.current.get(sourceId) === token) {
        runActionsRef.current.delete(sourceId);
        runningIdsRef.current.delete(sourceId);
        if (activeSpaceIdRef.current === actionSpaceId) setRunningIds(new Set(runningIdsRef.current));
      }
    }
  };

  const selectFile = (nextFile: File | null) => {
    setFile((previous) => {
      if (nextFile && (!form.name || form.name === previous?.name)) {
        setForm((current) => ({ ...current, name: nextFile.name }));
      }
      return nextFile;
    });
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div><Link to={'/spaces/' + id} className="text-sm text-gray-500">← {t('common.space')}</Link><h1 className="text-2xl font-semibold mt-3">{t('source.title')}</h1><p className="text-sm text-gray-500 mt-1">{t('source.description')}</p></div>
        {canWrite ? <button disabled={submitting} onClick={() => setShowCreate(!showCreate)} className="h-8 px-3 rounded-lg bg-blue-600 text-white text-sm flex items-center gap-2 disabled:opacity-50"><Plus size={15} /> {t('source.add')}</button> : null}
      </div>
      {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-3 mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm"><span>{error}</span><button type="button" onClick={() => void load()} className="rounded border border-red-300 bg-white px-3 py-1 hover:bg-red-100">{t('common.retry')}</button></div> : null}
      {canWrite && showCreate ? (
        <form onSubmit={create} className="border rounded-[14px] bg-white p-5 mb-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <div><label htmlFor="source-type" className="text-sm font-medium block mb-1">{t('common.type')}</label><select id="source-type" disabled={submitting} value={form.type} onChange={(e) => { setForm({ ...form, type: e.target.value }); if (e.target.value !== 'file') setFile(null); }} className="w-full h-8 border rounded-lg px-2 text-sm"><option value="text">{t('source.text')}</option><option value="file">{t('source.file')}</option><option value="url">{t('source.url')}</option></select></div>
            <div><label htmlFor="source-name" className="text-sm font-medium block mb-1">{t('common.name')}</label><input id="source-name" disabled={submitting} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full h-8 border rounded-lg px-3" required /></div>
          </div>
          {form.type === 'text' ? <textarea aria-label={t('source.pasteText')} disabled={submitting} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="w-full border rounded-lg p-3 mt-4" rows={7} placeholder={t('source.pasteText')} required /> : null}
          {form.type === 'url' ? <div className="mt-4"><input aria-label={t('source.uri')} disabled={submitting} value={form.uri} onChange={(e) => setForm({ ...form, uri: e.target.value })} className="w-full h-8 border rounded-lg px-3" placeholder="https://example.com/document" required /></div> : null}
          {form.type === 'file' ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-4">
              <label htmlFor="source-file" className="inline-flex h-8 cursor-pointer items-center rounded-lg border px-3 text-sm">{t('source.chooseFile')}</label>
              <input id="source-file" disabled={submitting} aria-label={t('source.chooseFile')} type="file" className="sr-only" onChange={(e) => selectFile(e.target.files?.[0] || null)} accept=".md,.txt,.ts,.tsx,.js,.jsx,.json,.py,.java,.go,.rs,.sql,.yaml,.yml" />
              {file ? <span className="break-all text-sm text-gray-600">{file.name}</span> : <span className="text-sm text-gray-400">{t('source.noFileSelected')}</span>}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 mt-4"><button type="button" disabled={submitting} onClick={() => setShowCreate(false)} className="h-8 px-3 border rounded-lg text-sm disabled:opacity-50">{t('common.cancel')}</button><button type="submit" disabled={submitting || (form.type === 'file' && !file)} className="h-8 px-3 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">{submitting ? t('source.saving') : form.type === 'file' ? t('source.uploadFile') : t('source.save')}</button></div>
        </form>
      ) : null}
      {submitting ? <p role="status" className="mb-4 text-sm text-gray-500">{t('source.saving')}</p> : runningIds.size ? <p role="status" className="mb-4 text-sm text-gray-500">{t('source.starting')}</p> : null}
      <div className="border rounded-[14px] bg-white divide-y">
        {sources.map((source) => {
          const Icon = source.type === 'git' ? GitBranch : source.type === 'url' ? Globe : source.type === 'file' ? FileUp : Type;
          return <div key={source.id}>
            <div className="p-4 flex items-center gap-4">
              <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center"><Icon size={18} /></div>
              <button aria-expanded={selectedId === source.id} onClick={() => selectSource(source.id)} className="flex-1 min-w-0 text-left"><p className="font-medium truncate">{source.name}</p><p className="text-xs text-gray-400 mt-1">{['text', 'file', 'url', 'git'].includes(source.type) ? t(`source.${source.type}`) : source.type} · {source._count?.versions ?? source.versions?.length ?? 0} {t('common.versions')} · {source._count?.runs ?? t('common.notAvailable')} {t('common.runs')}</p></button>
              {canWrite ? <button disabled={runningIds.has(source.id) || (detail?.id === source.id && !!activeRunKey)} onClick={() => void runSource(source.id)} className="h-8 px-3 border rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"><Play size={14} /> {runningIds.has(source.id) ? t('common.loading') : t('source.run')}</button> : null}
            </div>
            {selectedId === source.id ? <div className="mx-4 mb-4 bg-gray-50 border rounded-lg p-3 text-xs text-gray-600">
              {detailLoading ? <p role="status">{detail ? t('common.refetching') : t('common.loading')}</p> : null}
              {detail?.id === source.id ? <>
                <p><strong>{t('common.status')}:</strong> {runtimeLabel(detail.status, t)} {detail.uri ? <>· <strong>{t('source.uri')}:</strong> {detail.uri}</> : null}</p>
                <p className="mt-2"><strong>{t('common.versions')}:</strong> {(detail.versions || []).map((version: any) => `v${version.version} ${version.contentHash?.slice(0, 8) || ''}`).join(' · ') || t('common.none')}</p>
                <p className="mt-2 font-medium">{t('source.recentRuns')}</p>
                <div className="mt-2 space-y-3">{(detail.runs || []).map((run: any, index: number) => <div key={run.id || index} className="rounded-lg border bg-white p-3"><IngestRunDetails run={run} spaceId={id} /></div>)}{!detail.runs?.length ? t('common.none') : null}</div>
                {detail.runs?.[0]?.status === 'failed' ? <Link to={`/spaces/${id}/sources?view=runs&run=${encodeURIComponent(detail.runs[0].id)}`} className="mt-2 inline-flex min-h-8 items-center text-blue-700 underline">{t('source.failedRunDetails')}</Link> : null}
                {activeRunKey ? <p className="mt-2">{polling ? t('source.updating') : t('source.pollStopped')}</p> : null}
              </> : null}
              <button type="button" disabled={detailLoading} onClick={() => { setRefreshSession((value) => value + 1); void readDetail(source.id); }} className="mt-2 h-8 rounded-lg border px-3 disabled:opacity-50">{t('source.refresh')}</button>
            </div> : null}
          </div>;
        })}
        {loading ? <div className="py-14 text-center text-gray-400 text-sm">{t('common.loading')}</div> : null}
        {!sources.length && !loading ? <div className="py-14 text-center text-gray-500 text-sm">{t('source.empty')}</div> : null}
      </div>
    </div>
  );
};
