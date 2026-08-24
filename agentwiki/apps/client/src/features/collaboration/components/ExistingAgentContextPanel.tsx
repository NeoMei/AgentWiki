import React from 'react';
import { useLanguage } from '../../../context/LanguageContext';
import type { OwnedAgentSummary } from '../agentPreparationApi';
import type { ExistingAgentContextState } from './useExistingAgentContext';

export const ExistingAgentContextPanel: React.FC<{
  agent: OwnedAgentSummary;
  context: ExistingAgentContextState;
  spaceId: string;
}> = ({ agent, context, spaceId }) => {
  const { t } = useLanguage();
  const currentDetail = context.status === 'ready'
    && context.agentId === agent.id
    && context.spaceId === spaceId
      ? context.detail
      : null;
  const grantRole = currentDetail?.grants.find((grant) => grant.spaceId === spaceId)?.role
    ?? agent.grants.find((grant) => grant.spaceId === spaceId)?.role
    ?? null;
  const connectionKey = context.status === 'ready'
    ? context.connected ? 'connected' : 'disconnected'
    : context.status === 'unavailable' ? 'unavailable' : 'loading';
  const agentStatus = (currentDetail?.status ?? agent.status) === 'active' ? 'active' : 'paused';

  return (
    <section
      role="region"
      aria-label={t('collaboration.agentPreparation.context.title')}
      className="rounded-[14px] border bg-gray-50 p-4"
    >
      <h3 className="text-sm font-medium text-gray-900">
        {t('collaboration.agentPreparation.context.title')}
      </h3>
      <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-gray-500">{t('common.status')}</dt>
          <dd className="mt-1 font-medium text-gray-900">
            {t(`collaboration.agentPreparation.context.status.${agentStatus}`)}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">
            {t('collaboration.agentPreparation.context.spaceRole')}
          </dt>
          <dd className="mt-1 font-medium text-gray-900">
            {grantRole ? t(`agent.role.${grantRole}.name`) : t('common.none')}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">
            {t('collaboration.agentPreparation.context.connection')}
          </dt>
          <dd className="mt-1 font-medium text-gray-900">
            {t(`collaboration.agentPreparation.context.connection.${connectionKey}`)}
          </dd>
        </div>
      </dl>
    </section>
  );
};
