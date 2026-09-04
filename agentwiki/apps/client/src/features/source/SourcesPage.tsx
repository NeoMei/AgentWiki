import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FileUp, GitBranch, Globe, Play, Plus, Type } from 'lucide-react';
import api from '../../api/client';
import { SpaceNav } from '../../components/SpaceNav';
import { useLanguage } from '../../context/LanguageContext';
import { apiErrorMessage } from '../../api/error-message';

export const SourcesPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t, language } = useLanguage();
  const [sources, setSources] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ type: 'text', name: '', uri: '', content: '' });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<any | null>(null);
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
      const { data } = await api.get('/spaces/' + requestedSpaceId + '/sources');
      if (sequence !== loadSequenceRef.current || activeSpaceIdRef.current !== requestedSpaceId) return;
      setSources(data);
      setError(null);
    } catch (err: unknown) {
      if (sequence === loadSequenceRef.current && activeSpaceIdRef.current === requestedSpaceId) {
        setError(apiErrorMessage(err, t, 'source.loadFailed'));
      }
    } finally {
      if (sequence === loadSequenceRef.current && activeSpaceIdRef.current === requestedSpaceId) setLoading(false);
    }
  }, [id, t]);
  useEffect(() => {
    setSources([]);
    setDetail(null);
    setError(null);
    setShowCreate(false);
    setSubmitting(false);
    submittingRef.current = null;
    runningIdsRef.current.clear();
    setRunningIds(new Set());
    void load();
    return () => { loadSequenceRef.current += 1; };
  }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!id || submittingRef.current) return;
    const actionSpaceId = id;
    const submission = Symbol('source-submission');
    submittingRef.current = submission;
    setSubmitting(true);
    setError(null);
    try {
      if (form.type === 'file' && file) {
        const body = new FormData();
        body.append('file', file);
        body.append('name', form.name.trim());
        await api.post('/spaces/' + id + '/sources/file', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        await api.post('/spaces/' + id + '/sources', {
          type: form.type, name: form.name,
          uri: ['url', 'git'].includes(form.type) ? form.uri : undefined,
          content: form.type === 'text' ? form.content : undefined,
        });
      }
      if (activeSpaceIdRef.current !== actionSpaceId) return;
      setShowCreate(false);
      setForm({ type: 'text', name: '', uri: '', content: '' });
      setFile(null);
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

  const runSource = async (sourceId: string) => {
    const actionSpaceId = id;
    if (!actionSpaceId) return;
    if (runningIdsRef.current.has(sourceId)) return;
    runningIdsRef.current.add(sourceId);
    setRunningIds(new Set(runningIdsRef.current));
    setError(null);
    try {
      await api.post('/sources/' + sourceId + '/runs');
      await load(actionSpaceId);
    } catch (err: unknown) {
      if (activeSpaceIdRef.current === actionSpaceId) setError(apiErrorMessage(err, t, 'source.runFailed'));
    } finally {
      runningIdsRef.current.delete(sourceId);
      if (activeSpaceIdRef.current === actionSpaceId) setRunningIds(new Set(runningIdsRef.current));
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
      <SpaceNav spaceId={id} />
      <div className="flex items-start justify-between mb-6">
        <div><Link to={'/spaces/' + id} className="text-sm text-gray-500">← {t('common.space')}</Link><h1 className="text-2xl font-semibold mt-3">{t('source.title')}</h1><p className="text-sm text-gray-500 mt-1">{t('source.description')}</p></div>
        <button disabled={submitting} onClick={() => setShowCreate(!showCreate)} className="h-8 px-3 rounded-lg bg-blue-600 text-white text-sm flex items-center gap-2 disabled:opacity-50"><Plus size={15} /> {t('source.add')}</button>
      </div>
      {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-3 mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm"><span>{error}</span><button type="button" onClick={() => void load()} className="rounded border border-red-300 bg-white px-3 py-1 hover:bg-red-100">{t('common.retry')}</button></div> : null}
      {showCreate ? (
        <form onSubmit={create} className="border rounded-[14px] bg-white p-5 mb-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <div><label htmlFor="source-type" className="text-sm font-medium block mb-1">{t('common.type')}</label><select id="source-type" disabled={submitting} value={form.type} onChange={(e) => { setForm({ ...form, type: e.target.value }); if (e.target.value !== 'file') setFile(null); }} className="w-full h-8 border rounded-lg px-2 text-sm"><option value="text">{t('source.text')}</option><option value="file">{t('source.file')}</option><option value="url">{t('source.url')}</option><option value="git">{t('source.git')}</option></select></div>
            <div><label htmlFor="source-name" className="text-sm font-medium block mb-1">{t('common.name')}</label><input id="source-name" disabled={submitting} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full h-8 border rounded-lg px-3" required /></div>
          </div>
          {form.type === 'text' ? <textarea aria-label={t('source.pasteText')} disabled={submitting} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="w-full border rounded-lg p-3 mt-4" rows={7} placeholder={t('source.pasteText')} required /> : null}
          {['url', 'git'].includes(form.type) ? <div className="mt-4"><input aria-label={t('source.uri')} disabled={submitting} value={form.uri} onChange={(e) => setForm({ ...form, uri: e.target.value })} className="w-full h-8 border rounded-lg px-3" placeholder={form.type === 'git' ? 'https://github.com/org/repo' : 'https://example.com/document'} required />{form.type === 'git' ? <p className="text-xs text-gray-500 mt-1">{t('source.gitHelp')}</p> : null}</div> : null}
          {form.type === 'file' ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-4">
              <label htmlFor="source-file" className="inline-flex h-8 cursor-pointer items-center rounded-lg border px-3 text-sm">{t('source.chooseFile')}</label>
              <input id="source-file" disabled={submitting} aria-label={t('source.chooseFile')} type="file" className="sr-only" onChange={(e) => selectFile(e.target.files?.[0] || null)} accept=".md,.txt,.ts,.tsx,.js,.jsx,.json,.py,.java,.go,.rs,.sql,.yaml,.yml" />
              {file ? <span className="break-all text-sm text-gray-600">{file.name}</span> : <span className="text-sm text-gray-400">{t('source.noFileSelected')}</span>}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 mt-4"><button type="button" disabled={submitting} onClick={() => setShowCreate(false)} className="h-8 px-3 border rounded-lg text-sm disabled:opacity-50">{t('common.cancel')}</button><button type="submit" disabled={submitting || (form.type === 'file' && !file)} className="h-8 px-3 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">{submitting ? t('common.loading') : form.type === 'file' ? t('source.uploadFile') : t('source.save')}</button></div>
        </form>
      ) : null}
      <div className="border rounded-[14px] bg-white divide-y">
        {sources.map((source) => {
          const Icon = source.type === 'git' ? GitBranch : source.type === 'url' ? Globe : source.type === 'file' ? FileUp : Type;
          return <div key={source.id}><div className="p-4 flex items-center gap-4"><div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center"><Icon size={18} /></div><button onClick={async () => { const requestedSpaceId = id; try { setError(null); const nextDetail = detail?.id === source.id ? null : (await api.get('/sources/' + source.id)).data; if (activeSpaceIdRef.current === requestedSpaceId) setDetail(nextDetail); } catch (e: unknown) { if (activeSpaceIdRef.current === requestedSpaceId) setError(apiErrorMessage(e, t, 'source.loadFailed')); } }} className="flex-1 min-w-0 text-left"><p className="font-medium truncate">{source.name}</p><p className="text-xs text-gray-400 mt-1">{source.type} · {source._count.versions} {t('common.versions')} · {source._count.runs} {t('common.runs')}</p></button><button disabled={runningIds.has(source.id)} onClick={() => void runSource(source.id)} className="h-8 px-3 border rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"><Play size={14} /> {runningIds.has(source.id) ? t('common.loading') : t('source.run')}</button></div>{detail?.id === source.id ? <div className="mx-4 mb-4 bg-gray-50 border rounded-lg p-3 text-xs text-gray-600"><p><strong>{t('common.status')}:</strong> {detail.status} {detail.uri ? <>· <strong>{t('source.uri')}:</strong> {detail.uri}</> : null}</p><p className="mt-2"><strong>{t('common.versions')}:</strong> {detail.versions.map((version: any) => `v${version.version} ${version.contentHash.slice(0, 8)}`).join(' · ') || t('common.none')}</p><p className="mt-2"><strong>{t('source.recentRuns')}:</strong> {detail.runs.map((run: any) => `${run.status} ${new Date(run.createdAt).toLocaleString(language)}`).join(' · ') || t('common.none')}</p></div> : null}</div>;
        })}
        {loading ? <div className="py-14 text-center text-gray-400 text-sm">{t('common.loading')}</div> : null}
        {!sources.length && !loading ? <div className="py-14 text-center text-gray-500 text-sm">{t('source.empty')}</div> : null}
      </div>
    </div>
  );
};
