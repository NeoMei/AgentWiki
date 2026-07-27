import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, KeyRound, Pause, Play, Plus, X } from 'lucide-react';
import api from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';

interface Agent {
  id: string;
  name: string;
  description?: string;
  status: string;
  approvalMode: string;
  grants: Array<{ id: string; space: { id: string; name: string }; role: string }>;
  _count: { credentials: number; auditEvents: number };
}

export const AgentList: React.FC = () => {
  const { t } = useLanguage();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });

  const load = useCallback(async () => {
    try {
      const response = await api.get('/agents');
      setAgents(response.data);
    } catch (err: any) {
      setError(err.response?.data?.message || t('agent.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const createAgent = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/agents', form);
      setForm({ name: '', description: '' });
      setShowCreate(false);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || t('agent.createFailed'));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (agent: Agent) => {
    await api.patch('/agents/' + agent.id, {
      status: agent.status === 'active' ? 'paused' : 'active',
    });
    await load();
  };

  if (loading) return <div className="py-12 text-center text-gray-500">{t('common.loading')}</div>;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{t('nav.agents')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('agent.description')}</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="h-8 px-3 rounded-lg bg-blue-600 text-white text-sm font-medium flex items-center gap-2">
          <Plus size={16} /> {t('agent.new')}
        </button>
      </div>

      {error ? <div className="mb-4 p-3 border border-red-200 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div> : null}

      {agents.length === 0 ? (
        <div className="border rounded-[14px] py-16 text-center bg-white">
          <Bot size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="font-medium">{t('agent.empty')}</p>
          <p className="text-sm text-gray-500 mt-1">{t('agent.emptyHelp')}</p>
        </div>
      ) : (
        <div className="border rounded-[14px] bg-white divide-y">
          {agents.map((agent) => (
            <div key={agent.id} className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center"><Bot size={20} /></div>
              <Link to={'/agents/' + agent.id} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{agent.name}</span>
                  <span className={'text-xs px-2 py-0.5 rounded-full ' + (agent.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700')}>
                    {agent.status}
                  </span>
                </div>
                <p className="text-sm text-gray-500 truncate mt-1">{agent.description || t('common.noDescription')}</p>
                <div className="flex gap-4 text-xs text-gray-400 mt-2">
                  <span>{t('agent.spaces', { count: agent.grants.length })}</span>
                  <span className="flex items-center gap-1"><KeyRound size={12} /> {t('agent.credentialsCount', { count: agent._count.credentials })}</span>
                  <span>{t('agent.auditCount', { count: agent._count.auditEvents })}</span>
                </div>
              </Link>
              <button onClick={() => void toggleStatus(agent)} className="h-8 px-3 border rounded-lg text-sm flex items-center gap-2 hover:bg-gray-50">
                {agent.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                {agent.status === 'active' ? t('agent.pause') : t('agent.resume')}
              </button>
            </div>
          ))}
        </div>
      )}

      {showCreate ? (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <form onSubmit={createAgent} onClick={(event) => event.stopPropagation()} className="bg-white border rounded-[14px] w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold">{t('agent.create')}</h2>
              <button type="button" onClick={() => setShowCreate(false)} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
            </div>
            <label className="block text-sm font-medium mb-1">{t('common.name')}</label>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="w-full h-8 px-3 border rounded-lg mb-4" required />
            <label className="block text-sm font-medium mb-1">{t('common.description')}</label>
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="w-full px-3 py-2 border rounded-lg mb-5" rows={3} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="h-8 px-3 border rounded-lg text-sm">{t('common.cancel')}</button>
              <button disabled={saving || !form.name.trim()} className="h-8 px-3 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">{saving ? t('common.creating') : t('common.create')}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
};
