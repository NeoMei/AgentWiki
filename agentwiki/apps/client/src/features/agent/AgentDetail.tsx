import { AgentArchiveDialog } from './AgentArchiveDialog';
import { bugOperationsText } from '../../i18n/bug-operations-messages';
import { reviewStatusLabel } from '../review/ChangeSetStatusBadge';
import { runtimeLabel } from '../../i18n/runtime-label';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { KeyRound, Pause, Play, Shield, Trash2 } from 'lucide-react';
import type { AgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import api from '../../api/client';
import { credentialIsActive, hasActiveAgentCredential } from '../collaboration/agentPreparationApi';
import { LocalSyncInstallCard } from './LocalSyncInstallCard';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';

type Tab = 'overview' | 'access' | 'activity' | 'settings';

export const AgentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [showArchive, setShowArchive] = useState(false);
  const op = (key: string) => bugOperationsText(language, key);
  const [agent, setAgent] = useState<any>(null);
  const [loadedAgentId, setLoadedAgentId] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const loadSequenceRef = useRef(0);

  const loadAllSpaces = useCallback(async () => {
    let cursor: string | null = null;
    let collected: any[] = [];
    do {
      const suffix: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const response: { data: {
        data?: any[];
        hasMore?: boolean;
        nextCursor?: string | null;
        resetRequired?: boolean;
      } } = await api.get(`/spaces?take=100${suffix}`);
      const page = response.data;
      collected = page.resetRequired && cursor ? (page.data || []) : [...collected, ...(page.data || [])];
      cursor = page.hasMore && page.nextCursor ? page.nextCursor : null;
    } while (cursor);
    return collected;
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    const request = ++loadSequenceRef.current;
    try {
      const [agentResponse, spacesResponse, activityResponse] = await Promise.all([
        api.get('/agents/' + id),
        loadAllSpaces(),
        api.get('/agents/' + id + '/activity'),
      ]);
      if (request !== loadSequenceRef.current) return;
      setAgent(agentResponse.data);
      setLoadedAgentId(id);
      setSpaces(spacesResponse);
      setActivity(activityResponse.data.data || []);
      setError(null);
    } catch (err: any) {
      if (request === loadSequenceRef.current) setError(err.response?.data?.message || t('agent.loadOneFailed'));
    }
  }, [id, loadAllSpaces, t]);

  useEffect(() => {
    setLoadedAgentId(null);
    setError(null);
    setUpdatingStatus(false);
    setShowArchive(false);
    void load();
    return () => { loadSequenceRef.current += 1; };
  }, [load]);

  const currentAgent = loadedAgentId === id ? agent : null;
  if (!currentAgent) return <div className="py-12 text-center text-gray-500">{error || t('common.loading')}</div>;

  const updateStatus = async () => {
    setUpdatingStatus(true);
    setError(null);
    try {
      await api.patch('/agents/' + currentAgent.id, { status: currentAgent.status === 'active' ? 'paused' : 'active' });
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || t('agent.actionFailed'));
    } finally {
      setUpdatingStatus(false);
    }
  };

  const roleName = (role: AgentAccessRole) => t(`agent.role.${role}.name`);
  const formatDate = (value: string | null | undefined) => value
    ? new Date(value).toLocaleString(language)
    : t('agent.never');
  const manageableSpaces = spaces.flatMap((space) => {
    const membership = space.members?.find((member: any) => member.userId === user?.id);
    if (!membership) return [];
    const maxAgentRole: AgentAccessRole = membership.role === 'owner' || membership.role === 'admin'
      ? 'publisher'
      : membership.role === 'editor' ? 'editor' : 'reader';
    return [{ ...space, maxAgentRole }];
  });
  const safeResultSummary = (item: any) => {
    const raw = item.metadata?.resultSummary;
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(Object.entries(raw).filter(([key, value]) =>
      (['total', 'count', 'pageCount', 'changeItems'].includes(key) && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
      || (key === 'hasMore' && typeof value === 'boolean')
      || (key === 'response' && ['returned', 'error'].includes(String(value)))
      || (key === 'status' && typeof value === 'string' && ['active', 'paused', 'archived', 'queued', 'pending', 'pending_review', 'approved', 'published', 'completed', 'failed', 'rejected', 'cancelled', 'running', 'ready', 'blocked', 'partial', 'success'].includes(value))));
  };
  const describeActivity = (item: any) => {
    const action = typeof item.action === 'string' ? item.action : t('agent.activityUnknown');
    const http = action.match(/^([A-Z]+)\s+(.+)$/);
    const transport = !!http && /\/mcp(?:$|[?/])/.test(http[2]);
    const summary = transport ? `${op('operations.transport')} · ${http![2]} · ${op('operations.targetUnknown')}`
      : http ? `${http[1] === 'GET' ? t('agent.activityRead') : http[1] === 'POST' ? t('agent.activityWrite') : http[1]} · ${http[2]}`
        : action.startsWith('mcp.') ? `${t('agent.activityMcp')} · ${action.slice(4)}` : action;
    const target = item.resourceType && item.resourceType !== 'McpCapability' && item.resourceId ? ` · ${item.resourceType} ${item.resourceId}` : '';
    const outcome = item.outcome || item.result || item.status;
    return `${summary}${target}${outcome ? ` · ${['success', 'failure', 'denied'].includes(outcome) ? op(`operations.${outcome}`) : String(outcome)}` : ''}`;
  };
  const resultSummaryText = (item: any) => {
    const summary = safeResultSummary(item);
    const values = Object.entries(summary).map(([key, value]) => {
      const label = ['status', 'count', 'hasMore', 'response'].includes(key) ? op(`operations.result.${key}`) : key;
      const text = key === 'status' ? (['pending_review', 'approved', 'published', 'rejected'].includes(String(value)) ? reviewStatusLabel(String(value), language, String(value)) : runtimeLabel(String(value), t)) : key === 'response' ? op(`operations.result.${value}`) : String(value);
      return `${label}: ${text}`;
    });
    return values.length ? `${op('operations.result')}: ${values.join(' · ')}` : op('operations.resultUnknown');
  };
  const safeActivityDetails = (item: any) => {
    if (!item || typeof item !== 'object') return null;
    const argumentNames = Array.isArray(item.metadata?.argumentNames)
      ? item.metadata.argumentNames.filter((value: unknown) => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,64}$/.test(value)).slice(0, 50) : undefined;
    const details = { resourceType: item.resourceType, resourceId: item.resourceId, argumentNames, resultSummary: safeResultSummary(item) };
    return item.resourceType || item.resourceId || argumentNames ? details : null;
  };

  return (
    <div className="max-w-5xl mx-auto">
      <Link to="/agents" className="text-sm text-gray-500 hover:text-blue-600">← {t('nav.agents')}</Link>
      <div className="flex items-start justify-between gap-4 mt-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{currentAgent.name}</h1>
            <span className={'text-xs px-2 py-0.5 rounded-full ' + (currentAgent.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700')}>{currentAgent.status === 'archived' ? op('operations.archived') : runtimeLabel(currentAgent.status, t)}</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">{currentAgent.description || t('common.noDescription')}</p>
        </div>
        {currentAgent.status !== 'archived' ? <button disabled={updatingStatus} onClick={() => void updateStatus()} className="h-8 px-3 border rounded-lg text-sm flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50">
          {currentAgent.status === 'active' ? <Pause size={14} /> : <Play size={14} />} {currentAgent.status === 'active' ? t('agent.pause') : t('agent.resume')}
        </button> : null}
      </div>

      {error ? <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}

      <div className="border-b flex gap-6 mb-6">
        {(['overview', 'access', 'activity', 'settings'] as Tab[]).map((item) => (
          <button key={item} onClick={() => setTab(item)} className={'pb-3 text-sm border-b-2 ' + (tab === item ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500')}>{t(`agent.${item}`)}</button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="grid sm:grid-cols-3 gap-4">
          <Summary label={t('nav.spaces')} value={currentAgent.grants.length} />
          <Summary label={t('agent.activeCredentials')} value={currentAgent.credentials.filter((item: any) => credentialIsActive(item)).length} />
          <Summary label={t('agent.approvalMode')} value={t('agent.approvalFollowsSpace')} />
        </div>
      ) : null}

      {tab === 'access' ? (
        <div className="space-y-6">
          <LocalSyncInstallCard
            agentId={currentAgent.id}
            spaces={manageableSpaces}
            grants={currentAgent.grants}
            credentialAvailable={hasActiveAgentCredential(currentAgent)}
            agentAvailable={currentAgent.status === 'active' && !currentAgent.revokedAt}
            title={t('agent.accessAuthorization')}
            onAuthorized={load}
          />

          <section className="border rounded-[14px] bg-white p-5">
            <h2 className="font-semibold mb-4 flex items-center gap-2"><Shield size={18} /> {t('agent.authorizedSpaces')}</h2>
            <p className="mb-3 text-sm text-gray-600">{t('agent.credentialSpaceBoundary')}</p>
            <div className="divide-y">
              {currentAgent.grants.map((item: any) => (
                <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">{item.space.name}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">{roleName(item.role)}</span>
                  <button aria-label={t('agent.removeGrantFor', { space: item.space.name })} onClick={async () => { try { await api.delete('/agents/' + id + '/grants/' + item.spaceId); await load(); } catch (e: any) { setError(e.response?.data?.message || t('agent.actionFailed')); } }} className="text-red-600"><Trash2 size={15} /></button>
                </div>
              ))}
              {!currentAgent.grants.length ? <p className="py-3 text-sm text-gray-500">{t('agent.noAuthorizedSpaces')}</p> : null}
            </div>
          </section>

          <section className="border rounded-[14px] bg-white p-5">
            <h2 className="font-semibold mb-4 flex items-center gap-2"><KeyRound size={18} /> {t('agent.connectionRecords')}</h2>
            <div className="divide-y">
              {currentAgent.credentials.map((item: any) => (
                <div key={item.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.name} <span className="ml-2 text-xs font-normal text-gray-500">{t('agent.identityConnection')}</span></p>
                    <p className="mt-1 text-xs text-gray-500">{item.prefix}… · {t('agent.lastUsed')}: {formatDate(item.lastUsedAt)} · {t('agent.expires')}: {formatDate(item.expiresAt)}</p>
                    <p className="mt-1 text-xs text-gray-400">{credentialIsActive(item) ? t('agent.credentialActive') : t('agent.credentialExpired')}</p>
                  </div>
                  <button aria-label={t('agent.revokeCredential', { name: item.name })} onClick={async () => { try { await api.delete('/agents/' + id + '/credentials/' + item.id); await load(); } catch (e: any) { setError(e.response?.data?.message || t('agent.actionFailed')); } }} className="text-red-600"><Trash2 size={15} /></button>
                </div>
              ))}
              {!currentAgent.credentials.length ? <p className="py-3 text-sm text-gray-500">{t('agent.noConnectionRecords')}</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'activity' ? <div className="border rounded-[14px] bg-white divide-y">{activity.map((item) => {
        const details = safeActivityDetails(item);
        return <div key={item.id} className="p-4 text-sm"><div className="flex flex-wrap items-baseline gap-3"><span className="font-medium">{describeActivity(item)}</span><span className="text-gray-400">{new Date(item.createdAt).toLocaleString(language)}</span></div><p className="mt-1 text-xs text-gray-600">{resultSummaryText(item)}</p>{details ? <details className="mt-2 text-xs text-gray-500"><summary className="cursor-pointer">{t('agent.activityDetails')}</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-2">{JSON.stringify(details, null, 2)}</pre></details> : null}</div>;
      })}{!activity.length ? <p className="p-5 text-sm text-gray-500">{t('agent.noActivity')}</p> : null}</div> : null}
      {showArchive ? <AgentArchiveDialog key={currentAgent.id} agent={currentAgent} onClose={() => setShowArchive(false)} onChanged={load} /> : null}
      {tab === 'settings' ? <div className="border rounded-[14px] bg-white p-5"><p className="text-sm text-gray-500">{t('agent.approvalMode')}</p><p className="mt-2 text-sm font-medium">{t('agent.approvalFollowsSpace')}</p><p className="mt-2 text-xs text-gray-500">{t('agent.approvalModeReadonlyHelp')}</p><p className="mt-5 text-sm text-gray-600">{op('operations.archiveHelp')}</p><button type="button" onClick={() => setShowArchive(true)} className="mt-3 rounded-lg border px-3 py-2 text-sm">{op(currentAgent.status === 'archived' ? 'operations.restore' : 'operations.archive')}</button></div> : null}
    </div>
  );
};

const Summary: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="border rounded-[14px] bg-white p-5"><p className="text-sm text-gray-500">{label}</p><p className="text-xl font-semibold mt-2">{value}</p></div>
);
