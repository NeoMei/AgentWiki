import React, { lazy, Suspense, useState } from 'react';
import { RouterProvider, Routes, Route, Navigate, createBrowserRouter, createMemoryRouter, useLocation, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProductPage } from './features/about/ProductPage';
import { GuideLayout } from './features/guide/GuideLayout';
import {
  SpaceWorkspaceProvider,
  type SpaceWorkspaceMode,
} from './features/space-workspace/SpaceWorkspaceContext';
import { NavigationGuardProvider } from './features/space-workspace/workspaceNavigation';

const Dashboard = lazy(() => import('./features/dashboard/Dashboard').then((module) => ({ default: module.Dashboard })));
const SearchResults = lazy(() => import('./features/search/SearchResults').then((module) => ({ default: module.SearchResults })));
const Profile = lazy(() => import('./features/profile/Profile').then((module) => ({ default: module.Profile })));
const ForcePasswordChange = lazy(() => import('./features/auth/ForcePasswordChange').then((module) => ({ default: module.ForcePasswordChange })));
const SpaceMembers = lazy(() => import('./features/space/SpaceMembers').then((module) => ({ default: module.SpaceMembers })));
const UsageGuide = lazy(() => import('./features/about/UsageGuide').then((module) => ({ default: module.UsageGuide })));
const OnboardPage = lazy(() => import('./features/about/OnboardPage').then((module) => ({ default: module.OnboardPage })));
const OnboardDevicePage = lazy(() => import('./features/about/OnboardDevicePage').then((module) => ({ default: module.OnboardDevicePage })));
const ObsidianGuide = lazy(() => import('./features/guide/ObsidianGuide').then((module) => ({ default: module.ObsidianGuide })));
const DocsOverview = lazy(() => import('./features/docs/DocsOverview').then((module) => ({ default: module.DocsOverview })));
const DocsArchitecture = lazy(() => import('./features/docs/DocsArchitecture').then((module) => ({ default: module.DocsArchitecture })));
const DocsFeatures = lazy(() => import('./features/docs/DocsFeatures').then((module) => ({ default: module.DocsFeatures })));
const DocsSecurity = lazy(() => import('./features/docs/DocsSecurity').then((module) => ({ default: module.DocsSecurity })));
const DocsSync = lazy(() => import('./features/docs/DocsSync').then((module) => ({ default: module.DocsSync })));
const SpaceSettings = lazy(() => import('./features/space/SpaceSettings').then((module) => ({ default: module.SpaceSettings })));
const AdminPage = lazy(() => import('./features/admin/AdminPage').then((module) => ({ default: module.AdminPage })));
const SpaceWorkspace = lazy(() => import('./features/space-workspace/SpaceWorkspace').then((module) => ({ default: module.SpaceWorkspace })));

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

const NewContentPage = lazy(() => import('./features/page-templates/NewContentPage').then((module) => ({ default: module.NewContentPage })));

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
    <Suspense fallback={<RouteLoading />}><SpaceWorkspace
      mode={mode}
      spaceId={pageRoute ? undefined : (spaceId ?? id)}
      pageId={pageRoute ? id : undefined}
      showDirectory={mode !== 'section'}
    >
      {children}
    </SpaceWorkspace></Suspense>
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
        <Route path="/dashboard" element={<Suspense fallback={<RouteLoading />}><Dashboard /></Suspense>} />
        <Route path="/spaces/:id/new" element={<WorkspaceRoute mode="section"><Suspense fallback={<RouteLoading />}><NewContentPage /></Suspense></WorkspaceRoute>} />
        <Route path="/spaces/:id" element={<WorkspaceRoute mode="directory"><></></WorkspaceRoute>} />
        <Route path="/pages/:id" element={<WorkspaceRoute mode="read" pageRoute><Suspense fallback={<RouteLoading />}><PagePreview /></Suspense></WorkspaceRoute>} />
        <Route path="/pages/:id/edit" element={<WorkspaceRoute mode="edit" pageRoute><Suspense fallback={<RouteLoading />}><PageEditor /></Suspense></WorkspaceRoute>} />
        <Route path="/pages/:id/versions" element={<WorkspaceRoute mode="versions" pageRoute><Suspense fallback={<RouteLoading />}><PageVersionHistory /></Suspense></WorkspaceRoute>} />
        <Route path="/search" element={<Suspense fallback={<RouteLoading />}><SearchResults /></Suspense>} />
        <Route path="/spaces/:spaceId/graph" element={<WorkspaceRoute mode="section"><Suspense fallback={<RouteLoading />}><KnowledgeGraph /></Suspense></WorkspaceRoute>} />
        <Route path="/spaces/:id/members" element={<WorkspaceRoute mode="section"><Suspense fallback={<RouteLoading />}><SpaceMembers /></Suspense></WorkspaceRoute>} />
        <Route path="/spaces/:id/settings" element={<WorkspaceRoute mode="section"><Suspense fallback={<RouteLoading />}><SpaceSettings /></Suspense></WorkspaceRoute>} />
        <Route path="/spaces/:id/settings/page-templates" element={<WorkspaceRoute mode="section"><Suspense fallback={<RouteLoading />}><PageTemplateManager /></Suspense></WorkspaceRoute>} />
        <Route path="/spaces/:id/docs" element={<WorkspaceRoute mode="section"><Navigate to="../sources" relative="path" replace /></WorkspaceRoute>} />
        <Route path="/change-password" element={<Suspense fallback={<RouteLoading />}><ForcePasswordChange /></Suspense>} />
        <Route path="/profile" element={<Suspense fallback={<RouteLoading />}><Profile /></Suspense>} />
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
      <Route path="/guide" element={<GuideLayout><Suspense fallback={<RouteLoading />}><UsageGuide /></Suspense></GuideLayout>} />
      <Route path="/guide/agent-onboard" element={<GuideLayout><Suspense fallback={<RouteLoading />}><OnboardPage /></Suspense></GuideLayout>} />
      <Route path="/guide/obsidian" element={<GuideLayout><Suspense fallback={<RouteLoading />}><ObsidianGuide /></Suspense></GuideLayout>} />
      <Route path="/settings/integrations" element={<Navigate to="/guide/obsidian" replace />} />
      <Route path="/guide/docs" element={<GuideLayout><Suspense fallback={<RouteLoading />}><DocsOverview /></Suspense></GuideLayout>} />
      <Route path="/guide/docs/architecture" element={<GuideLayout><Suspense fallback={<RouteLoading />}><DocsArchitecture /></Suspense></GuideLayout>} />
      <Route path="/guide/docs/features" element={<GuideLayout><Suspense fallback={<RouteLoading />}><DocsFeatures /></Suspense></GuideLayout>} />
      <Route path="/guide/docs/security" element={<GuideLayout><Suspense fallback={<RouteLoading />}><DocsSecurity /></Suspense></GuideLayout>} />
      <Route path="/guide/docs/sync" element={<GuideLayout><Suspense fallback={<RouteLoading />}><DocsSync /></Suspense></GuideLayout>} />
      <Route path="/onboard" element={<Navigate to="/guide/agent-onboard" replace />} />
      <Route path="/onboard/device" element={<Suspense fallback={<RouteLoading />}><OnboardDevicePage /></Suspense>} />
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

const AppProviders: React.FC = () => (
  <LanguageProvider>
    <ErrorBoundary>
      <AuthProvider>
        <NavigationGuardProvider>
          <AppRoutes />
        </NavigationGuardProvider>
      </AuthProvider>
    </ErrorBoundary>
  </LanguageProvider>
);

const appShellRoutes = [{
  path: '*',
  element: <AppProviders />,
}];

export const createAppRouter = () => createBrowserRouter(appShellRoutes);
export const createAppMemoryRouter = (initialEntry: string) => createMemoryRouter(
  appShellRoutes,
  { initialEntries: [initialEntry] },
);

function App({ router: suppliedRouter }: { router?: ReturnType<typeof createAppRouter> } = {}) {
  const [router] = useState(() => suppliedRouter ?? createAppRouter());
  return (
    <RouterProvider router={router} />
  );
}

export default App;
