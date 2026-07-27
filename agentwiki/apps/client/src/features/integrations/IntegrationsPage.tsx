import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle, Plug } from 'lucide-react';
import api from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';

export const IntegrationsPage: React.FC = () => {
  const { t, language } = useLanguage();
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

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
          <h3 className="font-medium mt-5 mb-2">{t('integration.agentAccess')}</h3>
          <div className="space-y-3">
            {info.access.length ? info.access.map((agent: any) => <div key={agent.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between"><span className="font-medium text-sm">{agent.name}</span><span className={agent.status === 'active' ? 'text-xs text-green-700' : 'text-xs text-amber-700'}>{agent.status}</span></div>
              <p className="text-xs text-gray-500 mt-2">{t('integration.spaceGrants')}</p>
              <div className="flex flex-wrap gap-1 mt-1">{agent.grants.length ? agent.grants.map((grant: any) => <span key={grant.space.id} className="text-xs bg-blue-50 text-blue-700 rounded px-2 py-1">{grant.space.name} · {grant.role}</span>) : <span className="text-xs text-gray-400">{t('integration.noSpaces')}</span>}</div>
              <p className="text-xs text-gray-500 mt-3">{t('integration.credentials')}</p>
              <div className="space-y-2 mt-1">{agent.credentials.length ? agent.credentials.map((credential: any) => <div key={credential.id} className="text-xs bg-gray-50 rounded p-2"><div className="flex justify-between"><code>{credential.name} · {credential.prefix}…</code><span className={credential.active ? 'text-green-700' : 'text-red-700'}>{credential.active ? 'active' : 'expired'}</span></div><p className="text-gray-500 mt-1 break-words">{credential.scopes.join(' · ')}</p></div>) : <span className="text-xs text-gray-400">{t('integration.noCredentials')}</span>}</div>
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
