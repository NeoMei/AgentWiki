import { messages, type Language } from '../../i18n/messages';

export interface AgentOwnerSummary {
  id: string;
  name: string | null;
  email: string;
}

export function agentOwnerText(owner: AgentOwnerSummary | null | undefined, language: Language): string {
  const name = owner?.name?.trim();
  const email = owner?.email?.trim();
  const identity = name && email && name !== email
    ? (language === 'zh-CN' ? `${name}（${email}）` : `${name} (${email})`)
    : name || email || messages[language]['agent.ownerUnknown'];
  return messages[language]['agent.ownerLabel'].replace('{owner}', () => identity);
}
