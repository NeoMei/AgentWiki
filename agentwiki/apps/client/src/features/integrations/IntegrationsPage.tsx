import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle, Plug, BookOpen, Copy, X } from 'lucide-react';
import api from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';

export const IntegrationsPage: React.FC = () => {
  const { t, language } = useLanguage();
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [codeData, setCodeData] = useState<{ code: string; expiresAt: string } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [countdown, setCountdown] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    api.get('/integrations/obsidian/credentials')
      .then((response) => setDevices(response.data?.credentials ?? []))
      .catch(() => setDeviceError(t('integration.generateFailed')));
  }, []);

  useEffect(() => {
    if (!codeData) return;
    const update = () => {
      const ms = new Date(codeData.expiresAt).getTime() - Date.now();
      if (ms <= 0) { setCountdown(t('integration.expired')); return; }
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      setCountdown(t('integration.expiresIn', { minutes: String(minutes).padStart(2, '0'), seconds: String(seconds).padStart(2, '0') }));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [codeData]);

  const generateCode = async () => {
    setGenerating(true);
    setCodeCopied(false);
    try {
      const response = await api.post('/integrations/obsidian/installations');
      setCodeData({ code: response.data.code, expiresAt: response.data.expiresAt });
    } catch {
      setDeviceError(t('integration.generateFailed'));
    } finally {
      setGenerating(false);
    }
  };

  const copyCode = async () => {
    if (!codeData) return;
    try {
      await navigator.clipboard.writeText(codeData.code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch { /* clipboard may be unavailable */ }
  };

  const revokeDevice = async (credentialId: string) => {
    if (!window.confirm(t('integration.revokeConfirm'))) return;
    setRevokingId(credentialId);
    try {
      await api.delete(`/integrations/obsidian/credentials/${credentialId}`);
      setDevices((prev) => prev.filter((d) => d.credentialId !== credentialId));
    } catch {
      setDeviceError(t('integration.revokeFailed'));
    } finally {
      setRevokingId(null);
    }
  };

  useEffect(() => {
    api.get('/integrations/mcp')
      .then((response) => setInfo(response.data))
      .catch(() => setError(t('integration.healthFailed')));
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      <Link to="/profile" className="text-sm text-gray-500">← {t('common.settings')}</Link>
      <h1 className="text-2xl font-semibold mt-3">{t('nav.integrations')}</h1>
      <p className="text-sm text-gray-500 mt-1 mb-6">{t('integration.description')}</p>
      <div className="border rounded-[14px] bg-white p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center"><Plug size={20} /></div>
          <div><h2 className="font-semibold">Model Context Protocol</h2><p className="text-sm text-gray-500">{info?.transport || (error ? t('integration.unavailable') : t('integration.checking'))}</p></div>
          {error ? <AlertCircle size={18} className="ml-auto text-red-600" /> : <CheckCircle size={18} className="ml-auto text-green-600" />}
        </div>
        {error ? <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p> : null}
        {info ? <>
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">{t('integration.endpoint')}</span><code className="block mt-1 bg-gray-50 border rounded px-2 py-1">{window.location.origin + info.endpoint}</code></div>
            <div><span className="text-gray-500">{t('integration.authentication')}</span><p className="mt-1">{info.authentication}</p></div>
          </div>
          <h3 className="font-medium mt-5 mb-2">{t('integration.tools')}</h3>
          <div className="grid sm:grid-cols-2 gap-2">{info.tools.map((tool: any) => <div key={tool.name} className="flex items-center justify-between gap-2 text-xs bg-gray-50 border rounded px-2 py-1.5"><code>{tool.name}</code><span className="text-gray-500">{tool.requiredScope}</span></div>)}</div>
          <h3 className="font-medium mt-5 mb-2">{t('integration.resources')}</h3>
          <div className="flex flex-wrap gap-2">{info.resources.map((resource: string) => <code key={resource} className="text-xs bg-gray-100 rounded px-2 py-1">{resource}</code>)}</div>
          {/* Obsidian Device Sync */}
          <div className="border-t pt-5 mt-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center"><BookOpen size={20} /></div>
              <div className="flex-1">
                <h2 className="font-semibold">{t('integration.obsidianSync')}</h2>
                <p className="text-sm text-gray-500">{t('integration.obsidianSyncDesc')}</p>
              </div>
              <button
                onClick={generateCode}
                disabled={generating}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {generating ? t('integration.generating') : t('integration.generateCode')}
              </button>
            </div>

            {codeData ? (
              <div className="border rounded-lg p-4 bg-blue-50 mb-4 relative">
                <button
                  onClick={() => setCodeData(null)}
                  className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
                >
                  <X size={16} />
                </button>
                <p className="text-sm font-medium mb-2">{t('integration.connectionCode')}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm bg-white border rounded px-3 py-2 font-mono break-all">{codeData.code}</code>
                  <button
                    onClick={copyCode}
                    className="shrink-0 px-3 py-2 text-xs font-medium text-blue-700 bg-white border rounded hover:bg-blue-50 flex items-center gap-1"
                  >
                    <Copy size={14} />
                    {codeCopied ? t('integration.copied') : t('integration.copyCode')}
                  </button>
                </div>
                <p className="text-xs text-amber-700 mt-2">{countdown}</p>
                <div className="mt-3 text-xs text-gray-600 space-y-1">
                  <p className="font-medium">{t('integration.connectSteps')}</p>
                  <p>{t('integration.step1')}</p>
                  <p>{t('integration.step2', { origin: window.location.origin })}</p>
                  <p>{t('integration.step3')}</p>
                </div>
              </div>
            ) : null}

            <h3 className="font-medium mt-4 mb-2">{t('integration.connectedDevices')}</h3>
            {deviceError ? <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-2">{deviceError}</p> : null}
            <div className="space-y-2">
              {devices.length ? devices.map((device) => (
                <div key={device.credentialId} className="border rounded-lg p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{device.deviceName}</span>
                      <span className={"text-xs " + (device.status === 'active' ? 'text-green-700' : device.status === 'provisional' ? 'text-blue-700' : 'text-gray-400')}>{device.status}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {t('integration.deviceVault')}: {device.vaultId?.slice(0, 8)}… · {t('integration.lastUsed')}: {device.lastUsedAt ? new Date(device.lastUsedAt).toLocaleString(language) : t('integration.never')}
                    </p>
                  </div>
                  <button
                    onClick={() => revokeDevice(device.credentialId)}
                    disabled={revokingId === device.credentialId || device.status === 'revoked'}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
                  >
                    {revokingId === device.credentialId ? '…' : t('integration.revoke')}
                  </button>
                </div>
              )) : <p className="text-sm text-gray-500 border rounded-lg p-3">{t('integration.noDevices')}</p>}
            </div>
          </div>
          <h3 className="font-medium mt-5 mb-2">{t('integration.agentAccess')}</h3>
          <div className="space-y-3">
            {info.access.length ? info.access.map((agent: any) => <div key={agent.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between"><span className="font-medium text-sm">{agent.name}</span><span className={agent.status === 'active' ? 'text-xs text-green-700' : 'text-xs text-amber-700'}>{agent.status}</span></div>
              <p className="text-xs text-gray-500 mt-2">{t('integration.spaceGrants')}</p>
              <div className="flex flex-wrap gap-1 mt-1">{agent.grants.length ? agent.grants.map((grant: any) => <span key={grant.space.id} className="text-xs bg-blue-50 text-blue-700 rounded px-2 py-1">{grant.space.name} · {grant.role}</span>) : <span className="text-xs text-gray-400">{t('integration.noSpaces')}</span>}</div>
              <p className="text-xs text-gray-500 mt-3">{t('integration.credentials')}</p>
              <div className="space-y-2 mt-1">{agent.credentials.length ? agent.credentials.map((credential: any) => <div key={credential.id} className="text-xs bg-gray-50 rounded p-2"><div className="flex justify-between"><code>{credential.name} · {credential.prefix}…</code><span className={credential.active ? 'text-green-700' : 'text-red-700'}>{credential.active ? 'active' : 'expired'}</span></div><p className="text-gray-500 mt-1">{credential.authorization.space.name} · {credential.authorization.role}</p></div>) : <span className="text-xs text-gray-400">{t('integration.noCredentials')}</span>}</div>
            </div>) : <p className="text-sm text-gray-500 border rounded-lg p-3">{t('integration.noAgents')}</p>}
          </div>
          <h3 className="font-medium mt-5 mb-2">{t('integration.recentCalls')}</h3>
          <div className="border rounded-lg divide-y">
            {info.recentCalls.length ? info.recentCalls.map((call: any) => (
              <div key={call.id} className="p-3 flex items-center gap-3 text-sm">
                <span className={call.outcome === 'success' ? 'text-green-700' : 'text-red-700'}>{call.outcome}</span>
                <span className="font-medium">{call.agent.name}</span><code className="text-xs text-gray-500">{call.action}</code>
                <span className="ml-auto text-xs text-gray-400">{new Date(call.createdAt).toLocaleString(language)}</span>
              </div>
            )) : <p className="p-3 text-sm text-gray-500">{t('integration.noCalls')}</p>}
          </div>
          <p className="text-xs text-gray-500 mt-5">{info.note}</p>
        </> : null}
      </div>
    </div>
  );
};
