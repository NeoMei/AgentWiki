import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context';
import { Eye, EyeOff } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { BrandMark } from '../../components/BrandMark';
import { apiErrorMessage } from '../../api/error-message';
import { authFormError, type AuthFieldError } from './auth-form-validation';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<AuthFieldError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();
  const { t } = useLanguage();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const invalid = authFormError({ email, password });
    setFieldError(invalid);
    if (invalid) {
      (e.currentTarget.elements.namedItem(invalid.field) as HTMLInputElement)?.focus();
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      const response = await api.post('/auth/login', { email: email.trim(), password });
      login(response.data.access_token, response.data.user);
      if (response.data.user?.mustChangePassword) { navigate('/change-password'); } else { navigate('/dashboard'); }
    } catch (err: unknown) {
      setError(apiErrorMessage(err, t, 'auth.loginFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="absolute right-4 top-4"><LanguageSwitcher /></div>
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
        <div className="text-center">
          <BrandMark size={56} className="mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-gray-900">{t('brand.name')}</h1>
          <h2 className="text-xl text-gray-600 mt-2">{t('auth.signIn')}</h2>
        </div>
        {error && (
          <div role="alert" className="p-3 bg-red-50 text-red-600 rounded-md text-sm text-center">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium mb-1">{t('common.email')}</label>
            <input
              id="login-email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setFieldError(null); setError(''); }}
              aria-required="true"
              aria-invalid={fieldError?.field === 'email'}
              aria-describedby={fieldError?.field === 'email' ? 'login-email-error' : undefined}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${fieldError?.field === 'email' ? 'border-red-500' : ''}`}
              autoFocus
            />
            {fieldError?.field === 'email' ? <p id="login-email-error" role="alert" className="mt-1 text-sm text-red-600">{t(fieldError.messageKey)}</p> : null}
          </div>
          <div>
            <label htmlFor="login-password" className="block text-sm font-medium mb-1">{t('common.password')}</label>
            <div className="relative">
              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setFieldError(null); setError(''); }}
                aria-required="true"
                aria-invalid={fieldError?.field === 'password'}
                aria-describedby={fieldError?.field === 'password' ? 'login-password-error' : undefined}
                className={`w-full px-3 py-2 pr-10 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${fieldError?.field === 'password' ? 'border-red-500' : ''}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                aria-label={t(showPassword ? 'auth.hidePassword' : 'auth.showPassword')}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {fieldError?.field === 'password' ? <p id="login-password-error" role="alert" className="mt-1 text-sm text-red-600">{t(fieldError.messageKey)}</p> : null}
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {isSubmitting ? t('auth.signingIn') : t('auth.signIn')}
          </button>
        </form>
        <p className="text-center text-sm text-gray-600">
          {t('auth.noAccount')} <Link to="/register" className="text-blue-600 hover:underline">{t('auth.register')}</Link>
        </p>
      </div>
    </div>
  );
};
