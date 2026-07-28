import React from 'react';
import { BookOpen, Home, LayoutDashboard } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

export interface GlobalNavigationProps {
  density?: 'public' | 'workspace';
}

export const GlobalNavigation: React.FC<GlobalNavigationProps> = ({ density = 'public' }) => {
  const { token } = useAuth();
  const { t } = useLanguage();
  const { pathname, search } = useLocation();
  const workspaceIntent = pathname === '/' && new URLSearchParams(search).get('intent') === 'workspace';
  const labelClass = density === 'workspace' ? 'hidden xl:inline' : 'hidden sm:inline';
  const items = [
    { label: t('nav.home'), to: '/', active: pathname === '/' && !workspaceIntent, icon: Home },
    { label: t('nav.guide'), to: '/guide', active: pathname === '/guide', icon: BookOpen },
    {
      label: t('nav.dashboard'),
      to: token ? '/dashboard' : '/?intent=workspace#login',
      active: pathname === '/dashboard' || workspaceIntent,
      icon: LayoutDashboard,
    },
  ];

  return (
    <div aria-label={t('nav.primary')} role="navigation" className="flex items-center gap-1 sm:gap-2">
      {items.map(({ label, to, active, icon: Icon }) => (
        <Link
          key={label}
          to={to}
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          title={label}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${active ? 'bg-blue-50 font-medium text-blue-600' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
        >
          <Icon size={17} aria-hidden="true" />
          <span className={labelClass}>{label}</span>
        </Link>
      ))}
    </div>
  );
};
