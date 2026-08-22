import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, PlugZap } from 'lucide-react';
import { AGENT_ACCESS_ROLES, type AgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import api from '../../api/client';
import {
  LOCAL_SYNC_PACKAGE_NAME,
  LOCAL_SYNC_PACKAGE_URL,
  LOCAL_SYNC_VERSION,
} from '../../config/localSync';
import { useLanguage } from '../../context/LanguageContext';

type SpaceOption = { id: string; name: string };
type GrantSummary = { spaceId: string; role: AgentAccessRole; space: SpaceOption };

interface InstallationResult {
  installationId: string;
  expiresAt: string;
  instructions: string;
}

export const LocalSyncInstallCard: React.FC<{
  agentId: string;
  spaces: SpaceOption[];
  grants: GrantSummary[];
}> = ({ agentId, spaces, grants }) => {
  const { t } = useLanguage();
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? '');
  const [role, setRole] = useState<AgentAccessRole>('reader');
  const [result, setResult] = useState<InstallationResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!spaces.some((space) => space.id === spaceId)) {
      setSpaceId(spaces[0]?.id ?? '');
    }
  }, [spaceId, spaces]);

  useEffect(() => {
    setResult(null);
    setCopied(false);
  }, [spaceId, role]);

  useEffect(() => {
    if (!result) return;
    const expiry = Date.parse(result.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    const timeout = window.setTimeout(() => window.clearInterval(timer), Math.max(0, expiry - Date.now()));
    return () => { window.clearInterval(timer); window.clearTimeout(timeout); };
  }, [result]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const response = await api.post(`/agents/${agentId}/local-sync-installations`, {
        pluginVersion: LOCAL_SYNC_VERSION,
        spaceId,
        role,
      });
      setResult(response.data);
      setCopied(false);
      setNow(Date.now());
    } catch {
      setError(t('agent.localSync.failed'));
    } finally {
      setGenerating(false);
    }
  };

  const expiry = result ? Date.parse(result.expiresAt) : Number.NaN;
  const remainingSeconds = result && Number.isFinite(expiry)
    ? Math.max(0, Math.ceil((expiry - now) / 1_000))
    : 0;
  const expired = result ? remainingSeconds === 0 : false;
  const remaining = `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`;
  const currentGrant = grants.find((grant) => grant.spaceId === spaceId);
  const roleName = (value: AgentAccessRole) => t(`agent.role.${value}.name`);

  return (
    <section className="border rounded-[14px] bg-white p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <PlugZap size={18} /> {t('agent.localSync.title')}
      </h2>
      <p className="mt-2 text-sm text-gray-500">{t('agent.localSync.description')}</p>

      <div className="mt-3 flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600">
          <PlugZap size={16} className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900">{LOCAL_SYNC_PACKAGE_NAME}</p>
          <p className="text-xs text-gray-500">{t('agent.localSync.version', { version: LOCAL_SYNC_VERSION })}</p>
        </div>
        <a
          href={LOCAL_SYNC_PACKAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
        >
          <ExternalLink size={13} />
          {t('agent.localSync.npmLink')}
        </a>
      </div>
      <p className="mt-2 text-xs text-gray-400">{t('agent.localSync.supportedClients')}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-gray-700" htmlFor="local-sync-space">
          <span className="mb-1 block font-medium">{t('agent.localSync.spaceLabel')}</span>
          <select
            id="local-sync-space"
            value={spaceId}
            onChange={(event) => setSpaceId(event.target.value)}
            className="h-8 w-full rounded-lg border px-2 text-sm"
          >
            {spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
          </select>
        </label>
        <label className="text-sm text-gray-700" htmlFor="local-sync-role">
          <span className="mb-1 block font-medium">{t('agent.roleLabel')}</span>
          <select
            id="local-sync-role"
            value={role}
            onChange={(event) => setRole(event.target.value as AgentAccessRole)}
            className="h-8 w-full rounded-lg border px-2 text-sm"
          >
            {AGENT_ACCESS_ROLES.map((item) => (
              <option key={item} value={item}>{roleName(item)}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs text-gray-500">{t(`agent.role.${role}.description`)}</p>
      {currentGrant && currentGrant.role !== role ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('agent.localSync.roleChangeWarning', {
            from: roleName(currentGrant.role),
            to: roleName(role),
          })}
        </p>
      ) : null}
      {role === 'publisher' ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('agent.localSync.publisherGovernance')}
        </p>
      ) : null}

      {error ? <p role="alert" className="mt-3 text-sm text-red-600">{error}</p> : null}

      {result ? (
        <div className="mt-4">
          <p className="text-xs text-gray-500">
            {expired ? t('agent.localSync.expired') : t('agent.localSync.expiresIn', { remaining })}
          </p>
          <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-gray-50 p-3 text-xs">
            {result.instructions}
          </pre>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={expired}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(result.instructions);
                  setCopied(true);
                } catch {
                  setError(t('agent.localSync.failed'));
                }
              }}
              className="flex h-9 items-center gap-1 rounded-lg border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? t('agent.localSync.copied') : t('agent.localSync.copy')}
            </button>
            <button
              type="button"
              disabled={generating}
              onClick={() => void generate()}
              className="h-9 rounded-lg border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('agent.localSync.regenerate')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={generating || !spaceId}
          onClick={() => void generate()}
          className="mt-4 h-9 rounded-lg bg-blue-600 px-4 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generating ? t('agent.localSync.generating') : t('agent.localSync.generate')}
        </button>
      )}

      <p className="mt-3 text-xs text-gray-500">{t('agent.localSync.installOnly')}</p>
      <a href="/guide" className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
        <ExternalLink size={13} />
        {t('agent.localSync.learnMore')}
      </a>
    </section>
  );
};
