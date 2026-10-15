import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Navbar } from './Navbar';
import { isWorkspacePath } from '../features/space-workspace/workspaceNavigation';

export const Layout: React.FC = () => {
  const location = useLocation();
  const edgeToEdgeWorkspace = isWorkspacePath(location.pathname);
  const mainClassName = edgeToEdgeWorkspace ? 'w-full' : 'container mx-auto px-4 py-8';
  return (
    <div className={`min-h-screen ${edgeToEdgeWorkspace ? 'bg-white' : 'bg-gray-50'}`}>
      <Navbar />
      <main className={mainClassName}>
        <Outlet />
      </main>
    </div>
  );
};
