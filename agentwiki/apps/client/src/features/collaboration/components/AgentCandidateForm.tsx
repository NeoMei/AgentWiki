import React, { useId, useRef } from 'react';
import { useLanguage } from '../../../context/LanguageContext';
import type { ExecutableAgentRole, OwnedAgentSummary } from '../agentPreparationApi';
import { ExistingAgentContextPanel } from './ExistingAgentContextPanel';
import {
  deriveExistingAgentContext,
  type ExistingAgentContextState,
} from './useExistingAgentContext';

export type AgentCandidateMode = 'existing' | 'new';

export interface AgentCandidateFormProps {
  agents: OwnedAgentSummary[];
  busy: boolean;
  canSubmit: boolean;
  description: string;
  existingAgentContext: ExistingAgentContextState;
  loadFailed: boolean;
  loading: boolean;
  lockedAgent?: { id: string; name: string };
  lockedAgentWasCreated: boolean;
  mode: AgentCandidateMode;
  name: string;
  onDescriptionChange: (description: string) => void;
  onModeChange: (mode: AgentCandidateMode) => void;
  onNameChange: (name: string) => void;
  onRoleChange: (role: ExecutableAgentRole) => void;
  onSelectedAgentIdChange: (agentId: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  role: ExecutableAgentRole;
  retryingPreparation: boolean;
  selectedAgent?: OwnedAgentSummary;
  selectedAgentId: string;
  showPrepare: boolean;
  spaceId: string;
  tabListLabel: string;
}

export const AgentCandidateForm: React.FC<AgentCandidateFormProps> = ({
  agents,
  busy,
  canSubmit,
  description,
  existingAgentContext,
  loadFailed,
  loading,
  lockedAgent,
  lockedAgentWasCreated,
  mode,
  name,
  onDescriptionChange,
  onModeChange,
  onNameChange,
  onRoleChange,
  onSelectedAgentIdChange,
  onSubmit,
  role,
  retryingPreparation,
  selectedAgent,
  selectedAgentId,
  showPrepare,
  spaceId,
  tabListLabel,
}) => {
  const { t } = useLanguage();
  const id = useId().replace(/:/gu, '');
  const existingTabRef = useRef<HTMLButtonElement>(null);
  const createTabRef = useRef<HTMLButtonElement>(null);
  const existingTabId = `${id}-existing-tab`;
  const createTabId = `${id}-create-tab`;
  const existingPanelId = `${id}-existing-panel`;
  const createPanelId = `${id}-create-panel`;

  const selectTab = (nextMode: AgentCandidateMode) => {
    if (busy) return;
    onModeChange(nextMode);
    (nextMode === 'existing' ? existingTabRef : createTabRef).current?.focus();
  };

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentMode: AgentCandidateMode,
  ) => {
    if (busy) return;
    let nextMode: AgentCandidateMode | null = null;
    if (event.key === 'Home') nextMode = 'existing';
    else if (event.key === 'End') nextMode = 'new';
    else if (event.key === 'ArrowRight') nextMode = currentMode === 'existing' ? 'new' : 'existing';
    else if (event.key === 'ArrowLeft') nextMode = currentMode === 'existing' ? 'new' : 'existing';
    if (!nextMode) return;
    event.preventDefault();
    selectTab(nextMode);
  };

  const currentContext = deriveExistingAgentContext(
    existingAgentContext,
    selectedAgent,
    spaceId,
  );
  const roleName = t(`agent.role.${role}.name`);

  return (
    <form onSubmit={onSubmit} className="mt-5 min-w-0 space-y-4">
      {lockedAgent ? (
        <p className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-700">
          {t(
            lockedAgentWasCreated
              ? 'collaboration.agentPreparation.createdResume'
              : 'collaboration.agentPreparation.existingResume',
            { agent: lockedAgent.name },
          )}
        </p>
      ) : <>
        <div
          role="tablist"
          aria-label={tabListLabel}
          className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2"
        >
        <button
          ref={existingTabRef}
          id={existingTabId}
          type="button"
          role="tab"
          aria-controls={existingPanelId}
          aria-disabled={busy}
          aria-selected={mode === 'existing'}
          data-modal-autofocus={mode === 'existing' ? true : undefined}
          disabled={busy}
          tabIndex={mode === 'existing' ? 0 : -1}
          onClick={() => selectTab('existing')}
          onKeyDown={(event) => handleTabKeyDown(event, 'existing')}
          className={`min-h-10 rounded-lg border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${mode === 'existing' ? 'bg-gray-100 text-gray-900' : 'bg-white text-gray-600'}`}
        >
          {t('collaboration.agentPreparation.existing')}
        </button>
        <button
          ref={createTabRef}
          id={createTabId}
          type="button"
          role="tab"
          aria-controls={createPanelId}
          aria-disabled={busy}
          aria-selected={mode === 'new'}
          data-modal-autofocus={mode === 'new' ? true : undefined}
          disabled={busy}
          tabIndex={mode === 'new' ? 0 : -1}
          onClick={() => selectTab('new')}
          onKeyDown={(event) => handleTabKeyDown(event, 'new')}
          className={`min-h-10 rounded-lg border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${mode === 'new' ? 'bg-gray-100 text-gray-900' : 'bg-white text-gray-600'}`}
        >
          {t('collaboration.agentPreparation.create')}
        </button>
        </div>

      <div
        id={existingPanelId}
        role="tabpanel"
        aria-labelledby={existingTabId}
        hidden={mode !== 'existing'}
        tabIndex={mode === 'existing' ? 0 : -1}
        className="min-w-0 space-y-3"
      >
        {loading ? <p role="status" className="text-sm text-gray-500">{t('common.loading')}</p> : null}
        {!loading && agents.length === 0 && !loadFailed ? (
          <p className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-600">
            {t('collaboration.agentPreparation.noOwnedAgents')}
          </p>
        ) : null}
        {agents.length > 0 ? (
          <label className="block text-sm font-medium">
            {t('collaboration.dashboard.agent')}
            <select
              aria-label={t('collaboration.dashboard.agent')}
              value={selectedAgentId}
              disabled={busy || mode !== 'existing'}
              onChange={(event) => onSelectedAgentIdChange(event.target.value)}
              className="mt-1 h-10 w-full min-w-0 rounded-lg border px-3 text-sm disabled:bg-gray-100"
            >
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </label>
        ) : null}
        {selectedAgent ? (
          <ExistingAgentContextPanel
            agent={selectedAgent}
            context={existingAgentContext}
            spaceId={spaceId}
          />
        ) : null}
        </div>

      <div
        id={createPanelId}
        role="tabpanel"
        aria-labelledby={createTabId}
        hidden={mode !== 'new'}
        tabIndex={mode === 'new' ? 0 : -1}
        className="grid min-w-0 grid-cols-1 gap-4"
      >
        <label className="block text-sm font-medium">
          {t('common.name')}
          <input
            aria-label={t('common.name')}
            required
            value={name}
            disabled={busy || mode !== 'new'}
            onChange={(event) => onNameChange(event.target.value)}
            className="mt-1 h-10 w-full min-w-0 rounded-lg border px-3 text-sm disabled:bg-gray-100"
          />
        </label>
        <label className="block text-sm font-medium">
          {t('common.description')}
          <textarea
            aria-label={t('common.description')}
            value={description}
            disabled={busy || mode !== 'new'}
            onChange={(event) => onDescriptionChange(event.target.value)}
            rows={3}
            className="mt-1 w-full min-w-0 rounded-lg border p-3 text-sm disabled:bg-gray-100"
          />
        </label>
        </div>
      </>}

      <label className="block text-sm font-medium">
        {t('collaboration.agentPreparation.role')}
        <select
          aria-label={t('collaboration.agentPreparation.role')}
          value={role}
          disabled={busy || Boolean(lockedAgent)}
          onChange={(event) => onRoleChange(event.target.value as ExecutableAgentRole)}
          className="mt-1 h-10 w-full min-w-0 rounded-lg border px-3 text-sm disabled:bg-gray-100"
        >
          <option value="editor">{t('agent.role.editor.name')}</option>
          <option value="publisher">{t('agent.role.publisher.name')}</option>
        </select>
      </label>

      {!lockedAgent && mode === 'existing' && selectedAgent && selectedAgent.status !== 'active' ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {t('collaboration.agentPreparation.pausedResume')}
        </p>
      ) : null}
      {!lockedAgent && mode === 'existing' && currentContext.grantRole === 'reader' ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {t('collaboration.agentPreparation.readerUpgrade', { role: roleName })}
        </p>
      ) : null}
      {!lockedAgent && mode === 'existing' && selectedAgent && currentContext.grantRole === null ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {t('collaboration.agentPreparation.noGrantAuthorization', { role: roleName })}
        </p>
      ) : null}

      {showPrepare ? (
        <button
          type="submit"
          disabled={!canSubmit}
          className="min-h-10 w-full rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {busy
            ? t('common.loading')
            : t(retryingPreparation
              ? 'collaboration.agentPreparation.retryPrepare'
              : 'collaboration.agentPreparation.prepare')}
        </button>
      ) : null}
    </form>
  );
};
