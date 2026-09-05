import React, { useRef, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { AgentPreparationDialog, type PreparedAgentSelection } from '../collaboration/components/AgentPreparationDialog';
import { RoleBindingEditor } from '../collaboration/components/RoleBindingEditor';
import type { RoleBinding, SpaceMemberSummary } from '../collaboration/types';
import type { CompositePreviewInput, CompositePreviewRole, CompositePreviewTask } from './compositeTemplateTypes';

export interface CollaborationSettingsValue {
  bindings: RoleBinding[];
  inputValues: Record<string, string | number | boolean>;
  enabledTaskNodeIds: string[];
}

export const CollaborationSettingsPanel: React.FC<{
  spaceId: string;
  roles: CompositePreviewRole[];
  inputs: CompositePreviewInput[];
  tasks: CompositePreviewTask[];
  agents: SpaceMemberSummary[];
  bindings: RoleBinding[];
  inputValues: Record<string, string | number | boolean>;
  enabledTaskNodeIds: string[];
  participants: string[];
  onRefreshAgents: () => Promise<SpaceMemberSummary[]>;
  onChange: (value: CollaborationSettingsValue) => void;
}> = ({ spaceId, roles, inputs, tasks, agents, bindings, inputValues, enabledTaskNodeIds, participants, onRefreshAgents, onChange }) => {
  const { t } = useLanguage();
  const [preparationRole, setPreparationRole] = useState<CompositePreviewRole | null>(null);
  const fallbackRef = useRef<HTMLHeadingElement>(null);
  const availability = Object.fromEntries(agents.flatMap((member) => {
    if (!member.agentId || !member.agent) return [];
    const executable = member.agent.status === 'active' && !member.agent.revokedAt
      && (member.role === 'editor' || member.role === 'publisher');
    const reason = member.role === 'reader'
      ? t('pageTemplate.composite.agentReader')
      : member.agent.status !== 'active' || member.agent.revokedAt
        ? t('pageTemplate.composite.agentInactive')
        : undefined;
    return [[member.agentId, { disabled: !executable, reason }]];
  }));
  const names = new Map(agents.flatMap((member) => member.agentId && member.agent ? [[member.agentId, member.agent.name] as const] : []));
  const participantIds = [...new Set(participants)];

  return <section className="min-w-0 space-y-5">
    {inputs.length ? <div><h3 className="text-base font-semibold">{t('pageTemplate.composite.workflowInputs')}</h3>
      <div className="mt-3 space-y-3">{inputs.map((input) => <label key={input.key} className="block text-sm font-medium text-gray-800">
        {input.label}{input.required ? <span className="ml-1 text-red-600">*</span> : null}
        {input.type === 'boolean' ? <input type="checkbox" checked={inputValues[input.key] === true}
          onChange={(event) => onChange({ bindings, enabledTaskNodeIds, inputValues: { ...inputValues, [input.key]: event.target.checked } })}
          className="ml-3" /> : input.type === 'long_text' ? <textarea required={input.required} aria-label={input.label}
          value={String(inputValues[input.key] ?? '')} onChange={(event) => onChange({ bindings, enabledTaskNodeIds, inputValues: { ...inputValues, [input.key]: event.target.value } })}
          className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2" /> : <input required={input.required} aria-label={input.label}
          type={input.type === 'number' ? 'number' : input.type === 'url' ? 'url' : 'text'} value={String(inputValues[input.key] ?? '')}
          onChange={(event) => {
            const next = { ...inputValues };
            if (input.type === 'number' && event.target.value === '') delete next[input.key];
            else next[input.key] = input.type === 'number' ? Number(event.target.value) : event.target.value;
            onChange({ bindings, enabledTaskNodeIds, inputValues: next });
          }}
          className="mt-1 min-h-10 w-full rounded-lg border px-3" />}
      </label>)}</div></div> : null}
    {tasks.length ? <fieldset><legend className="text-base font-semibold">{t('pageTemplate.composite.taskScope')}</legend>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">{tasks.map((task) => <label key={task.nodeId} className="flex min-w-0 items-start gap-2 rounded-lg border p-3 text-sm">
        <input type="checkbox" checked={enabledTaskNodeIds.includes(task.nodeId)} onChange={(event) => onChange({ bindings, inputValues,
          enabledTaskNodeIds: event.target.checked ? [...enabledTaskNodeIds, task.nodeId] : enabledTaskNodeIds.filter((id) => id !== task.nodeId) })} />
        <span className="break-words">{task.name}</span>
      </label>)}</div></fieldset> : null}
    <div><h3 ref={fallbackRef} tabIndex={-1} className="text-base font-semibold">{t('pageTemplate.composite.roleMapping')}</h3>
      <div className="mt-3"><RoleBindingEditor roleSlots={roles} agents={agents} bindings={bindings}
        onChange={(next) => onChange({ bindings: next, inputValues, enabledTaskNodeIds })}
        onPrepare={(roleId) => setPreparationRole(roles.find((role) => role.id === roleId) ?? null)}
        chooseLabel={t('collaboration.wizard.chooseAgent')} prepareLabel={t('collaboration.agentPreparation.action')}
        prepareActionLabel={(role) => t('collaboration.agentPreparation.actionFor', { role })} agentAvailability={availability} /></div>
    </div>
    <div data-testid="participant-preview" className="rounded-[14px] border bg-gray-50 p-4">
      <h3 className="text-base font-semibold">{t('pageTemplate.composite.actualParticipants')}</h3>
      {participantIds.length ? <ul className="mt-2 space-y-1 text-sm">{participantIds.map((id) => <li key={id}>{names.get(id) ?? id}</li>)}</ul>
        : <p className="mt-2 text-sm text-gray-500">{t('pageTemplate.composite.noParticipants')}</p>}
    </div>
    {preparationRole ? <AgentPreparationDialog spaceId={spaceId} target={{ id: preparationRole.id, name: preparationRole.name }}
      fallbackFocusRef={fallbackRef} onClose={() => setPreparationRole(null)} onAuthorizationLost={async () => setPreparationRole(null)}
      onPrepared={async (prepared: PreparedAgentSelection) => {
        const refreshed = await onRefreshAgents();
        const executable = refreshed.filter(isExecutableAgent);
        const executableIds = new Set(executable.flatMap((member) => member.agentId ? [member.agentId] : []));
        const converged = bindings.filter((item) => item.roleSlotId !== preparationRole.id && executableIds.has(item.agentId));
        const authoritativeAgent = executable.find((member) => member.agentId === prepared.agentId);
        if (!authoritativeAgent) {
          onChange({ bindings: converged, inputValues, enabledTaskNodeIds });
          throw new Error(t('collaboration.agentPreparation.refreshFailed'));
        }
        onChange({ bindings: [...converged, {
          roleSlotId: preparationRole.id, roleSlotName: preparationRole.name, agentId: prepared.agentId,
        }], inputValues, enabledTaskNodeIds });
        setPreparationRole(null);
      }} /> : null}
  </section>;
};

function isExecutableAgent(member: SpaceMemberSummary): boolean {
  return member.type === 'agent' && !!member.agentId && !!member.agent
    && member.agent.status === 'active' && !member.agent.revokedAt
    && (member.role === 'editor' || member.role === 'publisher');
}
