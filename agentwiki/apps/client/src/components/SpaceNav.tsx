import React from 'react';
import { Activity, Database, FileText, Network, Settings, Users } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';

const ITEMS = [
  { key: 'pages', labelKey: 'space.pages', suffix: '', icon: FileText },
  { key: 'graph', labelKey: 'space.graph', suffix: '/graph', icon: Network },
  { key: 'sources', labelKey: 'space.sources', suffix: '/sources', icon: Database },
  { key: 'runs', labelKey: 'space.runs', suffix: '/runs', icon: Activity },
  { key: 'members', labelKey: 'space.members', suffix: '/members', icon: Users },
  { key: 'settings', labelKey: 'space.settings', suffix: '/settings', icon: Settings },
] as const;

export const SpaceNav: React.FC<{ spaceId?: string }> = ({ spaceId }) => {
  const { t } = useLanguage();
  if (!spaceId) return null;
  return (
    <nav aria-label={t('space.navigation')} className="mb-6 overflow-x-auto border-b">
      <div className="flex min-w-max gap-1">
        {ITEMS.map(({ key, labelKey, suffix, icon: Icon }) => (
          <NavLink
            key={key}
            to={`/spaces/${spaceId}${suffix}`}
            end={!suffix}
            className={({ isActive }) => `flex items-center gap-2 px-3 py-3 border-b-2 text-sm transition ${
              isActive ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <Icon size={16} /> {t(labelKey)}
          </NavLink>
        ))}
      </div>
    </nav>
  );
};
