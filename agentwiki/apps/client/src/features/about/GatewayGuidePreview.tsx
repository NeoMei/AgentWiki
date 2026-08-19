import React from 'react';
import { useLanguage } from '../../context/LanguageContext';

export const GatewayGuidePreview: React.FC = () => {
  const { t } = useLanguage();
  return (
    <div data-testid="gateway-guide-preview" className="rounded-xl border border-gray-200 bg-white p-5">
      <h4 className="font-semibold">{t('agent.localSync.title')}</h4>
      <p className="mt-1 text-sm text-gray-600">{t('agent.localSync.description')}</p>
      <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm">
        <strong>@neomei/agentwiki-local-sync</strong>
        <p className="text-gray-500">{t('agent.localSync.supportedClients')}</p>
      </div>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" disabled />
        <span>{t('agent.localSync.autoPublish')}</span>
      </label>
      <div className="mt-4 rounded-lg border bg-gray-50 p-3 font-mono text-xs text-gray-500">
        {t('agent.localSync.guidePlaceholder')}
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled className="h-8 rounded-lg border px-3 text-sm">{t('agent.localSync.copy')}</button>
        <button type="button" disabled className="h-8 rounded-lg border px-3 text-sm">{t('agent.localSync.regenerate')}</button>
      </div>
      <p className="mt-3 text-xs text-gray-500">{t('agent.localSync.installOnly')}</p>
    </div>
  );
};
