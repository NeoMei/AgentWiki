import React, { useCallback, useEffect, useState } from 'react';
import { Copy, RefreshCw, X } from 'lucide-react';
import api from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';

interface ObsidianDevice {
  credentialId: string;
  deviceName: string;
  status: string;
  vaultId?: string | null;
  lastUsedAt?: string | null;
}

export const ObsidianConnectionPanel: React.FC = () => {
  const { t, language } = useLanguage();
  const [devices, setDevices] = useState<ObsidianDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [codeData, setCodeData] = useState<{ code: string; expiresAt: string } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [countdown, setCountdown] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const apiBaseUrl = `${window.location.origin}/api`;

  const loadDevices = useCallback(async () => {
    setLoadingDevices(true);
    try {
      const response = await api.get('/integrations/obsidian/credentials');
      setDevices(response.data?.credentials ?? []);
      setError(null);
    } catch {
      setError(t('integration.generateFailed'));
    } finally {
      setLoadingDevices(false);
    }
  }, [t]);

  useEffect(() => { void loadDevices(); }, [loadDevices]);

  useEffect(() => {
    if (!codeData) return;
    const update = () => {
      const ms = new Date(codeData.expiresAt).getTime() - Date.now();
      if (ms <= 0) {
        setCountdown(t('integration.expired'));
        return;
      }
      const minutes = Math.floor(ms / 60_000);
      const seconds = Math.floor((ms % 60_000) / 1_000);
      setCountdown(t('integration.expiresIn', {
        minutes: String(minutes).padStart(2, '0'),
        seconds: String(seconds).padStart(2, '0'),
      }));
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [codeData, t]);

  const generateCode = async () => {
    setGenerating(true);
    setCodeCopied(false);
    setError(null);
    try {
      const response = await api.post('/integrations/obsidian/installations');
      setCodeData({ code: response.data.code, expiresAt: response.data.expiresAt });
    } catch {
      setError(t('integration.generateFailed'));
    } finally {
      setGenerating(false);
    }
  };

  const copyCode = async () => {
    if (!codeData) return;
    try {
      await navigator.clipboard.writeText(codeData.code);
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 2_000);
    } catch {
      setError(t('integration.generateFailed'));
    }
  };

  const revokeDevice = async (credentialId: string) => {
    if (!window.confirm(t('integration.revokeConfirm'))) return;
    setRevokingId(credentialId);
    setError(null);
    try {
      await api.delete(`/integrations/obsidian/credentials/${credentialId}`);
      setDevices((current) => current.filter((device) => device.credentialId !== credentialId));
    } catch {
      setError(t('integration.revokeFailed'));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <section className="mt-8 rounded-2xl border border-purple-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="obsidian-connect-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="obsidian-connect-title" className="text-lg font-semibold">{t('integration.obsidianSync')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('integration.obsidianSyncDesc')}</p>
        </div>
        <button
          type="button"
          onClick={() => void generateCode()}
          disabled={generating}
          className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {generating ? t('integration.generating') : t('integration.generateCode')}
        </button>
      </div>

      {error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p> : null}

      {codeData ? (
        <div className="relative mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <button type="button" aria-label={t('common.close')} onClick={() => setCodeData(null)} className="absolute right-2 top-2 text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
          <p className="mb-2 text-sm font-medium">{t('integration.connectionCode')}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <code className="min-w-0 flex-1 break-all rounded border bg-white px-3 py-2 font-mono text-sm">{codeData.code}</code>
            <button type="button" onClick={() => void copyCode()} className="inline-flex shrink-0 items-center justify-center gap-1 rounded border bg-white px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50">
              <Copy size={14} /> {codeCopied ? t('integration.copied') : t('integration.copyCode')}
            </button>
          </div>
          <p className="mt-2 text-xs text-amber-700">{countdown}</p>
          <div className="mt-3 space-y-1 text-xs text-gray-600">
            <p className="font-medium">{t('integration.connectSteps')}</p>
            <p>{t('integration.step1')}</p>
            <p>{t('integration.step2', { origin: apiBaseUrl })}</p>
            <p>{t('integration.step3')}</p>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-3">
        <h3 className="font-medium">{t('integration.connectedDevices')}</h3>
        <button type="button" onClick={() => void loadDevices()} disabled={loadingDevices} className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 disabled:opacity-50">
          <RefreshCw size={13} className={loadingDevices ? 'animate-spin' : ''} /> {t('common.refresh')}
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {!loadingDevices && !devices.length ? <p className="rounded-lg border p-3 text-sm text-gray-500">{t('integration.noDevices')}</p> : null}
        {devices.map((device) => (
          <div key={device.credentialId} className="flex items-center gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{device.deviceName}</span>
                <span className={device.status === 'active' ? 'text-xs text-green-700' : device.status === 'provisional' ? 'text-xs text-blue-700' : 'text-xs text-gray-400'}>{device.status}</span>
              </div>
              <p className="mt-1 truncate text-xs text-gray-500">
                {t('integration.deviceVault')}: {device.vaultId ? `${device.vaultId.slice(0, 8)}…` : '—'} · {t('integration.lastUsed')}: {device.lastUsedAt ? new Date(device.lastUsedAt).toLocaleString(language) : t('integration.never')}
              </p>
            </div>
            <button type="button" onClick={() => void revokeDevice(device.credentialId)} disabled={revokingId === device.credentialId || device.status === 'revoked'} className="shrink-0 rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
              {revokingId === device.credentialId ? '…' : t('integration.revoke')}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
};
