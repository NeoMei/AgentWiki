import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Shield, Users, BookOpen, Bot, Lock, Unlock, Key, Trash2, Search, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import api from '../../api/client';
import { apiErrorMessage } from '../../api/error-message';

interface Stats {
  users: { total: number; active: number; locked: number; deleted: number; new7d: number; new30d: number };
  spaces: number;
  pages: number;
  agents: number;
  userTrend30d: number[];
  recentUsers: Array<{ id: string; name: string | null; email: string; createdAt: string; status: string }>;
}

interface UserRow {
  id: string;
  name: string | null;
  email: string;
  platformRole: string;
  lockedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  spaceCount: number;
  agentCount: number;
}

export const AdminPage: React.FC = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [actionTarget, setActionTarget] = useState<UserRow | null>(null);
  const [actionType, setActionType] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const actionBusyRef = useRef(false);
  const actionSequenceRef = useRef(0);

  const loadStats = useCallback(async () => {
    const { data } = await api.get('/platform-admin/stats');
    setStats(data);
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set('query', query);
      params.set('status', statusFilter);
      params.set('platformRole', roleFilter);
      params.set('page', String(page));
      params.set('limit', '20');
      const { data } = await api.get(`/platform-admin/users?${params}`);
      setUsers(data.users);
      setTotalUsers(data.total);
    } finally {
      setLoading(false);
    }
  }, [query, statusFilter, roleFilter, page]);

  useEffect(() => { loadStats(); loadUsers(); }, [loadStats, loadUsers]);

  const performAction = async () => {
    if (!actionTarget || !actionType || actionBusyRef.current) return;
    const target = actionTarget;
    const type = actionType;
    const sequence = ++actionSequenceRef.current;
    actionBusyRef.current = true;
    setActionBusy(true);
    setError(null);
    setActionResult(null);
    try {
      if (type === 'reset-password') {
        const { data } = await api.post(`/platform-admin/users/${target.id}/reset-password`);
        if (sequence !== actionSequenceRef.current) return;
        setActionResult(data.password);
        loadUsers();
        loadStats();
        return;
      } else if (type === 'lock') {
        await api.post(`/platform-admin/users/${target.id}/lock`);
      } else if (type === 'unlock') {
        await api.post(`/platform-admin/users/${target.id}/unlock`);
      } else if (type === 'delete') {
        await api.delete(`/platform-admin/users/${target.id}`);
      }
      if (sequence !== actionSequenceRef.current) return;
      setActionTarget(null);
      setActionType(null);
      loadUsers();
      loadStats();
    } catch (err: unknown) {
      if (sequence === actionSequenceRef.current) setError(apiErrorMessage(err, t, 'admin.actionFailed'));
    } finally {
      if (sequence === actionSequenceRef.current) {
        actionBusyRef.current = false;
        setActionBusy(false);
      }
    }
  };

  const openAction = (target: UserRow, type: string) => {
    if (actionBusyRef.current) return;
    actionSequenceRef.current += 1;
    setActionTarget(target);
    setActionType(type);
    setActionResult(null);
    setError(null);
  };

  const closeAction = () => {
    if (actionBusyRef.current) return;
    actionSequenceRef.current += 1;
    setActionTarget(null);
    setActionType(null);
    setError(null);
    setActionResult(null);
  };

  const statusLabel = (row: UserRow) => row.deletedAt ? t('admin.statusDeleted') : row.lockedAt ? t('admin.statusLocked') : t('admin.statusActive');

  if (!user || user.platformRole !== 'super_admin') {
    return <div className="max-w-4xl mx-auto p-6"><div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center"><AlertTriangle className="mx-auto mb-2 text-red-400" size={32} /><p className="text-red-700 font-medium">{t('common.forbidden')}</p></div></div>;
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="text-blue-600" size={24} /> {t('admin.title')}</h1>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard label={t('admin.usersTotal')} value={stats.users.total} icon={<Users size={18} />} />
          <StatCard label={t('admin.usersActive')} value={stats.users.active} icon={<Users size={18} />} color="green" />
          <StatCard label={t('admin.usersLocked')} value={stats.users.locked} icon={<Lock size={18} />} color="orange" />
          <StatCard label={t('admin.usersDeleted')} value={stats.users.deleted} icon={<Trash2 size={18} />} color="red" />
          <StatCard label={t('admin.spaces')} value={stats.spaces} icon={<BookOpen size={18} />} />
          <StatCard label={t('admin.pages')} value={stats.pages} icon={<BookOpen size={18} />} />
          <StatCard label={t('admin.agents')} value={stats.agents} icon={<Bot size={18} />} />
          <StatCard label={t('admin.new7d')} value={stats.users.new7d} icon={<Users size={18} />} color="blue" />
          <StatCard label={t('admin.new30d')} value={stats.users.new30d} icon={<Users size={18} />} color="blue" />
        </div>
      )}

      {stats && stats.userTrend30d.length > 0 && (
        <div className="bg-white border rounded-xl p-4">
          <h2 className="text-sm font-medium text-gray-500 mb-3">{t('admin.trend30d')}</h2>
          <div className="flex items-end gap-1 h-24">
            {stats.userTrend30d.map((val, i) => (
              <div key={i} className="flex-1 bg-blue-500 rounded-t" style={{ height: `${Math.max(val > 0 ? 4 : 0, (val / Math.max(...stats.userTrend30d, 1)) * 100)}%` }} title={`Day ${i + 1}: ${val}`} />
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border rounded-xl p-4 space-y-4">
        <h2 className="text-lg font-semibold">{t('admin.userManagement')}</h2>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-48">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm" placeholder={t('common.search')} value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
          </div>
          <select className="border rounded-lg px-3 py-2 text-sm" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="all">{t('admin.allStatus')}</option>
            <option value="active">{t('admin.statusActive')}</option>
            <option value="locked">{t('admin.statusLocked')}</option>
            <option value="deleted">{t('admin.statusDeleted')}</option>
          </select>
          <select className="border rounded-lg px-3 py-2 text-sm" value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}>
            <option value="all">{t('admin.allRoles')}</option>
            <option value="user">{t('admin.roleUser')}</option>
            <option value="super_admin">{t('admin.roleAdmin')}</option>
          </select>
        </div>

        {loading ? <p className="text-gray-400 text-sm">{t('common.loading')}</p> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4 font-medium">{t('admin.user')}</th>
                  <th className="py-2 pr-4 font-medium hidden sm:table-cell">{t('admin.role')}</th>
                  <th className="py-2 pr-4 font-medium hidden md:table-cell">{t('admin.spaces')}</th>
                  <th className="py-2 pr-4 font-medium hidden md:table-cell">{t('admin.agents')}</th>
                  <th className="py-2 pr-4 font-medium">{t('admin.status')}</th>
                  <th className="py-2 font-medium">{t('admin.actions')}</th>
                </tr></thead>
                <tbody>
                  {users.map((row) => {
                    const isMe = row.id === user.id;
                    return (
                      <tr key={row.id} className="border-b hover:bg-gray-50">
                        <td className="py-2 pr-4">
                          <div className="font-medium">{row.name || row.email}</div>
                          <div className="text-xs text-gray-400">{row.email}</div>
                        </td>
                        <td className="py-2 pr-4 hidden sm:table-cell">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${row.platformRole === 'super_admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>{row.platformRole === 'super_admin' ? t('admin.roleAdmin') : t('admin.roleUser')}</span>
                        </td>
                        <td className="py-2 pr-4 hidden md:table-cell text-gray-500">{row.spaceCount}</td>
                        <td className="py-2 pr-4 hidden md:table-cell text-gray-500">{row.agentCount}</td>
                        <td className="py-2 pr-4"><span className={`text-xs px-2 py-0.5 rounded-full ${row.deletedAt ? 'bg-red-100 text-red-700' : row.lockedAt ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>{statusLabel(row)}</span></td>
                        <td className="py-2">
                          {isMe ? <span className="text-xs text-gray-400">{t('admin.currentAccount')}</span> : (
                            <div className="flex gap-1">
                              {!row.deletedAt && <button onClick={() => openAction(row, 'reset-password')} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title={t('admin.resetPassword')}><Key size={15} /></button>}
                              {!row.deletedAt && !row.lockedAt && <button onClick={() => openAction(row, 'lock')} className="p-1.5 rounded hover:bg-orange-50 text-orange-600" title={t('admin.lock')}><Lock size={15} /></button>}
                              {!row.deletedAt && row.lockedAt && <button onClick={() => openAction(row, 'unlock')} className="p-1.5 rounded hover:bg-green-50 text-green-600" title={t('admin.unlock')}><Unlock size={15} /></button>}
                              {!row.deletedAt && <button onClick={() => openAction(row, 'delete')} className="p-1.5 rounded hover:bg-red-50 text-red-600" title={t('admin.delete')}><Trash2 size={15} /></button>}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm text-gray-500">{totalUsers} {t('admin.users')}</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 border rounded text-sm disabled:opacity-30">{t('common.prev')}</button>
                <button disabled={page * 20 >= totalUsers} onClick={() => setPage(page + 1)} className="px-3 py-1 border rounded text-sm disabled:opacity-30">{t('common.next')}</button>
              </div>
            </div>
          </>
        )}
      </div>

      {actionTarget && actionType && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={closeAction}>
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">
              {actionType === 'reset-password' ? t('admin.confirmReset') : actionType === 'lock' ? t('admin.confirmLock') : actionType === 'unlock' ? t('admin.confirmUnlock') : t('admin.confirmDelete')}
            </h3>
            <p className="text-sm text-gray-500">{actionTarget.name || actionTarget.email}</p>
            <p className="mb-4 break-all text-sm font-medium text-gray-700">{actionTarget.email}</p>
            {actionResult ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-green-700 mb-2">{t('admin.passwordResetSuccess')}</p>
                <div className="space-y-2 rounded border bg-white px-3 py-2 text-sm">
                  <p><span className="text-gray-500">{t('admin.loginEmail')}:</span> <code className="select-all break-all">{actionTarget.email}</code></p>
                  <p><span className="text-gray-500">{t('admin.temporaryPassword')}:</span> <code className="select-all break-all">{actionResult}</code></p>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(`${t('common.email')}: ${actionTarget.email}\n${t('admin.temporaryPassword')}: ${actionResult}`)}
                    className="text-blue-600 text-xs hover:underline"
                  >{t('admin.copyLoginCredentials')}</button>
                </div>
              </div>
            ) : error ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4"><p className="text-sm text-red-700">{error}</p></div>
            ) : null}
            <div className="flex justify-end gap-2">
              <button disabled={actionBusy} onClick={closeAction} className="px-4 py-2 border rounded-lg text-sm disabled:opacity-50">{actionResult ? t('common.close') : t('common.cancel')}</button>
              {!actionResult && <button disabled={actionBusy} onClick={performAction} className={`px-4 py-2 rounded-lg text-sm text-white disabled:opacity-50 ${actionType === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>{actionBusy ? t('common.loading') : t('common.confirm')}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: number; icon: React.ReactNode; color?: string }> = ({ label, value, icon, color = 'blue' }) => {
  const colors: Record<string, string> = { blue: 'bg-blue-50 text-blue-600', green: 'bg-green-50 text-green-600', orange: 'bg-orange-50 text-orange-600', red: 'bg-red-50 text-red-600' };
  return (
    <div className="bg-white border rounded-xl p-3 flex items-center gap-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[color] || colors.blue}`}>{icon}</div>
      <div><div className="text-lg font-bold">{value}</div><div className="text-xs text-gray-400">{label}</div></div>
    </div>
  );
};
