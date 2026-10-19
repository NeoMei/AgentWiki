import { NativeSelect } from '../../../components/NativeSelect';
import React from 'react';
import type { CollaborationTemplateDefinition } from '@neomei/agentwiki-sync-protocol';
import type { RoleBinding, SpaceMemberSummary } from '../types';
import './role-binding-editor.css';

export const RoleBindingEditor: React.FC<{
  roleSlots: CollaborationTemplateDefinition['roleSlots'];
  agents: SpaceMemberSummary[];
  bindings: RoleBinding[];
  onChange: (bindings: RoleBinding[]) => void;
  onPrepare?: (roleSlotId: string) => void;
  chooseLabel: string;
  prepareLabel?: string;
  prepareActionLabel?: (roleName: string) => string;
  agentAvailability?: Record<string, { disabled: boolean; reason?: string }>;
}> = ({ roleSlots, agents, bindings, onChange, onPrepare, chooseLabel, prepareLabel, prepareActionLabel, agentAvailability }) => (
  <div className="role-binding-editor">
    {roleSlots.map((slot) => {
      const value = bindings.find((binding) => binding.roleSlotId === slot.id)?.agentId ?? '';
      const selectId = `role-binding-${slot.id}`;
      const description = slot.description?.trim();
      const showDescription = !!description && description !== slot.name.trim();
      return (
        <div key={slot.id} className="role-binding-row">
          <div className="role-binding-description">
            <label htmlFor={selectId}>{slot.name}</label>
            {slot.required ? <span className="role-binding-required" aria-hidden="true">*</span> : null}
            {showDescription ? <p id={`${selectId}-description`}>{description}</p> : null}
          </div>
          <div className="role-binding-controls flex-wrap">
            <NativeSelect
              id={selectId}
              aria-label={slot.name}
              aria-describedby={showDescription ? `${selectId}-description` : undefined}
              value={value}
              onChange={(event) => {
                const rest = bindings.filter((binding) => binding.roleSlotId !== slot.id);
                onChange(event.target.value ? [...rest, { roleSlotId: slot.id, roleSlotName: slot.name, agentId: event.target.value }] : rest);
              }}
            >
              <option value="">{chooseLabel}</option>
              {agents.flatMap((member) => {
                if (!member.agentId || !member.agent) return [];
                const availability = agentAvailability?.[member.agentId];
                return [<option key={member.agentId} value={member.agentId} disabled={availability?.disabled}>
                  {member.agent.name}{availability?.reason ? ` — ${availability.reason}` : ''}
                </option>];
              })}
            </NativeSelect>
            {onPrepare && prepareLabel ? (
              <button
                type="button"
                aria-label={prepareActionLabel?.(slot.name) ?? `${prepareLabel} for ${slot.name}`}
                onClick={() => onPrepare(slot.id)}
              >
                {prepareLabel}
              </button>
            ) : null}
          </div>
        </div>
      );
    })}
  </div>
);
