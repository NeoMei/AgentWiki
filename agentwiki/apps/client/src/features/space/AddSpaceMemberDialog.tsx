import React, { useEffect, useState } from 'react';
import { Bot, Loader2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import {
  AGENT_ROLE_SCOPES,
  filterAvailableAgents,
  type AgentMemberRole,
  type AgentOption,
} from './spaceMemberAgentOptions';

export interface AddSpaceMemberDialogProps {
  spaceId: string;
  existingAgentIds: string[];
  zh: boolean;
  onClose: () => void;
  onAdded: () => Promise<void> | void;
}

type MemberMode = 'human' | 'agent';

function requestMessage(error: unknown, fallback: string): string {
  const responseMessage = (error as { response?: { data?: { message?: unknown } } })
    .response?.data?.message;
  return typeof responseMessage === 'string' && responseMessage ? responseMessage : fallback;
}

export const AddSpaceMemberDialog: React.FC<AddSpaceMemberDialogProps> = ({
  spaceId,
  existingAgentIds,
  zh,
  onClose,
  onAdded,
}) => {
  const [mode, setMode] = useState<MemberMode>('human');
  const [email, setEmail] = useState('');
  const [humanRole, setHumanRole] = useState('viewer');
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState('');
  const [agentRole, setAgentRole] = useState<AgentMemberRole>('viewer');
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [agentLoadError, setAgentLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadAgents = async () => {
    setLoadingAgents(true);
    setAgentLoadError(null);
    try {
      const response = await api.get('/agents');
      const available = filterAvailableAgents(response.data as AgentOption[], existingAgentIds);
      setAgents(available);
      setAgentId((current) => (
        available.some((agent) => agent.id === current) ? current : available[0]?.id ?? ''
      ));
    } catch {
      setAgents([]);
      setAgentId('');
      setAgentLoadError(zh ? '智能体加载失败' : 'Failed to load agents');
    } finally {
      setLoadingAgents(false);
    }
  };

  useEffect(() => {
    void loadAgents();
  }, [spaceId]);

  const switchMode = (nextMode: MemberMode) => {
    setMode(nextMode);
    setSubmitError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === 'human' ? !email.trim() : !agentId) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      if (mode === 'human') {
        await api.post(`/spaces/${spaceId}/members`, {
          email: email.trim(),
          role: humanRole,
        });
      } else {
        await api.put(`/agents/${agentId}/grants/${spaceId}`, {
          role: agentRole,
          scopes: AGENT_ROLE_SCOPES[agentRole],
        });
      }
      await onAdded();
      onClose();
    } catch (error) {
      setSubmitError(requestMessage(
        error,
        mode === 'human'
          ? (zh ? '成员添加失败' : 'Failed to add member')
          : (zh ? '智能体添加失败' : 'Failed to add agent'),
      ));
      if (mode === 'agent') {
        await loadAgents();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const agentScopes = AGENT_ROLE_SCOPES[agentRole];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-space-member-title"
        className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="add-space-member-title" className="text-xl font-bold">
            {zh ? '添加成员' : 'Add member'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={zh ? '关闭添加成员窗口' : 'Close add member dialog'}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mb-5 grid grid-cols-2 rounded-lg bg-gray-100 p-1" aria-label={zh ? '成员类型' : 'Member type'}>
          {(['human', 'agent'] as const).map((candidate) => {
            const selected = mode === candidate;
            const label = candidate === 'human' ? (zh ? '用户' : 'User') : (zh ? '智能体' : 'Agent');
            return (
              <button
                key={candidate}
                type="button"
                aria-pressed={selected}
                onClick={() => switchMode(candidate)}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  selected ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'human' ? (
            <>
              <div>
                <label htmlFor="space-member-email" className="mb-1 block text-sm font-medium">
                  {zh ? '用户邮箱 *' : 'User email *'}
                </label>
                <input
                  id="space-member-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="user@example.com"
                  required
                  autoFocus
                />
                <p className="mt-1 text-xs text-gray-400">
                  {zh ? '该用户必须已经注册账号。' : 'The user must already have an account.'}
                </p>
              </div>
              <div>
                <label htmlFor="space-human-role" className="mb-1 block text-sm font-medium">
                  {zh ? '角色' : 'Role'}
                </label>
                <select
                  id="space-human-role"
                  value={humanRole}
                  onChange={(event) => setHumanRole(event.target.value)}
                  className="w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="admin">{zh ? '管理员' : 'Admin'}</option>
                  <option value="editor">{zh ? '编辑者' : 'Editor'}</option>
                  <option value="viewer">{zh ? '查看者' : 'Viewer'}</option>
                </select>
              </div>
            </>
          ) : (
            <>
              {loadingAgents ? (
                <div className="flex items-center justify-center py-8 text-sm text-gray-500" role="status">
                  <Loader2 size={17} className="mr-2 animate-spin" />
                  {zh ? '正在加载智能体…' : 'Loading agents…'}
                </div>
              ) : agentLoadError ? (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
                  <p>{agentLoadError}</p>
                  <button type="button" onClick={() => void loadAgents()} className="mt-2 font-medium underline">
                    {zh ? '重试' : 'Retry'}
                  </button>
                </div>
              ) : agents.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 px-4 py-7 text-center">
                  <Bot size={28} className="mx-auto mb-2 text-gray-400" />
                  <p className="text-sm font-medium text-gray-700">
                    {zh ? '没有可添加的智能体' : 'No available agents'}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {zh ? '请先创建或启用一个尚未加入本空间的智能体。' : 'Create or activate an Agent that is not already in this space.'}
                  </p>
                  <Link to="/agents" className="mt-3 inline-block text-sm font-medium text-blue-600 hover:text-blue-700">
                    {zh ? '前往智能体管理' : 'Open Agent management'}
                  </Link>
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="space-agent" className="mb-1 block text-sm font-medium">
                      {zh ? '智能体' : 'Agent'}
                    </label>
                    <select
                      id="space-agent"
                      value={agentId}
                      onChange={(event) => setAgentId(event.target.value)}
                      className="w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name} · {zh ? '已启用' : 'Active'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="space-agent-role" className="mb-1 block text-sm font-medium">
                      {zh ? '智能体角色' : 'Agent role'}
                    </label>
                    <select
                      id="space-agent-role"
                      value={agentRole}
                      onChange={(event) => setAgentRole(event.target.value as AgentMemberRole)}
                      className="w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="viewer">{zh ? '查看者' : 'Viewer'}</option>
                      <option value="editor">{zh ? '编辑者' : 'Editor'}</option>
                    </select>
                  </div>
                  <div className="rounded-lg bg-blue-50 p-3">
                    <p className="text-xs font-medium text-blue-900">
                      {zh ? '默认空间权限' : 'Default Space scopes'}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {agentScopes.map((scope) => (
                        <code key={scope} className="rounded bg-white px-2 py-1 text-xs text-blue-700">{scope}</code>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-blue-700">
                      {zh ? '添加后仍可在成员卡片中调整全部权限。' : 'All scopes can still be adjusted from the member card after adding.'}
                    </p>
                  </div>
                </>
              )}
            </>
          )}

          {submitError ? <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{submitError}</div> : null}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-gray-600 hover:bg-gray-100">
              {zh ? '取消' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={submitting || (mode === 'human' ? !email.trim() : loadingAgents || !!agentLoadError || !agentId)}
              className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting
                ? (zh ? '添加中…' : 'Adding…')
                : mode === 'human'
                  ? (zh ? '添加' : 'Add')
                  : (zh ? '添加智能体' : 'Add agent')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
