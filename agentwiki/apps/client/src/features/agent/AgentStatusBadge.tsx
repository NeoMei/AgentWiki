import { useLanguage } from '../../context/LanguageContext';
import { bugOperationsText } from '../../i18n/bug-operations-messages';
import { runtimeLabel } from '../../i18n/runtime-label';

export interface AgentConnectionStatus {
  status: string;
  reconnectRequired?: boolean;
}

export function agentNeedsReconnect({ status, reconnectRequired }: AgentConnectionStatus) {
  return status === 'active' && reconnectRequired === true;
}

export function AgentStatusBadge({ agent }: { agent: AgentConnectionStatus }) {
  const { language, t } = useLanguage();
  const needsReconnect = agentNeedsReconnect(agent);
  const color = agent.status === 'active' && !needsReconnect
    ? 'bg-green-50 text-green-700'
    : 'bg-amber-50 text-amber-700';
  const statusLabel = agent.status === 'archived'
    ? bugOperationsText(language, 'operations.archived')
    : runtimeLabel(agent.status, t);

  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${color}`}>
      {needsReconnect ? t('agent.reconnectRequired') : statusLabel}
    </span>
  );
}
