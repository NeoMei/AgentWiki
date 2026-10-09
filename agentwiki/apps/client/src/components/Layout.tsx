import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Navbar } from './Navbar';
import { isWorkspacePath } from '../features/space-workspace/workspaceNavigation';

export const Layout: React.FC = () => {
  const location = useLocation();
  const documentPage = /^\/pages\/[^/]+(?:\/edit)?\/?$/u.test(location.pathname);
  const mainClassName = documentPage ? 'w-full' : isWorkspacePath(location.pathname)
    ? 'w-full px-4 py-8'
    : 'container mx-auto px-4 py-8';
  return (
    <div className={`min-h-screen ${documentPage ? 'bg-white' : 'bg-gray-50'}`}>
      <Navbar />
      <main className={mainClassName}>
        <Outlet />
      </main>
    </div>
  );
};
