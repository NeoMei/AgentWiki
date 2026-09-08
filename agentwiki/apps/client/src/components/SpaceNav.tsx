import React from 'react';
import { Activity, Database, FileText, Network, Settings, Users, Workflow } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { workspaceSectionFromPath, type SpaceNavSection } from '../features/space-workspace/workspaceNavigation';

const ITEMS = [
  { key: 'pages', labelKey: 'space.pages', suffix: '', icon: FileText },
  { key: 'graph', labelKey: 'space.graph', suffix: '/graph', icon: Network },
  { key: 'sources', labelKey: 'space.sources', suffix: '/sources', icon: Database },
  { key: 'runs', labelKey: 'space.runs', suffix: '/runs', icon: Activity },
  { key: 'collaboration', labelKey: 'space.collaboration', suffix: '/collaboration', icon: Workflow },
  { key: 'members', labelKey: 'space.members', suffix: '/members', icon: Users },
  { key: 'settings', labelKey: 'space.settings', suffix: '/settings', icon: Settings },
] as const;

export const SpaceNav: React.FC<{ spaceId?: string; activeSection?: SpaceNavSection; embedded?: boolean }> = ({ spaceId, activeSection, embedded = false }) => {
  const { t } = useLanguage();
  const location = useLocation();
  if (!spaceId) return null;
  const selectedSection = activeSection ?? workspaceSectionFromPath(location.pathname);
  return (
    <nav aria-label={t('space.navigation')} className={`${embedded ? '' : 'mb-6 border-b'} overflow-x-auto`}>
      <div className="flex min-w-max gap-1">
        {ITEMS.map(({ key, labelKey, suffix, icon: Icon }) => (
          <Link
            key={key}
            to={`/spaces/${spaceId}${suffix}`}
            aria-current={selectedSection === key ? 'page' : undefined}
            className={`flex items-center gap-2 px-3 py-3 border-b-2 text-sm transition ${
              selectedSection === key ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <Icon size={16} /> {t(labelKey)}
          </Link>
        ))}
      </div>
    </nav>
  );
};
