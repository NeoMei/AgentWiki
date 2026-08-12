import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Dashboard } from './features/dashboard/Dashboard';
import { SpaceView } from './features/space/SpaceView';
import { SearchResults } from './features/search/SearchResults';
import { Profile } from './features/profile/Profile';
import { ForcePasswordChange } from './features/auth/ForcePasswordChange';
import { SpaceMembers } from './features/space/SpaceMembers';
import { ProductPage } from './features/about/ProductPage';
import { UsageGuide } from './features/about/UsageGuide';
import { OnboardPage } from './features/about/OnboardPage';
import { OnboardDevicePage } from './features/about/OnboardDevicePage';
import { DocsOverview } from './features/docs/DocsOverview';
import { DocsArchitecture } from './features/docs/DocsArchitecture';
import { DocsFeatures } from './features/docs/DocsFeatures';
import { DocsSecurity } from './features/docs/DocsSecurity';
import { DocsSync } from './features/docs/DocsSync';
import { SpaceSettings } from './features/space/SpaceSettings';
import { AdminPage } from './features/admin/AdminPage';

const AgentList = lazy(() => import('./features/agent/AgentList').then((module) => ({ default: module.AgentList })));
const AgentDetail = lazy(() => import('./features/agent/AgentDetail').then((module) => ({ default: module.AgentDetail })));
const SourcesPage = lazy(() => import('./features/source/SourcesPage').then((module) => ({ default: module.SourcesPage })));
const RunsPage = lazy(() => import('./features/source/RunsPage').then((module) => ({ default: module.RunsPage })));
const ReviewPage = lazy(() => import('./features/review/ReviewPage').then((module) => ({ default: module.ReviewPage })));
const IntegrationsPage = lazy(() => import('./features/integrations/IntegrationsPage').then((module) => ({ default: module.IntegrationsPage })));
const PageEditor = lazy(() => import('./features/page/PageEditor').then((module) => ({ default: module.PageEditor })));
const PageVersionHistory = lazy(() => import('./features/page/PageVersionHistory').then((module) => ({ default: module.PageVersionHistory })));
const PagePreview = lazy(() => import('./features/page/PagePreview').then((module) => ({ default: module.PagePreview })));
const KnowledgeGraph = lazy(() => import('./features/knowledge/KnowledgeGraph').then((module) => ({ default: module.KnowledgeGraph })));

const RouteLoading: React.FC = () => {
  const { t } = useLanguage();
  return <div className="py-8 text-center text-gray-500">{t('common.loading')}</div>;
};

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token } = useAuth();
  return token ? <>{children}</> : <Navigate to="/?intent=workspace#login" replace />;
};

const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/spaces/:id" element={<SpaceView />} />
        <Route path="/pages/:id" element={<Suspense fallback={<RouteLoading />}><PagePreview /></Suspense>} />
        <Route path="/pages/:id/edit" element={<Suspense fallback={<RouteLoading />}><PageEditor /></Suspense>} />
        <Route path="/pages/:id/versions" element={<Suspense fallback={<RouteLoading />}><PageVersionHistory /></Suspense>} />
        <Route path="/search" element={<SearchResults />} />
        <Route path="/spaces/:spaceId/graph" element={<Suspense fallback={<RouteLoading />}><KnowledgeGraph /></Suspense>} />
        <Route path="/spaces/:id/members" element={<SpaceMembers />} />
        <Route path="/spaces/:id/settings" element={<SpaceSettings />} />
        <Route path="/spaces/:id/docs" element={<Navigate to="../sources" relative="path" replace />} />
        <Route path="/change-password" element={<ForcePasswordChange />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/agents" element={<Suspense fallback={<RouteLoading />}><AgentList /></Suspense>} />
        <Route path="/agents/:id" element={<Suspense fallback={<RouteLoading />}><AgentDetail /></Suspense>} />
        <Route path="/spaces/:id/sources" element={<Suspense fallback={<RouteLoading />}><SourcesPage /></Suspense>} />
        <Route path="/spaces/:id/runs" element={<Suspense fallback={<RouteLoading />}><RunsPage /></Suspense>} />
        <Route path="/review" element={<Suspense fallback={<RouteLoading />}><ReviewPage /></Suspense>} />
        <Route path="/admin" element={<Suspense fallback={<RouteLoading />}><AdminPage /></Suspense>} />
        <Route path="/settings/integrations" element={<Suspense fallback={<RouteLoading />}><IntegrationsPage /></Suspense>} />
      </Route>
      <Route path="/" element={<ProductPage />} />
      <Route path="/guide" element={<UsageGuide />} />
      <Route path="/docs" element={<DocsOverview />} />
      <Route path="/docs/architecture" element={<DocsArchitecture />} />
      <Route path="/docs/features" element={<DocsFeatures />} />
      <Route path="/docs/security" element={<DocsSecurity />} />
      <Route path="/docs/sync" element={<DocsSync />} />
      <Route path="/onboard" element={<OnboardPage />} />
      <Route path="/onboard/device" element={<OnboardDevicePage />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
};

function App() {
  return (
    <BrowserRouter>
      <LanguageProvider>
        <ErrorBoundary>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </ErrorBoundary>
      </LanguageProvider>
    </BrowserRouter>
  );
}

export default App;
