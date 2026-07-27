import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { User, Mail, Calendar, Save, X, Key, Copy, Check, RefreshCw, Trash2, AlertTriangle } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

export const Profile: React.FC = () => {
  const { user, login } = useAuth();
  const { t } = useLanguage();
  const [formData, setFormData] = useState({ name: '', email: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Personal access token state
  const [hasApiKey, setHasApiKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);

  const fetchProfile = async () => {
    try {
      const res = await api.get('/users/me');
      setFormData({ name: res.data.name || '', email: res.data.email || '' });
      setHasApiKey((res.data.apiKeys || []).length > 0);
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
      setNewApiKey(res.data.apiKey);
      setHasApiKey(true);
    } catch (err: any) {
      setError(err.response?.data?.message || t('profile.generateFailed'));
    } finally {
      setKeyLoading(false);
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
      <Link to="/settings/integrations" className="inline-flex items-center text-sm text-blue-600 mb-4">{t('profile.integrations')} →</Link>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-md text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X size={16} /></button>
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-50 text-green-600 rounded-md text-sm">
          {t('profile.updated')}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <div className="flex items-center gap-4 mb-6 pb-6 border-b">
          <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center">
            <User size={32} className="text-blue-600" />
          </div>
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
                  onClick={handleGenerateKey}
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
                onClick={handleGenerateKey}
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
