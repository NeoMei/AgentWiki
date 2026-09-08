import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Navbar } from './Navbar';
import { isWorkspacePath } from '../features/space-workspace/workspaceNavigation';

export const Layout: React.FC = () => {
  const location = useLocation();
  const mainClassName = isWorkspacePath(location.pathname)
    ? 'w-full px-4 py-8'
    : 'container mx-auto px-4 py-8';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className={mainClassName}>
        <Outlet />
      </main>
    </div>
  );
};
