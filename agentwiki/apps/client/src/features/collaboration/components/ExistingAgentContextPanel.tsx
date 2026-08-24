import React from 'react';
import { useLanguage } from '../../../context/LanguageContext';
import type { OwnedAgentSummary } from '../agentPreparationApi';
import {
  deriveExistingAgentContext,
  type ExistingAgentContextState,
} from './useExistingAgentContext';

export const ExistingAgentContextPanel: React.FC<{
  agent: OwnedAgentSummary;
  context: ExistingAgentContextState;
  spaceId: string;
}> = ({ agent, context, spaceId }) => {
  const { t } = useLanguage();
  const current = deriveExistingAgentContext(context, agent, spaceId);
  const roleText = current.grantRole === undefined
    ? t('common.loading')
    : current.grantRole ? t(`agent.role.${current.grantRole}.name`) : t('common.none');

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
            {t(`collaboration.agentPreparation.context.status.${current.agentStatus}`)}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">
            {t('collaboration.agentPreparation.context.spaceRole')}
          </dt>
          <dd className="mt-1 font-medium text-gray-900">
            {roleText}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">
            {t('collaboration.agentPreparation.context.connection')}
          </dt>
          <dd className="mt-1 font-medium text-gray-900">
            {t(`collaboration.agentPreparation.context.connection.${current.connection}`)}
          </dd>
        </div>
      </dl>
    </section>
  );
};
