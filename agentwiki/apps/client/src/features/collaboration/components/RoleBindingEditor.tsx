import React from 'react';
import type { CollaborationTemplateDefinition } from '@neomei/agentwiki-sync-protocol';
import type { RoleBinding, SpaceMemberSummary } from '../types';

export const RoleBindingEditor: React.FC<{
  roleSlots: CollaborationTemplateDefinition['roleSlots'];
  agents: SpaceMemberSummary[];
  bindings: RoleBinding[];
  onChange: (bindings: RoleBinding[]) => void;
  chooseLabel: string;
}> = ({ roleSlots, agents, bindings, onChange, chooseLabel }) => (
  <div className="space-y-4">
    {roleSlots.map((slot) => {
      const value = bindings.find((binding) => binding.roleSlotId === slot.id)?.agentId ?? '';
      return (
        <label key={slot.id} className="block rounded-xl border bg-white p-4">
          <span className="font-medium text-gray-900">{slot.name}</span>
          {slot.required ? <span className="ml-1 text-red-600" aria-hidden="true">*</span> : null}
          <span className="mt-1 block text-sm text-gray-500">{slot.description}</span>
          <select
            aria-label={slot.name}
            value={value}
            onChange={(event) => {
              const rest = bindings.filter((binding) => binding.roleSlotId !== slot.id);
              onChange(event.target.value ? [...rest, { roleSlotId: slot.id, roleSlotName: slot.name, agentId: event.target.value }] : rest);
            }}
            className="mt-3 h-10 w-full rounded-lg border px-3 text-sm"
          >
            <option value="">{chooseLabel}</option>
            {agents.map((member) => <option key={member.agentId} value={member.agentId}>{member.agent?.name}</option>)}
          </select>
        </label>
      );
    })}
  </div>
);

