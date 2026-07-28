import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bot, ChevronDown, ClipboardCheck, FolderOpen, Info, LogOut, Plug, Search, User, BookOpen } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import api from '../api/client';
import { useLanguage } from '../context/LanguageContext';
import { LanguageSwitcher } from './LanguageSwitcher';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [reviewCount, setReviewCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get('/review').then((response) => setReviewCount(response.data.filter((item: any) => item.status === 'pending_review').length)).catch(() => setReviewCount(0));
  }, [location.pathname]);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const active = (path: string) => path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);
  const navClass = (path: string) => `flex items-center gap-1.5 text-sm transition ${active(path) ? 'text-blue-600 font-medium' : 'text-gray-600 hover:text-blue-600'}`;

  return (
    <nav className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-40">
      <div className="flex items-center gap-4 sm:gap-6 min-w-0">
        <Link to="/dashboard" className="text-xl font-bold text-blue-600 shrink-0">AgentWiki</Link>
        <Link to="/dashboard" className={navClass('/dashboard')} title={t('nav.spaces')}><FolderOpen size={18} /><span className="hidden sm:inline">{t('nav.spaces')}</span></Link>
        <Link to="/agents" className={navClass('/agents')} title={t('nav.agents')}><Bot size={18} /><span className="hidden sm:inline">{t('nav.agents')}</span></Link>
        <Link to="/review" className={navClass('/review')}>
          <ClipboardCheck size={18} /><span className="hidden sm:inline">{t('nav.review')}</span>
          {reviewCount > 0 ? <span className="min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[11px] flex items-center justify-center">{reviewCount > 99 ? '99+' : reviewCount}</span> : null}
        </Link>
      </div>
      <div className="flex items-center gap-2 sm:gap-4">
        <Link to="/search" className={`p-2 rounded transition ${active('/search') ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`} title={t('common.search')}><Search size={20} /></Link>
        <LanguageSwitcher compact />
        <div className="relative" ref={menuRef}>
          <button onClick={() => setMenuOpen((value) => !value)} className="flex items-center gap-2 p-1 rounded-lg hover:bg-gray-100" aria-expanded={menuOpen} aria-label={t('nav.personalMenu')}>
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center"><User size={18} className="text-blue-600" /></div>
            <span className="text-sm hidden md:inline max-w-32 truncate">{user?.name || user?.email}</span><ChevronDown size={14} className="text-gray-400" />
          </button>
          {menuOpen ? <div className="absolute right-0 mt-2 w-56 bg-white border rounded-xl shadow-lg p-2 z-50">
            <p className="px-3 py-2 text-xs text-gray-400 truncate">{user?.email}</p>
            <Link onClick={() => setMenuOpen(false)} to="/profile" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-gray-50"><User size={16} /> {t('nav.profile')}</Link>
            <Link onClick={() => setMenuOpen(false)} to="/settings/integrations" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-gray-50"><Plug size={16} /> {t('nav.integrations')}</Link>
            <Link onClick={() => setMenuOpen(false)} to="/guide" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-gray-50"><BookOpen size={16} /> {t('nav.guide')}</Link>
            <Link onClick={() => setMenuOpen(false)} to="/" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-gray-50"><Info size={16} /> {t('nav.about')}</Link>
            <button onClick={() => { logout(); navigate('/'); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50"><LogOut size={16} /> {t('nav.logout')}</button>
          </div> : null}
        </div>
      </div>
    </nav>
  );
};
