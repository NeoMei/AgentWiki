import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/client';
import { Users, Plus, Trash2, Shield, ShieldCheck, Loader2, Bot, CheckSquare } from 'lucide-react';
import { SpaceNav } from '../../components/SpaceNav';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { AddSpaceMemberDialog } from './AddSpaceMemberDialog';

interface Member {
  id: string;
  role: string;
  type: 'human' | 'agent';
  scopes?: string[];
  userId?: string;
  agentId?: string;
  user?: { id: string; email: string; name: string | null; type: string };
  agent?: { id: string; name: string; status: string };
  createdAt: string;
}

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  owner: { label: 'Owner', color: 'bg-purple-100 text-purple-700' },
  admin: { label: 'Admin', color: 'bg-indigo-100 text-indigo-700' },
  editor: { label: 'Editor', color: 'bg-blue-100 text-blue-700' },
  viewer: { label: 'Viewer', color: 'bg-gray-100 text-gray-700' },
};

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
  const [expandedScopes, setExpandedScopes] = useState<Set<string>>(new Set());

  // Only owners and admins can manage members; admins cannot grant the owner role.
  const myRole = members.find((m) => m.type === 'human' && m.userId === user?.id)?.role;
  const canManage = myRole === 'owner' || myRole === 'admin';
  const canGrantOwner = myRole === 'owner';

  const fetchMembers = async () => {
    if (!id) return;
    try {
      const res = await api.get('/spaces/' + id + '/members');
      setMembers(res.data);
    } catch {
      setError(zh ? '成员加载失败' : 'Failed to load members');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, [id]);

  const handleRoleChange = async (userId: string, role: string) => {
    if (!id) return;
    setUpdatingId(userId);
    setError(null);
    try {
      await api.patch('/spaces/' + id + '/members/' + userId, { role });
      await fetchMembers();
    } catch (err: any) {
      setError(err.response?.data?.message || (zh ? '角色更新失败' : 'Failed to update role'));
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
      await api.delete('/spaces/' + id + '/members/' + userId);
      await fetchMembers();
    } catch (err: any) {
      setError(err.response?.data?.message || (zh ? '成员移除失败' : 'Failed to remove member'));
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
      await api.delete('/agents/' + agentId + '/grants/' + id);
      await fetchMembers();
    } catch (err: any) {
      setError(err.response?.data?.message || (zh ? '移除智能体授权失败' : 'Failed to remove agent grant'));
    } finally {
      setUpdatingId(null);
    }
  };

  const ALL_SCOPES = [
    { value: 'pages:read', label: '读页面' },
    { value: 'pages:write', label: '写页面' },
    { value: 'sources:read', label: '读代码源' },
    { value: 'sources:write', label: '写代码源' },
    { value: 'runs:read', label: '读扫描' },
    { value: 'runs:write', label: '写扫描' },
    { value: 'review:read', label: '读审核' },
    { value: 'review:auto-publish', label: '直接发布' },
    { value: 'memory:read', label: '读记忆' },
    { value: 'memory:write', label: '写记忆' },
    { value: 'graph:read', label: '读图谱' },
    { value: 'graph:write', label: '写图谱' },
  ];

  // Role presets: one click fills the corresponding scopes.
  const ROLE_PRESETS: Array<{ key: string; label: string; enLabel: string; scopes: string[] }> = [
    {
      key: 'viewer',
      label: '查看者',
      enLabel: 'Viewer',
      scopes: ['pages:read', 'graph:read'],
    },
    {
      key: 'editor',
      label: '编辑者',
      enLabel: 'Editor',
      scopes: ['pages:read', 'pages:write', 'sources:read', 'graph:read', 'graph:write'],
    },
    {
      key: 'reviewer',
      label: '审核者',
      enLabel: 'Reviewer',
      scopes: ['pages:read', 'pages:write', 'review:read', 'review:auto-publish', 'graph:read'],
    },
    {
      key: 'full',
      label: '完全授权',
      enLabel: 'Full',
      scopes: ALL_SCOPES.map(s => s.value),
    },
  ];

  // Derive display role from scopes: any write scope => editor, else viewer.
  const deriveRole = (scopes: string[]): string => {
    if (!scopes || scopes.length === 0) return 'editor'; // empty = inherit all, treat as editor
    return scopes.some(s => s.endsWith(':write') || s === 'review:auto-publish') ? 'editor' : 'viewer';
  };

  const toggleScopes = (agentId: string) => {
    setExpandedScopes(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  const handleScopeToggle = async (agentId: string, currentScopes: string[], scope: string) => {
    const has = currentScopes.includes(scope);
    const newScopes = has ? currentScopes.filter(s => s !== scope) : [...currentScopes, scope];
    await handleScopeUpdate(agentId, newScopes);
  };

  const handleAllScopes = async (agentId: string) => {
    await handleScopeUpdate(agentId, ALL_SCOPES.map(s => s.value));
  };

  const handlePreset = async (agentId: string, scopes: string[]) => {
    await handleScopeUpdate(agentId, scopes);
  };

  const handleScopeUpdate = async (agentId: string, newScopes: string[]) => {
    // Auto-derive role from scopes so the role badge stays in sync.
    const derivedRole = deriveRole(newScopes);
    setUpdatingId(agentId);
    try {
      await api.put('/agents/' + agentId + '/grants/' + id, { role: derivedRole, scopes: newScopes });
      await fetchMembers();
    } catch {
      setError(zh ? '权限更新失败' : 'Failed to update scopes');
    } finally {
      setUpdatingId(null);
    }
  };

  const existingAgentIds = members
    .filter((member) => member.type === 'agent' && member.agentId)
    .map((member) => member.agentId as string);

  if (loading)
    return (
      <div className="flex items-center justify-center py-8 text-gray-500">
        <Loader2 className="animate-spin mr-2" size={18} />
        {zh ? '加载中…' : 'Loading…'}
      </div>
    );

  return (
    <div>
      <SpaceNav spaceId={id} />
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
            <Link to={'/spaces/' + id} className="hover:text-blue-600">{zh ? '空间' : 'Space'}</Link>
            <span>/</span>
            <span className="text-gray-600 font-medium">{zh ? '成员' : 'Members'}</span>
          </div>
          <h1 className="text-2xl font-bold">{zh ? '成员' : 'Members'}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {zh
              ? '管理可以访问此空间的用户、智能体及其权限。'
              : 'Manage users, Agents, and permissions for this space.'}
          </p>
        </div>
        {canManage ? (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <Plus size={18} />
            {zh ? '添加成员' : 'Add member'}
          </button>
        ) : null}
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-md text-sm">{error}</div>}

      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
        {members.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Users size={48} className="mx-auto mb-3 opacity-50" />
            <p>{zh ? '未找到成员。' : 'No members found.'}</p>
          </div>
        ) : (
          members.map(m => {
            const roleCfg = ROLE_LABELS[m.role] || ROLE_LABELS.viewer;
            if (m.type === 'agent') {
              return (
                <div key={m.id} data-testid={`member-agent-${m.agentId}`}>
                <div className="flex items-center gap-3 p-4">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white font-medium flex-shrink-0">
                    <Bot size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{m.agent?.name}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">{zh ? '智能体' : 'Agent'}</span>
                      {m.scopes && m.scopes.length > 0 ? (
                        <span className="text-xs text-gray-400">{m.scopes.length} {zh ? '个权限' : 'scopes'}</span>
                      ) : null}
                    </div>
                    <p className="text-sm text-gray-500 truncate">
                      {zh ? '通过 Agent 授权接入' : 'Connected via agent grant'}
                      {m.scopes && m.scopes.length === 0 ? (zh ? ' · 权限受全局凭据控制' : ' · scopes follow global credential') : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {(() => {
                      const dr = deriveRole(m.scopes || []);
                      const drCfg = dr === 'editor' ? ROLE_LABELS.editor : ROLE_LABELS.viewer;
                      return <>
                        <span className={'text-xs px-2 py-1 rounded-full font-medium ' + drCfg.color}>
                          {dr === 'editor' ? (zh ? '编辑者' : 'Editor') : (zh ? '查看者' : 'Viewer')}
                        </span>
                        {canManage ? (
                          <>
                            <button
                              onClick={() => toggleScopes(m.agentId!)}
                              className={`p-1.5 rounded transition-colors ${expandedScopes.has(m.agentId!) ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}
                              title={zh ? '权限设置' : 'Scope settings'}
                            >
                              {expandedScopes.has(m.agentId!) ? <ShieldCheck size={16} /> : <Shield size={16} />}
                            </button>
                            <button
                              onClick={() => handleRemoveAgent(m.agentId!, m.agent?.name || '')}
                              disabled={updatingId === m.agentId}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                              title={zh ? '移除授权' : 'Remove grant'}
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        ) : null}
                      </>;
                    })()}
                  </div>
                </div>
                {canManage && expandedScopes.has(m.agentId!) ? (
                  <div className="px-4 pb-4 pl-17 ml-13">
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-medium text-gray-500">
                          {zh ? '本空间权限（收窄全局凭据）' : 'Space-level scopes (intersect with credential)'}
                        </p>
                        <button
                          onClick={() => handleAllScopes(m.agentId!)}
                          disabled={updatingId === m.agentId || ALL_SCOPES.every(s => (m.scopes || []).includes(s.value))}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
                        >
                          {ALL_SCOPES.every(s => (m.scopes || []).includes(s.value)) ? (
                            <><CheckSquare size={13} />{zh ? '已全选' : 'All selected'}</>
                          ) : (
                            <><CheckSquare size={13} />{zh ? '全选' : 'Select all'}</>
                          )}
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mb-2">
                        <span className="text-xs text-gray-400">{(zh ? '快捷预设' : 'Presets')}:</span>
                        {ROLE_PRESETS.map(p => {
                          const active = JSON.stringify((m.scopes || []).slice().sort()) === JSON.stringify(p.scopes.slice().sort());
                          return (
                            <button
                              key={p.key}
                              onClick={() => handlePreset(m.agentId!, p.scopes)}
                              disabled={updatingId === m.agentId}
                              className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300 hover:text-blue-600'}`}
                            >
                              {zh ? p.label : p.enLabel}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {ALL_SCOPES.map(s => {
                          const checked = (m.scopes || []).includes(s.value);
                          return (
                            <label key={s.value} className={`flex items-center gap-1 px-2 py-1 rounded border text-xs cursor-pointer transition-colors ${checked ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={updatingId === m.agentId}
                                onChange={() => handleScopeToggle(m.agentId!, m.scopes || [], s.value)}
                                className="w-3 h-3"
                              />
                              {(zh ? s.label : s.value)}
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-xs text-gray-400 mt-2">
                        {zh ? '不选则继承全局凭据全部权限；选中后只保留选中的权限。' : 'Leave empty to inherit all credential scopes; selecting restricts to checked scopes only.'}
                      </p>
                    </div>
                  </div>
                ) : null}
                </div>
              );
            }
            return (
              <div key={m.id} className="flex items-center gap-3 p-4">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-medium flex-shrink-0">
                  {(m.user?.name || m.user?.email || '?')[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">
                      {m.user?.name || m.user?.email}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 truncate">{m.user?.email}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {m.role === 'owner' ? (
                    <span className={'text-xs px-2 py-1 rounded-full font-medium ' + roleCfg.color}>
                      {zh ? '所有者' : roleCfg.label}
                    </span>
                  ) : !canManage ? (
                    <span className={'text-xs px-2 py-1 rounded-full font-medium ' + roleCfg.color}>
                      {m.role === 'admin' ? (zh ? '管理员' : 'Admin') : m.role === 'editor' ? (zh ? '编辑者' : 'Editor') : (zh ? '查看者' : 'Viewer')}
                    </span>
                  ) : (
                    <select
                      value={m.role}
                      onChange={e => handleRoleChange(m.userId!, e.target.value)}
                      disabled={updatingId === m.userId}
                      className="text-xs border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {canGrantOwner ? <option value="owner">{zh ? '所有者' : 'Owner'}</option> : null}
                      <option value="admin">{zh ? '管理员' : 'Admin'}</option>
                      <option value="editor">{zh ? '编辑者' : 'Editor'}</option>
                      <option value="viewer">{zh ? '查看者' : 'Viewer'}</option>
                    </select>
                  )}
                  {canManage && m.role !== 'owner' ? (
                    <button
                      onClick={() => handleRemove(m.userId!, m.user?.name || m.user?.email || '')}
                      disabled={updatingId === m.userId}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                      title={zh ? '移除成员' : 'Remove member'}
                    >
                      <Trash2 size={16} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-4 p-4 bg-blue-50 rounded-lg text-sm text-gray-600">
        <div className="flex items-start gap-2">
          <Shield size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-gray-700">{zh ? '角色权限' : 'Role permissions'}</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              <li><strong>{zh ? '所有者' : 'Owner'}</strong> — {zh ? '完整权限，可管理成员和删除空间' : 'Full access, manage members, delete space'}</li>
              <li><strong>{zh ? '管理员' : 'Admin'}</strong> — {zh ? '可管理成员和空间内容，但不能操作所有者' : 'Manage members and content, but not the owner'}</li>
              <li><strong>{zh ? '编辑者' : 'Editor'}</strong> — {zh ? '可创建和编辑页面' : 'Create and edit pages'}</li>
              <li><strong>{zh ? '查看者' : 'Viewer'}</strong> — {zh ? '只读访问' : 'Read-only access'}</li>
            </ul>
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
