import React from 'react';
import type { CollaborationTemplateDefinition } from '@neomei/agentwiki-sync-protocol';
import type { RoleBinding, SpaceMemberSummary } from '../types';

export const RoleBindingEditor: React.FC<{
  roleSlots: CollaborationTemplateDefinition['roleSlots'];
  agents: SpaceMemberSummary[];
  bindings: RoleBinding[];
  onChange: (bindings: RoleBinding[]) => void;
  onPrepare?: (roleSlotId: string) => void;
  chooseLabel: string;
  prepareLabel?: string;
  prepareActionLabel?: (roleName: string) => string;
}> = ({ roleSlots, agents, bindings, onChange, onPrepare, chooseLabel, prepareLabel, prepareActionLabel }) => (
  <div className="space-y-4">
    {roleSlots.map((slot) => {
      const value = bindings.find((binding) => binding.roleSlotId === slot.id)?.agentId ?? '';
      const selectId = `role-binding-${slot.id}`;
      return (
        <div key={slot.id} className="min-w-0 rounded-xl border bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <label htmlFor={selectId} className="font-medium text-gray-900">{slot.name}</label>
              {slot.required ? <span className="ml-1 text-red-600" aria-hidden="true">*</span> : null}
              <span className="mt-1 block break-words text-sm text-gray-500">{slot.description}</span>
            </div>
            {onPrepare && prepareLabel ? (
              <button
                type="button"
                aria-label={prepareActionLabel?.(slot.name) ?? `${prepareLabel} for ${slot.name}`}
                onClick={() => onPrepare(slot.id)}
                className="min-h-10 w-full rounded-lg border px-3 text-sm sm:w-auto"
              >
                {prepareLabel}
              </button>
            ) : null}
          </div>
          <select
            id={selectId}
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
        </div>
      );
    })}
  </div>
);
