import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context';
import { Eye, EyeOff } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { BrandMark } from '../../components/BrandMark';
import { authFormError, type AuthFieldError } from './auth-form-validation';

export const Register: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
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
    const invalid = authFormError({ name, email, password });
    setFieldError(invalid);
    if (invalid) {
      (e.currentTarget.elements.namedItem(invalid.field) as HTMLInputElement)?.focus();
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      const response = await api.post('/auth/register', { email: email.trim(), password, name });
      login(response.data.access_token, response.data.user);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.message || t('auth.registrationFailed'));
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
          <h2 className="text-xl text-gray-600 mt-2">{t('auth.createAccount')}</h2>
        </div>
        {error && (
          <div role="alert" className="p-3 bg-red-50 text-red-600 rounded-md text-sm text-center">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="register-name" className="block text-sm font-medium mb-1">{t('common.name')}</label>
            <input
              id="register-name"
              name="name"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setFieldError(null); setError(''); }}
              aria-required="true"
              aria-invalid={fieldError?.field === 'name'}
              aria-describedby={fieldError?.field === 'name' ? 'register-name-error' : undefined}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${fieldError?.field === 'name' ? 'border-red-500' : ''}`}
              autoFocus
            />
            {fieldError?.field === 'name' ? <p id="register-name-error" role="alert" className="mt-1 text-sm text-red-600">{t(fieldError.messageKey)}</p> : null}
          </div>
          <div>
            <label htmlFor="register-email" className="block text-sm font-medium mb-1">{t('common.email')}</label>
            <input
              id="register-email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setFieldError(null); setError(''); }}
              aria-required="true"
              aria-invalid={fieldError?.field === 'email'}
              aria-describedby={fieldError?.field === 'email' ? 'register-email-error' : undefined}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${fieldError?.field === 'email' ? 'border-red-500' : ''}`}
            />
            {fieldError?.field === 'email' ? <p id="register-email-error" role="alert" className="mt-1 text-sm text-red-600">{t(fieldError.messageKey)}</p> : null}
          </div>
          <div>
            <label htmlFor="register-password" className="block text-sm font-medium mb-1">{t('common.password')}</label>
            <div className="relative">
              <input
                id="register-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFieldError(null); setError('');
                }}
                aria-required="true"
                aria-invalid={fieldError?.field === 'password'}
                aria-describedby={fieldError?.field === 'password' ? 'register-password-help register-password-error' : 'register-password-help'}
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
            {fieldError?.field === 'password' ? <p id="register-password-error" role="alert" className="mt-1 text-sm text-red-600">{t(fieldError.messageKey)}</p> : null}
            <div id="register-password-help" className="text-xs text-gray-400 mt-1">{t('auth.passwordHelp')}</div>
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {isSubmitting ? t('auth.registering') : t('auth.register')}
          </button>
        </form>
        <p className="text-center text-sm text-gray-600">
          {t('auth.hasAccount')} <Link to="/login" className="text-blue-600 hover:underline">{t('auth.signIn')}</Link>
        </p>
      </div>
    </div>
  );
};
