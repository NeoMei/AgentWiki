import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { KeyRound, Pause, Play, Shield, Trash2 } from 'lucide-react';
import type { AgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import api from '../../api/client';
import { AgentMemoryPanel } from './AgentMemoryPanel';
import { LocalSyncInstallCard } from './LocalSyncInstallCard';
import { useLanguage } from '../../context/LanguageContext';

type Tab = 'overview' | 'access' | 'activity' | 'memory' | 'settings';

export const AgentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t, language } = useLanguage();
  const [agent, setAgent] = useState<any>(null);
  const [spaces, setSpaces] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [agentResponse, spacesResponse, activityResponse] = await Promise.all([
        api.get('/agents/' + id),
        api.get('/spaces?take=100'),
        api.get('/agents/' + id + '/activity'),
      ]);
      setAgent(agentResponse.data);
      setSpaces(spacesResponse.data.data || []);
      setActivity(activityResponse.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || t('agent.loadOneFailed'));
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (!agent) return <div className="py-12 text-center text-gray-500">{error || t('common.loading')}</div>;

  const updateStatus = async () => {
    await api.patch('/agents/' + id, { status: agent.status === 'active' ? 'paused' : 'active' });
    await load();
  };

  const roleName = (role: AgentAccessRole) => t(`agent.role.${role}.name`);
  const formatDate = (value: string | null | undefined) => value
    ? new Date(value).toLocaleString(language)
    : t('agent.never');
  const credentialIsActive = (item: { expiresAt?: string | null; revokedAt?: string | null }) => (
    !item.revokedAt && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now())
  );

  return (
    <div className="max-w-5xl mx-auto">
      <Link to="/agents" className="text-sm text-gray-500 hover:text-blue-600">← {t('nav.agents')}</Link>
      <div className="flex items-start justify-between gap-4 mt-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{agent.name}</h1>
            <span className={'text-xs px-2 py-0.5 rounded-full ' + (agent.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700')}>{agent.status}</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">{agent.description || t('common.noDescription')}</p>
        </div>
        <button onClick={() => void updateStatus()} className="h-8 px-3 border rounded-lg text-sm flex items-center gap-2">
          {agent.status === 'active' ? <Pause size={14} /> : <Play size={14} />} {agent.status === 'active' ? t('agent.pause') : t('agent.resume')}
        </button>
      </div>

      <div className="border-b flex gap-6 mb-6">
        {(['overview', 'access', 'activity', 'memory', 'settings'] as Tab[]).map((item) => (
          <button key={item} onClick={() => setTab(item)} className={'pb-3 text-sm border-b-2 ' + (tab === item ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500')}>{t(`agent.${item}`)}</button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="grid sm:grid-cols-3 gap-4">
          <Summary label={t('nav.spaces')} value={agent.grants.length} />
          <Summary label={t('agent.activeCredentials')} value={agent.credentials.filter(credentialIsActive).length} />
          <Summary label={t('agent.approvalMode')} value={agent.approvalMode} />
        </div>
      ) : null}

      {tab === 'access' ? (
        <div className="space-y-6">
          <LocalSyncInstallCard
            agentId={agent.id}
            spaces={spaces}
            grants={agent.grants}
            title={t('agent.accessAuthorization')}
          />

          <section className="border rounded-[14px] bg-white p-5">
            <h2 className="font-semibold mb-4 flex items-center gap-2"><Shield size={18} /> {t('agent.authorizedSpaces')}</h2>
            <div className="divide-y">
              {agent.grants.map((item: any) => (
                <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">{item.space.name}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">{roleName(item.role)}</span>
                  <button aria-label={t('agent.removeGrantFor', { space: item.space.name })} onClick={async () => { try { await api.delete('/agents/' + id + '/grants/' + item.spaceId); await load(); } catch (e: any) { setError(e.response?.data?.message || 'Failed'); } }} className="text-red-600"><Trash2 size={15} /></button>
                </div>
              ))}
              {!agent.grants.length ? <p className="py-3 text-sm text-gray-500">{t('agent.noAuthorizedSpaces')}</p> : null}
            </div>
          </section>

          <section className="border rounded-[14px] bg-white p-5">
            <h2 className="font-semibold mb-4 flex items-center gap-2"><KeyRound size={18} /> {t('agent.connectionRecords')}</h2>
            <div className="divide-y">
              {agent.credentials.map((item: any) => (
                <div key={item.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.name} <span className="ml-2 text-xs font-normal text-gray-500">{item.authorization.space.name} · {roleName(item.authorization.role)}</span></p>
                    <p className="mt-1 text-xs text-gray-500">{item.prefix}… · {t('agent.lastUsed')}: {formatDate(item.lastUsedAt)} · {t('agent.expires')}: {formatDate(item.expiresAt)}</p>
                    <p className="mt-1 text-xs text-gray-400">{credentialIsActive(item) ? t('agent.credentialActive') : t('agent.credentialExpired')}</p>
                  </div>
                  <button aria-label={t('agent.revokeCredential', { name: item.name })} onClick={async () => { try { await api.delete('/agents/' + id + '/credentials/' + item.id); await load(); } catch (e: any) { setError(e.response?.data?.message || 'Failed'); } }} className="text-red-600"><Trash2 size={15} /></button>
                </div>
              ))}
              {!agent.credentials.length ? <p className="py-3 text-sm text-gray-500">{t('agent.noConnectionRecords')}</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'activity' ? <div className="border rounded-[14px] bg-white divide-y">{activity.map((item) => <div key={item.id} className="p-4 text-sm"><span className="font-medium">{item.action}</span><span className="text-gray-400 ml-3">{new Date(item.createdAt).toLocaleString(language)}</span></div>)}</div> : null}
      {tab === 'memory' ? <AgentMemoryPanel agentId={agent.id} grants={agent.grants} enabled={agent.memoryEnabled} onEnabled={async () => { await api.patch('/agents/' + id, { memoryEnabled: true }); await load(); }} /> : null}
      {tab === 'settings' ? <div className="border rounded-[14px] bg-white p-5"><p className="text-sm text-gray-500">{t('agent.approvalMode')}</p><p className="mt-2 text-sm font-medium">{agent.approvalMode === 'scoped-auto-publish' ? t('settings.autoPublish') : t('settings.alwaysReview')}</p><p className="mt-2 text-xs text-gray-500">{t('agent.approvalModeReadonlyHelp')}</p></div> : null}
    </div>
  );
};

const Summary: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="border rounded-[14px] bg-white p-5"><p className="text-sm text-gray-500">{label}</p><p className="text-xl font-semibold mt-2">{value}</p></div>
);
