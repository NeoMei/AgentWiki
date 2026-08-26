import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { listPageTemplates } from './pageTemplateApi';
import type { PageTemplateListResponse } from './pageTemplateTypes';

export const PageTemplateSettingsCard: React.FC<{ spaceId: string }> = ({ spaceId }) => {
  const { language, t } = useLanguage();
  const identity = `${spaceId}\u0000${language}`;
  const [state, setState] = useState<{ identity: string; value: PageTemplateListResponse } | null>(null);
  const [failedIdentity, setFailedIdentity] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const visibleState = state?.identity === identity ? state.value : null;
  const failed = failedIdentity === identity;

  useEffect(() => {
    let active = true;
    setState(null);
    setFailedIdentity(null);
    void listPageTemplates(spaceId, { locale: language, scope: 'space', take: 1 })
      .then((result) => {
        if (active) setState({ identity, value: result });
      })
      .catch(() => {
        if (active) setFailedIdentity(identity);
      });
    return () => {
      active = false;
    };
  }, [identity, language, retryKey, spaceId]);

  return (
    <section className="mt-5 rounded-[14px] border bg-white p-5">
      <h2 className="font-semibold">{t('pageTemplate.settingsTitle')}</h2>
      <p className="mt-1 text-sm text-gray-500">{t('pageTemplate.settingsDescription')}</p>
      {failed ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-red-600">{t('pageTemplate.settingsLoadFailed')}</p>
          <button type="button" className="min-h-10 rounded-lg border px-3 py-2 text-sm" onClick={() => setRetryKey((value) => value + 1)}>
            {t('pageTemplate.retry')}
          </button>
        </div>
      ) : null}
      {visibleState ? <p className="mt-3 text-sm text-gray-600">{t('pageTemplate.activeCount', { count: visibleState.totalSpace })}</p> : null}
      {visibleState?.capabilities.canManage ? (
        <Link
          className="mt-4 inline-flex min-h-10 items-center rounded-lg border px-4 text-sm"
          to={`/spaces/${spaceId}/settings/page-templates`}
        >
          {t('pageTemplate.manage')}
        </Link>
      ) : null}
    </section>
  );
};
