import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Ban, RefreshCw, RotateCcw } from 'lucide-react';
import api from '../../api/client';
import { SpaceNav } from '../../components/SpaceNav';
import { useLanguage } from '../../context/LanguageContext';
import { apiErrorMessage } from '../../api/error-message';

const CANCELLABLE = new Set(['queued', 'reserved', 'fetching', 'extracting', 'compiling', 'indexing']);
const RETRYABLE = new Set(['failed', 'partial', 'cancelled']);

export const RunsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t, language } = useLanguage();
  const [runs, setRuns] = useState<any[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!id) return;
    try {
      setRuns((await api.get('/spaces/' + id + '/runs')).data);
      setError('');
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError, t, 'run.loadFailed'));
    }
  }, [id, t]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [load]);

  const runAction = async (runId: string, action: 'retry' | 'cancel') => {
    try {
      setError('');
      await api.post(`/runs/${runId}/${action}`);
      await load();
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError, t, 'run.actionFailed'));
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <SpaceNav spaceId={id} />
      <Link to={'/spaces/' + id} className="text-sm text-gray-500">← {t('common.space')}</Link>
      <div className="flex items-center justify-between mt-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{t('run.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('run.description')}</p>
        </div>
        <button onClick={() => void load()} className="p-2 border rounded-lg" title={t('run.refresh')}><RefreshCw size={16} /></button>
      </div>
      {error ? <div role="alert" className="p-3 mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div> : null}
      <div className="border rounded-[14px] bg-white divide-y">
        {runs.map((run) => (
          <div key={run.id} className="p-4 flex items-center gap-4">
            <div className={'w-2 h-2 rounded-full ' + (run.status === 'completed' ? 'bg-green-500' : run.status === 'failed' ? 'bg-red-500' : 'bg-blue-500')} />
            <div className="flex-1">
              <p className="font-medium">{run.source.name}</p>
              <p className="text-xs text-gray-400 mt-1">{run.stage} · {t('run.attempt')} {run.attempts}/{run.maxAttempts} · {new Date(run.createdAt).toLocaleString(language)}</p>
              {run.error ? <p className="text-xs text-red-600 mt-1">{t('run.failedSummary')}</p> : null}
              {run.result?.sourceMetadata ? (
                <div className="mt-2 space-y-0.5 rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
                  <p className="break-all"><strong>{t('run.finalUrl')}:</strong> {run.result.sourceMetadata.finalUrl}</p>
                  <p><strong>{t('run.contentType')}:</strong> {run.result.sourceMetadata.contentType || t('common.notAvailable')}</p>
                  <p>{t('run.redirectCount', { count: run.result.sourceMetadata.redirectCount || 0 })}</p>
                </div>
              ) : null}
            </div>
            {run.changeSet ? <Link to={'/review?changeSet=' + run.changeSet.id} className="text-sm text-blue-600">{t('nav.review')}</Link> : null}
            {RETRYABLE.has(run.status) ? <button onClick={() => void runAction(run.id, 'retry')} className="p-2 border rounded-lg" title={t('run.retry')}><RotateCcw size={15} /></button> : null}
            {CANCELLABLE.has(run.status) ? <button onClick={() => void runAction(run.id, 'cancel')} className="p-2 border rounded-lg text-red-600" title={t('run.cancel')}><Ban size={15} /></button> : null}
          </div>
        ))}
        {!runs.length ? <div className="py-14 text-center text-sm text-gray-500">{t('run.empty')}</div> : null}
      </div>
    </div>
  );
};
