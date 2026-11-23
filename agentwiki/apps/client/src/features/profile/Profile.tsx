import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Mail, Calendar, Save, X, Key, Copy, Check, RefreshCw, Trash2, AlertTriangle, Bot } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { ModalDialog } from '../../components/ModalDialog';
import { UserAvatar } from '../../components/UserAvatar';
import { AgentStatusBadge, type AgentConnectionStatus } from '../agent/AgentStatusBadge';
import { useUniHubStatus } from '../auth/useUniHubStatus';

interface OwnedAgent extends AgentConnectionStatus {
  id: string;
  name: string;
  description?: string | null;
  grants?: Array<{ id: string }>;
}

export const Profile: React.FC = () => {
  const { token, user, login } = useAuth();
  const uniHubStatus = useUniHubStatus(token, Boolean(token));
  const { t } = useLanguage();
  const [formData, setFormData] = useState({ name: '', email: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Personal access token state
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showKeyConfirm, setShowKeyConfirm] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [agents, setAgents] = useState<OwnedAgent[]>([]);
  const copyKeyRef = useRef<HTMLButtonElement>(null);
  // The profile response only includes unrevoked keys.
  const shouldConfirmKey = hasApiKey !== false || agents.length > 0;

  const fetchProfile = async () => {
    try {
      const [res, agentsRes] = await Promise.all([
        api.get('/users/me'),
        api.get<OwnedAgent[]>('/agents'),
      ]);
      setFormData({ name: res.data.name || '', email: res.data.email || '' });
      setHasApiKey((res.data.apiKeys || []).length > 0);
      setAgents(Array.isArray(agentsRes.data) ? agentsRes.data : []);
    } catch (err: any) {
      setError(err.response?.data?.message || t('profile.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await api.patch('/users/' + (user?.id || ''), {
        name: formData.name,
        email: formData.email,
      });
      if (user) {
        login(localStorage.getItem('token') || '', { ...user, name: res.data.name, email: res.data.email });
      }
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.response?.data?.message || t('profile.updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateKey = async () => {
    setKeyLoading(true);
    setError(null);
    try {
      const res = await api.post('/users/me/api-key');
      setCopied(false);
      setNewApiKey(res.data.apiKey);
      setHasApiKey(true);
      setShowKeyConfirm(false);
      setShowRevokeConfirm(false);
      if (shouldConfirmKey) {
        const response = await api.get<OwnedAgent[]>('/agents').catch(() => null);
        if (Array.isArray(response?.data)) setAgents(response.data);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || t('profile.generateFailed'));
    } finally {
      setKeyLoading(false);
    }
  };

  const requestKey = () => {
    if (shouldConfirmKey) {
      setError(null);
      setShowKeyConfirm(true);
    } else {
      void handleGenerateKey();
    }
  };

  const handleRevokeKey = async () => {
    setKeyLoading(true);
    setError(null);
    try {
      await api.delete('/users/me/api-key');
      setHasApiKey(false);
      setNewApiKey(null);
      setShowRevokeConfirm(false);
    } catch (err: any) {
      setError(err.response?.data?.message || t('profile.revokeFailed'));
    } finally {
      setKeyLoading(false);
    }
  };

  const handleCopy = () => {
    if (newApiKey) {
      navigator.clipboard.writeText(newApiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) return <div className="text-center py-8 text-gray-500">{t('common.loading')}</div>;

  return (
    <div className="max-w-2xl mx-auto">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600 mb-4">
        ← {t('search.back')}
      </Link>
      <h1 className="text-2xl font-bold mb-6">{t('profile.title')}</h1>
      <div className="mb-4 flex flex-wrap gap-4">
        <Link to="/guide/obsidian" className="text-sm text-blue-600">{t('nav.obsidian')} →</Link>
        {uniHubStatus?.enabled ? (
          <>
            <Link to="/unihub?entry=hub" className="text-sm text-blue-600">{t('unihub.open')}</Link>
            <Link to="/unihub" className="text-sm text-blue-600">{t('unihub.manage')}</Link>
          </>
        ) : null}
      </div>

      {error && !showKeyConfirm ? (
        <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-md text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X size={16} /></button>
        </div>
      ) : null}
      {success && (
        <div className="mb-4 p-3 bg-green-50 text-green-600 rounded-md text-sm">
          {t('profile.updated')}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <div className="flex items-center gap-4 mb-6 pb-6 border-b">
          <UserAvatar name={formData.name} email={formData.email} size="lg" />
          <div>
            <h2 className="text-lg font-semibold">{formData.name || t('profile.unnamed')}</h2>
            <p className="text-sm text-gray-500">{formData.email}</p>
            <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">{t('profile.human')}</span>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t('common.name')}</label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('common.email')}</label>
            <input
              type="email"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving || !formData.name.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              <Save size={18} />
              {saving ? t('common.saving') : t('profile.saveChanges')}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2"><Bot size={20} className="text-blue-600" /> {t('profile.myAgents')}</h2>
            <p className="text-sm text-gray-500 mt-1">{t('profile.myAgentsHelp')}</p>
          </div>
          <Link to="/agents" className="text-sm text-blue-600 hover:underline">{t('profile.manageAgents')}</Link>
        </div>
        {agents.length ? (
          <div className="divide-y border rounded-lg">
            {agents.map((agent) => (
              <Link key={agent.id} to={`/agents/${agent.id}`} className="flex items-center gap-3 p-3 hover:bg-gray-50">
                <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center"><Bot size={18} /></div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{agent.name}</p>
                  <p className="text-xs text-gray-500 truncate">{agent.description || t('common.noDescription')}</p>
                </div>
                <AgentStatusBadge agent={agent} />
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-sm text-gray-500">{t('profile.noAgents')}</div>
        )}
      </div>

      {/* Personal access token management */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Key size={20} className="text-gray-600" />
          <h2 className="text-lg font-semibold">{t('profile.personalToken')}</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          {t('profile.tokenHelp')}
        </p>

        {newApiKey ? (
          <div className="mb-4">
            <div className="p-3 bg-green-50 border border-green-200 rounded-md">
              <p className="text-sm text-green-700 font-medium mb-2">
                {t('profile.tokenGenerated')}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-white rounded border text-sm font-mono break-all">
                  {newApiKey}
                </code>
                <button
                  ref={copyKeyRef}
                  onClick={handleCopy}
                  className="p-2 bg-white border rounded hover:bg-gray-50 flex-shrink-0"
                  title={t('profile.copy')}
                >
                  {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                </button>
              </div>
            </div>
            <button
              onClick={() => setNewApiKey(null)}
              className="mt-2 text-sm text-gray-500 hover:text-gray-700"
            >
              {t('profile.dismiss')}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            {hasApiKey ? (
              <>
                <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 rounded-md text-sm">
                  <Check size={14} />
                  {t('profile.tokenActive')}
                </span>
                <button
                  type="button"
                  onClick={requestKey}
                  disabled={keyLoading}
                  className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 text-sm disabled:opacity-50"
                >
                  <RefreshCw size={14} />
                  {keyLoading ? t('profile.working') : t('profile.regenerate')}
                </button>
                {!showRevokeConfirm ? (
                  <button
                    onClick={() => setShowRevokeConfirm(true)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-red-50 text-red-600 rounded-md hover:bg-red-100 text-sm"
                  >
                    <Trash2 size={14} />
                    {t('profile.revoke')}
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-red-600 flex items-center gap-1">
                      <AlertTriangle size={14} />
                      {t('profile.confirm')}
                    </span>
                    <button
                      onClick={handleRevokeKey}
                      disabled={keyLoading}
                      className="px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm disabled:opacity-50"
                    >
                      {keyLoading ? t('profile.revoking') : t('profile.yesRevoke')}
                    </button>
                    <button
                      onClick={() => setShowRevokeConfirm(false)}
                      className="px-3 py-1.5 text-gray-500 hover:bg-gray-100 rounded-md text-sm"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={requestKey}
                disabled={keyLoading}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                <Key size={18} />
                {keyLoading ? t('profile.generating') : t('profile.generate')}
              </button>
            )}
          </div>
        )}
      </div>

      {showKeyConfirm ? (
        <ModalDialog
          labelledBy="generate-api-key-title"
          closeDisabled={keyLoading}
          onRequestClose={() => setShowKeyConfirm(false)}
          fallbackFocusRef={copyKeyRef}
          className="w-full max-w-md rounded-[14px] border bg-white p-6 shadow-xl"
        >
          <h2 id="generate-api-key-title" className="text-lg font-semibold">
            {t(hasApiKey ? 'profile.regenerateTitle' : 'profile.generate')}
          </h2>
          <p id="generate-api-key-warning" className="mt-3 text-sm text-gray-600">
            {t(hasApiKey ? 'profile.regenerateWarning' : 'profile.generateWarning')}
          </p>
          {error ? <p role="alert" className="mt-3 text-sm text-red-600">{error}</p> : null}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              data-modal-autofocus
              disabled={keyLoading}
              onClick={() => setShowKeyConfirm(false)}
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              aria-describedby="generate-api-key-warning"
              disabled={keyLoading}
              onClick={handleGenerateKey}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {t(keyLoading ? 'profile.working' : hasApiKey ? 'profile.yesRegenerate' : 'profile.yesGenerate')}
            </button>
          </div>
        </ModalDialog>
      ) : null}

      <div className="p-4 bg-gray-50 rounded-lg text-sm text-gray-500">
        <div className="flex items-center gap-2 mb-1">
          <Mail size={14} />
          <span>{t('profile.accountType')}</span>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={14} />
          <span>{t('profile.userId', { id: user?.id || '' })}</span>
        </div>
      </div>
    </div>
  );
};
