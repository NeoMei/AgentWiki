import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, PlugZap } from 'lucide-react';
import api from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';

const BASE_SCOPES = [
  'spaces:read',
  'pages:read',
  'sources:read',
  'sources:write',
  'runs:read',
  'runs:write',
  'review:read',
];

  const LOCAL_SYNC_VERSION = '0.1.0';
  const PACKAGE_URL = `https://github.com/NeoMei/AgentWiki/tree/master/agentwiki/packages/local-sync`;

interface InstallationResult {
  installationId: string;
  expiresAt: string;
  instructions: string;
}

export const LocalSyncInstallCard: React.FC<{ agentId: string }> = ({ agentId }) => {
  const { t } = useLanguage();
  const [autoPublish, setAutoPublish] = useState(false);
  const [result, setResult] = useState<InstallationResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!result) return;
    const expiry = Date.parse(result.expiresAt);
    if (expiry <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    const timeout = window.setTimeout(() => window.clearInterval(timer), Math.max(0, expiry - Date.now()));
    return () => { window.clearInterval(timer); window.clearTimeout(timeout); };
  }, [result]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const scopes = autoPublish ? [...BASE_SCOPES, 'review:auto-publish'] : BASE_SCOPES;
      const response = await api.post(`/agents/${agentId}/local-sync-installations`, {
        pluginVersion: LOCAL_SYNC_VERSION,
        scopes,
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

  const remainingSeconds = result
    ? Math.max(0, Math.ceil((Date.parse(result.expiresAt) - now) / 1_000))
    : 0;
  const expired = result ? remainingSeconds === 0 : false;
  const remaining = `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`;

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
          <p className="truncate text-sm font-medium text-gray-900">@agentwiki/local-sync</p>
          <p className="text-xs text-gray-500">{t('agent.localSync.version', { version: LOCAL_SYNC_VERSION })}</p>
        </div>
        <a
          href={PACKAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
        >
          <ExternalLink size={13} />
          {t('agent.localSync.npmLink')}
        </a>
      </div>
      <p className="mt-2 text-xs text-gray-400">{t('agent.localSync.supportedClients')}</p>

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={autoPublish}
          onChange={(event) => setAutoPublish(event.target.checked)}
        />
        <span>{t('agent.localSync.autoPublish')}</span>
      </label>
      <p className="mt-1 pl-5 text-xs text-gray-500">{t('agent.localSync.autoPublishHelp')}</p>

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
          disabled={generating}
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
