import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AGENT_ACCESS_ROLES, type AgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import api from '../../api/client';
import { Users, Plus, Trash2, Shield, Loader2, Bot } from 'lucide-react';
import { SpaceNav } from '../../components/SpaceNav';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { AddSpaceMemberDialog } from './AddSpaceMemberDialog';

type HumanRole = 'owner' | 'admin' | 'editor' | 'viewer';

interface HumanMember {
  id: string;
  role: HumanRole;
  type: 'human';
  userId?: string;
  user?: { id: string; email: string; name: string | null; type: string };
  createdAt: string;
}

interface AgentMember {
  id: string;
  role: AgentAccessRole;
  type: 'agent';
  agentId?: string;
  agent?: { id: string; name: string; status: string };
  canManageRole: boolean;
  createdAt: string;
}

type Member = HumanMember | AgentMember;

const HUMAN_ROLE_STYLES: Record<HumanRole, string> = {
  owner: 'bg-purple-100 text-purple-700',
  admin: 'bg-indigo-100 text-indigo-700',
  editor: 'bg-blue-100 text-blue-700',
  viewer: 'bg-gray-100 text-gray-700',
};

const AGENT_ROLE_STYLES: Record<AgentAccessRole, string> = {
  reader: 'bg-gray-100 text-gray-700',
  editor: 'bg-blue-100 text-blue-700',
  publisher: 'bg-emerald-100 text-emerald-700',
};

const agentRoleName = (role: AgentAccessRole) => (
  role === 'reader' ? 'Reader' : role === 'editor' ? 'Editor' : 'Publisher'
);

export const SpaceMembers: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const myRole = members.find((member) => member.type === 'human' && member.userId === user?.id)?.role;
  const canManage = myRole === 'owner' || myRole === 'admin';
  const canGrantOwner = myRole === 'owner';

  const fetchMembers = async () => {
    if (!id) return;
    try {
      const response = await api.get(`/spaces/${id}/members`);
      setMembers(response.data);
    } catch {
      setError(zh ? '成员加载失败' : 'Failed to load members');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchMembers();
  }, [id]);

  const handleHumanRoleChange = async (userId: string, role: HumanRole) => {
    if (!id) return;
    setUpdatingId(userId);
    setError(null);
    try {
      await api.patch(`/spaces/${id}/members/${userId}`, { role });
      await fetchMembers();
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || (zh ? '角色更新失败' : 'Failed to update role'));
    } finally {
      setUpdatingId(null);
    }
  };

  const handleAgentRoleChange = async (agentId: string, role: AgentAccessRole) => {
    if (!id) return;
    setUpdatingId(agentId);
    setError(null);
    try {
      await api.put(`/agents/${agentId}/grants/${id}`, { role });
      await fetchMembers();
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || (zh ? 'Agent 角色更新失败' : 'Failed to update Agent role'));
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRemove = async (userId: string, name: string) => {
    if (!id) return;
    if (!window.confirm(zh ? `确定从空间中移除 ${name || '此成员'} 吗？` : `Remove ${name || 'this member'} from the space?`)) return;
    setUpdatingId(userId);
    setError(null);
    try {
      await api.delete(`/spaces/${id}/members/${userId}`);
      await fetchMembers();
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || (zh ? '成员移除失败' : 'Failed to remove member'));
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRemoveAgent = async (agentId: string, name: string) => {
    if (!id) return;
    if (!window.confirm(zh ? `确定移除智能体 ${name || '此智能体'} 的授权吗？` : `Remove agent ${name || 'this agent'}'s grant?`)) return;
    setUpdatingId(agentId);
    setError(null);
    try {
      await api.delete(`/agents/${agentId}/grants/${id}`);
      await fetchMembers();
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || (zh ? '移除智能体授权失败' : 'Failed to remove agent grant'));
    } finally {
      setUpdatingId(null);
    }
  };

  const existingAgentIds = members
    .filter((member): member is AgentMember => member.type === 'agent' && !!member.agentId)
    .map((member) => member.agentId as string);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-500">
        <Loader2 className="mr-2 animate-spin" size={18} />
        {zh ? '加载中…' : 'Loading…'}
      </div>
    );
  }

  return (
    <div>
      <SpaceNav spaceId={id} />
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-gray-400">
            <Link to={`/spaces/${id}`} className="hover:text-blue-600">{zh ? '空间' : 'Space'}</Link>
            <span>/</span>
            <span className="font-medium text-gray-600">{zh ? '成员' : 'Members'}</span>
          </div>
          <h1 className="text-2xl font-bold">{zh ? '成员' : 'Members'}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {zh ? '分别管理用户成员角色与 Agent 访问角色。' : 'Manage human member roles and Agent access roles separately.'}
          </p>
        </div>
        {canManage ? (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
            <Plus size={18} />
            {zh ? '添加成员' : 'Add member'}
          </button>
        ) : null}
      </div>

      {error ? <div role="alert" className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div> : null}

      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        {members.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <Users size={48} className="mx-auto mb-3 opacity-50" />
            <p>{zh ? '未找到成员。' : 'No members found.'}</p>
          </div>
        ) : members.map((member) => {
          if (member.type === 'agent') {
            const name = member.agent?.name || (zh ? '未命名 Agent' : 'Unnamed Agent');
            return (
              <div key={member.id} data-testid={`member-agent-${member.agentId}`} className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-white">
                  <Bot size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{name}</span>
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">Agent</span>
                  </div>
                  <p className="truncate text-sm text-gray-500">
                    {member.role === 'publisher'
                      ? (zh ? '自动发布仍受 Space 发布策略限制；Agent 无人工审批权。' : 'Auto-publishing remains subject to Space policy; Agents cannot approve reviews.')
                      : (zh ? '通过统一 Agent 角色授权接入' : 'Connected with a unified Agent role')}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  {member.canManageRole ? (
                    <select
                      aria-label={zh ? `${name} 的 Agent 角色` : `${name} Agent role`}
                      value={member.role}
                      onChange={(event) => void handleAgentRoleChange(member.agentId!, event.target.value as AgentAccessRole)}
                      disabled={updatingId === member.agentId}
                      className="rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {AGENT_ACCESS_ROLES.map((role) => <option key={role} value={role}>{agentRoleName(role)}</option>)}
                    </select>
                  ) : (
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${AGENT_ROLE_STYLES[member.role]}`}>
                      {agentRoleName(member.role)}
                    </span>
                  )}
                  {member.canManageRole ? (
                    <button
                      onClick={() => void handleRemoveAgent(member.agentId!, name)}
                      disabled={updatingId === member.agentId}
                      className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      title={zh ? '移除授权' : 'Remove grant'}
                    >
                      <Trash2 size={16} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          }

          const name = member.user?.name || member.user?.email || (zh ? '未命名用户' : 'Unnamed user');
          return (
            <div key={member.id} className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-purple-500 font-medium text-white">
                {name[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <span className="truncate font-medium">{name}</span>
                <p className="truncate text-sm text-gray-500">{member.user?.email}</p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {member.role === 'owner' || !canManage ? (
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${HUMAN_ROLE_STYLES[member.role]}`}>
                    {member.role === 'owner' ? (zh ? '所有者' : 'Owner')
                      : member.role === 'admin' ? (zh ? '管理员' : 'Admin')
                        : member.role === 'editor' ? (zh ? '编辑者' : 'Editor')
                          : (zh ? '查看者' : 'Viewer')}
                  </span>
                ) : (
                  <select
                    aria-label={zh ? `${name} 的成员角色` : `${name} member role`}
                    value={member.role}
                    onChange={(event) => void handleHumanRoleChange(member.userId!, event.target.value as HumanRole)}
                    disabled={updatingId === member.userId}
                    className="rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {canGrantOwner ? <option value="owner">{zh ? '所有者' : 'Owner'}</option> : null}
                    <option value="admin">{zh ? '管理员' : 'Admin'}</option>
                    <option value="editor">{zh ? '编辑者' : 'Editor'}</option>
                    <option value="viewer">{zh ? '查看者' : 'Viewer'}</option>
                  </select>
                )}
                {canManage && member.role !== 'owner' ? (
                  <button
                    onClick={() => void handleRemove(member.userId!, name)}
                    disabled={updatingId === member.userId}
                    className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    title={zh ? '移除成员' : 'Remove member'}
                  >
                    <Trash2 size={16} />
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-lg bg-blue-50 p-4 text-sm text-gray-600">
        <div className="flex items-start gap-2">
          <Shield size={16} className="mt-0.5 flex-shrink-0 text-blue-500" />
          <div className="space-y-3">
            <div>
              <p className="font-medium text-gray-700">{zh ? '用户成员角色' : 'Human member roles'}</p>
              <p className="mt-1 text-xs">{zh ? '所有者、管理员、编辑者、查看者控制用户协作与成员管理。' : 'Owner, Admin, Editor, and Viewer control human collaboration and member management.'}</p>
            </div>
            <div>
              <p className="font-medium text-gray-700">{zh ? 'Agent 访问角色' : 'Agent access roles'}</p>
              <p className="mt-1 text-xs">Reader · Editor · Publisher — {zh ? 'Publisher 自动发布仍受 Space 发布策略限制，且 Agent 不能人工审批或管理成员。' : 'Publisher auto-publishing remains subject to Space policy, and Agents cannot approve reviews or manage members.'}</p>
            </div>
          </div>
        </div>
      </div>

      {showAdd && id ? (
        <AddSpaceMemberDialog
          spaceId={id}
          existingAgentIds={existingAgentIds}
          zh={zh}
          onClose={() => setShowAdd(false)}
          onAdded={fetchMembers}
        />
      ) : null}
    </div>
  );
};
