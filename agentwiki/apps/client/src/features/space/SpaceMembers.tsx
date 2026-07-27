import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/client';
import { Users, Plus, X, Trash2, Shield, Loader2 } from 'lucide-react';
import { SpaceNav } from '../../components/SpaceNav';
import { useLanguage } from '../../context/LanguageContext';

interface Member {
  id: string;
  role: string;
  userId: string;
  user: { id: string; email: string; name: string | null; type: string };
  createdAt: string;
}

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  owner: { label: 'Owner', color: 'bg-purple-100 text-purple-700' },
  editor: { label: 'Editor', color: 'bg-blue-100 text-blue-700' },
  viewer: { label: 'Viewer', color: 'bg-gray-100 text-gray-700' },
};

export const SpaceMembers: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ email: '', role: 'viewer' });
  const [adding, setAdding] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

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

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !addForm.email.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await api.post('/spaces/' + id + '/members', {
        email: addForm.email.trim(),
        role: addForm.role,
      });
      setAddForm({ email: '', role: 'viewer' });
      setShowAdd(false);
      await fetchMembers();
    } catch (err: any) {
      setError(err.response?.data?.message || (zh ? '成员添加失败' : 'Failed to add member'));
    } finally {
      setAdding(false);
    }
  };

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
            {zh ? '管理可以访问此空间的用户及其角色。' : 'Manage who can access this space and their roles.'}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          <Plus size={18} />
          {zh ? '添加成员' : 'Add member'}
        </button>
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
            return (
              <div key={m.id} className="flex items-center gap-3 p-4">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-medium flex-shrink-0">
                  {(m.user.name || m.user.email)[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">
                      {m.user.name || m.user.email}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 truncate">{m.user.email}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {m.role === 'owner' ? (
                    <span className={'text-xs px-2 py-1 rounded-full font-medium ' + roleCfg.color}>
                      {zh ? '所有者' : roleCfg.label}
                    </span>
                  ) : (
                    <select
                      value={m.role}
                      onChange={e => handleRoleChange(m.userId, e.target.value)}
                      disabled={updatingId === m.userId}
                      className="text-xs border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="editor">{zh ? '编辑者' : 'Editor'}</option>
                      <option value="viewer">{zh ? '查看者' : 'Viewer'}</option>
                    </select>
                  )}
                  {m.role !== 'owner' && (
                    <button
                      onClick={() => handleRemove(m.userId, m.user.name || m.user.email)}
                      disabled={updatingId === m.userId}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                      title={zh ? '移除成员' : 'Remove member'}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
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
              <li><strong>{zh ? '编辑者' : 'Editor'}</strong> — {zh ? '可创建和编辑页面' : 'Create and edit pages'}</li>
              <li><strong>{zh ? '查看者' : 'Viewer'}</strong> — {zh ? '只读访问' : 'Read-only access'}</li>
            </ul>
          </div>
        </div>
      </div>

      {showAdd && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowAdd(false)}
        >
          <div
            className="bg-white rounded-lg p-6 w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">{zh ? '添加成员' : 'Add member'}</h2>
              <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">{zh ? '用户邮箱' : 'User email'} *</label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={e => setAddForm({ ...addForm, email: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="user@example.com"
                  required
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-1">
                  {zh ? '该用户必须已经注册账号。' : 'The user must already have an account.'}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{zh ? '角色' : 'Role'}</label>
                <select
                  value={addForm.role}
                  onChange={e => setAddForm({ ...addForm, role: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="editor">{zh ? '编辑者' : 'Editor'}</option>
                  <option value="viewer">{zh ? '查看者' : 'Viewer'}</option>
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md"
                >
                  {zh ? '取消' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={adding || !addForm.email.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {adding ? (zh ? '添加中…' : 'Adding…') : (zh ? '添加' : 'Add')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
