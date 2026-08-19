import React from 'react';
import { ExternalLink, PlugZap } from 'lucide-react';
import { LOCAL_SYNC_PACKAGE_NAME, LOCAL_SYNC_PACKAGE_URL, LOCAL_SYNC_VERSION } from '../../config/localSync';
import { useLanguage } from '../../context/LanguageContext';

export const GatewayGuidePreview: React.FC = () => {
  const { t } = useLanguage();
  return (
    <div data-testid="gateway-guide-preview" className="rounded-xl border border-gray-200 bg-white p-5">
      <h4 className="flex items-center gap-2 font-semibold"><PlugZap size={18} /> {t('agent.localSync.title')}</h4>
      <p className="mt-2 text-sm text-gray-600">{t('agent.localSync.description')}</p>
      <div className="mt-3 flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600"><PlugZap size={16} className="text-white" /></div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{LOCAL_SYNC_PACKAGE_NAME}</p>
          <p className="text-xs text-gray-500">{t('agent.localSync.version', { version: LOCAL_SYNC_VERSION })}</p>
        </div>
        <a href={LOCAL_SYNC_PACKAGE_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600">
          <ExternalLink size={13} /> {t('agent.localSync.npmLink')}
        </a>
      </div>
      <p className="mt-2 text-xs text-gray-400">{t('agent.localSync.supportedClients')}</p>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" disabled />
        <span>{t('agent.localSync.autoPublish')}</span>
      </label>
      <p className="mt-1 pl-5 text-xs text-gray-500">{t('agent.localSync.autoPublishHelp')}</p>
      <button type="button" disabled className="mt-4 h-9 rounded-lg bg-blue-600 px-4 text-sm text-white disabled:opacity-50">{t('agent.localSync.generate')}</button>
      <p className="mt-3 text-xs text-gray-500">{t('agent.localSync.installOnly')}</p>
      <a href="/guide" className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"><ExternalLink size={13} /> {t('agent.localSync.learnMore')}</a>
    </div>
  );
};
