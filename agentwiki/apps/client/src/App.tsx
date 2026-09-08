import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Dashboard } from './features/dashboard/Dashboard';
import { SearchResults } from './features/search/SearchResults';
import { Profile } from './features/profile/Profile';
import { ForcePasswordChange } from './features/auth/ForcePasswordChange';
import { SpaceMembers } from './features/space/SpaceMembers';
import { ProductPage } from './features/about/ProductPage';
import { UsageGuide } from './features/about/UsageGuide';
import { OnboardPage } from './features/about/OnboardPage';
import { OnboardDevicePage } from './features/about/OnboardDevicePage';
import { GuideLayout } from './features/guide/GuideLayout';
import { ObsidianGuide } from './features/guide/ObsidianGuide';
import { DocsOverview } from './features/docs/DocsOverview';
import { DocsArchitecture } from './features/docs/DocsArchitecture';
import { DocsFeatures } from './features/docs/DocsFeatures';
import { DocsSecurity } from './features/docs/DocsSecurity';
import { DocsSync } from './features/docs/DocsSync';
import { SpaceSettings } from './features/space/SpaceSettings';
import { AdminPage } from './features/admin/AdminPage';
import { SpaceWorkspace } from './features/space-workspace/SpaceWorkspace';
import {
  SpaceWorkspaceProvider,
  type SpaceWorkspaceMode,
} from './features/space-workspace/SpaceWorkspaceContext';

const AgentList = lazy(() => import('./features/agent/AgentList').then((module) => ({ default: module.AgentList })));
const AgentDetail = lazy(() => import('./features/agent/AgentDetail').then((module) => ({ default: module.AgentDetail })));
const SourcesPage = lazy(() => import('./features/source/SourcesPage').then((module) => ({ default: module.SourcesPage })));
const RunsPage = lazy(() => import('./features/source/RunsPage').then((module) => ({ default: module.RunsPage })));
const ReviewPage = lazy(() => import('./features/review/ReviewPage').then((module) => ({ default: module.ReviewPage })));
const PageEditor = lazy(() => import('./features/page/PageEditor').then((module) => ({ default: module.PageEditor })));
const PageVersionHistory = lazy(() => import('./features/page/PageVersionHistory').then((module) => ({ default: module.PageVersionHistory })));
const PagePreview = lazy(() => import('./features/page/PagePreview').then((module) => ({ default: module.PagePreview })));
const KnowledgeGraph = lazy(() => import('./features/knowledge/KnowledgeGraph').then((module) => ({ default: module.KnowledgeGraph })));
const CollaborationWorkspace = lazy(() => import('./features/collaboration/CollaborationWorkspace').then((module) => ({ default: module.CollaborationWorkspace })));
const TemplateEditor = lazy(() => import('./features/collaboration/TemplateEditor').then((module) => ({ default: module.TemplateEditor })));
const RunStartWizard = lazy(() => import('./features/collaboration/RunStartWizard').then((module) => ({ default: module.RunStartWizard })));
const RunDashboard = lazy(() => import('./features/collaboration/RunDashboard').then((module) => ({ default: module.RunDashboard })));
const PageTemplateManager = lazy(() => import('./features/page-templates/PageTemplateManager')
  .then((module) => ({ default: module.PageTemplateManager })));

const RouteLoading: React.FC = () => {
  const { t } = useLanguage();
  return <div className="py-8 text-center text-gray-500">{t('common.loading')}</div>;
};

const WorkspaceRoute: React.FC<{
  mode: SpaceWorkspaceMode;
  pageRoute?: boolean;
  children: React.ReactNode;
}> = ({ mode, pageRoute = false, children }) => {
  const { id, spaceId } = useParams<{ id?: string; spaceId?: string }>();
  return (
    <SpaceWorkspace
      mode={mode}
      spaceId={pageRoute ? undefined : (spaceId ?? id)}
      pageId={pageRoute ? id : undefined}
      showDirectory={mode !== 'section'}
    >
      {children}
    </SpaceWorkspace>
  );
};

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, user } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/?intent=workspace#login" replace />;
  if (user?.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <>{children}</>;
};

const AppRoutes: React.FC = () => {
  const { user } = useAuth();
  const workspaceUserId = typeof user?.id === 'string' && user.id ? user.id : 'authenticated';
  return (
    <SpaceWorkspaceProvider key={workspaceUserId} userId={workspaceUserId}>
    <Routes>
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/spaces/:id" element={<WorkspaceRoute mode="directory"><></></WorkspaceRoute>} />
        <Route path="/pages/:id" element={<WorkspaceRoute mode="read" pageRoute><Suspense fallback={<RouteLoading />}><PagePreview /></Suspense></WorkspaceRoute>} />
        <Route path="/pages/:id/edit" element={<WorkspaceRoute mode="edit" pageRoute><Suspense fallback={<RouteLoading />}><PageEditor /></Suspense></WorkspaceRoute>} />
        <Route path="/pages/:id/versions" element={<WorkspaceRoute mode="versions" pageRoute><Suspense fallback={<RouteLoading />}><PageVersionHistory /></Suspense></WorkspaceRoute>} />
        <Route path="/search" element={<SearchResults />} />
        <Route path="/spaces/:spaceId/graph" element={<WorkspaceRoute mode="section"><Suspense fallback={<RouteLoading />}><KnowledgeGraph /></Suspense></WorkspaceRoute>} />
        <Route path="/spaces/:id/members" element={<WorkspaceRoute mode="section"><SpaceMembers /></WorkspaceRoute>} />
        <Route path="/spaces/:id/settings" element={<WorkspaceRoute mode="section"><SpaceSettings /></WorkspaceRoute>} />
        <Route path="/spaces/:id/settings/page-templates" element={<WorkspaceRoute mode="section"><Suspense fallback={<RouteLoading />}><PageTemplateManager /></Suspense></WorkspaceRoute>} />
        <Route path="/spaces/:id/docs" element={<WorkspaceRoute mode="section"><Navigate to="../sources" relative="path" replace /></WorkspaceRoute>} />
        <Route path="/change-password" element={<ForcePasswordChange />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/agents" element={<Suspense fallback={<RouteLoading />}><AgentList /></Suspense>} />
        <Route path="/agents/:id" element={<Suspense fallback={<RouteLoading />}><AgentDetail /></Suspense>} />
        <Route path="/spaces/:id/sources" element={<WorkspaceRoute mode="section"><Suspense fallback={<RouteLoading />}><SourcesPage /></Suspense></WorkspaceRoute>} />
        <Route path="/spaces/:id/runs" element={<WorkspaceRoute mode="section"><Suspense fallback={<RouteLoading />}><RunsPage /></Suspense></WorkspaceRoute>} />
        <Route path="/spaces/:id/collaboration" element={<WorkspaceRoute mode="section"><Suspense fallback={<RouteLoading />}><CollaborationWorkspace /></Suspense></WorkspaceRoute>} />
        <Route path="/spaces/:id/collaboration/templates/new" element={<WorkspaceRoute mode="section"><Suspense fallback={<RouteLoading />}><TemplateEditor mode="create" /></Suspense></WorkspaceRoute>} />
        <Route path="/spaces/:id/collaboration/templates/:templateId" element={<WorkspaceRoute mode="section"><Suspense fallback={<RouteLoading />}><TemplateEditor mode="edit" /></Suspense></WorkspaceRoute>} />
        <Route path="/spaces/:id/collaboration/templates/:templateId/start" element={<WorkspaceRoute mode="section"><Suspense fallback={<RouteLoading />}><RunStartWizard /></Suspense></WorkspaceRoute>} />
        <Route path="/spaces/:id/collaboration/runs/:runId" element={<WorkspaceRoute mode="section"><Suspense fallback={<RouteLoading />}><RunDashboard /></Suspense></WorkspaceRoute>} />
        <Route path="/review" element={<Suspense fallback={<RouteLoading />}><ReviewPage /></Suspense>} />
        <Route path="/admin" element={<Suspense fallback={<RouteLoading />}><AdminPage /></Suspense>} />
      </Route>
      <Route path="/" element={<ProductPage />} />
      <Route path="/guide" element={<GuideLayout><UsageGuide /></GuideLayout>} />
      <Route path="/guide/agent-onboard" element={<GuideLayout><OnboardPage /></GuideLayout>} />
      <Route path="/guide/obsidian" element={<GuideLayout><ObsidianGuide /></GuideLayout>} />
      <Route path="/settings/integrations" element={<Navigate to="/guide/obsidian" replace />} />
      <Route path="/guide/docs" element={<GuideLayout><DocsOverview /></GuideLayout>} />
      <Route path="/guide/docs/architecture" element={<GuideLayout><DocsArchitecture /></GuideLayout>} />
      <Route path="/guide/docs/features" element={<GuideLayout><DocsFeatures /></GuideLayout>} />
      <Route path="/guide/docs/security" element={<GuideLayout><DocsSecurity /></GuideLayout>} />
      <Route path="/guide/docs/sync" element={<GuideLayout><DocsSync /></GuideLayout>} />
      <Route path="/onboard" element={<Navigate to="/guide/agent-onboard" replace />} />
      <Route path="/onboard/device" element={<OnboardDevicePage />} />
      <Route path="/docs" element={<Navigate to="/guide/docs" replace />} />
      <Route path="/docs/architecture" element={<Navigate to="/guide/docs/architecture" replace />} />
      <Route path="/docs/features" element={<Navigate to="/guide/docs/features" replace />} />
      <Route path="/docs/security" element={<Navigate to="/guide/docs/security" replace />} />
      <Route path="/docs/sync" element={<Navigate to="/guide/docs/sync" replace />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
    </SpaceWorkspaceProvider>
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
