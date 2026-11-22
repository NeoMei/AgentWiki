import React, { useState } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { safeNativeReturnTo } from '../../App';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { apiErrorMessage } from '../../api/error-message';
import { safeUniHubEntryHref } from './unihubNavigation';

export const ForcePasswordChange: React.FC = () => {
  const { user, token, login, logout, fromAnotherTab } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const ownsIntent = !fromAnotherTab && typeof user?.id === 'string' && location.state?.passwordUserId === user.id;
  const returnTo = (ownsIntent && (safeUniHubEntryHref(location.state?.uniHubReturnTo)
    ?? safeNativeReturnTo(location.state?.passwordReturnTo))) || '/dashboard';
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!token || !user?.mustChangePassword) {
    return <Navigate to={returnTo} replace />;
  }
  if (location.state && !ownsIntent) {
    return <Navigate to="/change-password" replace state={null} />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setSubmitting(true);
    try {
      const response = await api.post('/auth/change-required-password', { newPassword, confirmPassword });
      if (response.data.user?.id !== user.id) throw new Error('Unexpected AgentWiki account');
      if (login(response.data.access_token, response.data.user) !== false) navigate(returnTo, { replace: true });
    } catch (err: unknown) {
      setError(apiErrorMessage(err, t, 'auth.passwordChangeFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full p-8 bg-white rounded-xl shadow-lg space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">{t('auth.forceChangeTitle')}</h1>
          <p className="text-gray-500 mt-2">{t('auth.forceChangeDesc')}</p>
        </div>
        {error ? <div role="alert" className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div> : null}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t('auth.newPassword')}</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-3 py-2 border rounded-lg" required minLength={8} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('auth.confirmPassword')}</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full px-3 py-2 border rounded-lg" required minLength={8} />
          </div>
          <button type="submit" disabled={submitting} className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{submitting ? t('common.saving') : t('common.save')}</button>
        </form>
        <button onClick={async () => { await logout(); navigate('/'); }} className="w-full py-2 text-sm text-gray-500 hover:text-gray-700">{t('nav.logout')}</button>
      </div>
    </div>
  );
};
