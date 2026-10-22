import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import api from '../../src/api/client';
import { AuthProvider } from '../../src/context/AuthContext';
import { LanguageProvider } from '../../src/context/LanguageContext';
import { SpaceSettings } from '../../src/features/space/SpaceSettings';
import '../../src/index.css';

// Synthetic persistence after Axios JSON serialization. No backend is contacted.
const key = 'fixture-space-settings';
const initial = { id: 'fixture-settings', name: 'Fixture Space', description: 'Original description', approvalPolicy: 'always-review', members: [{ userId: 'fixture-owner', role: 'owner' }] };
api.defaults.adapter = async (config) => {
  let data: unknown;
  if (config.url === '/spaces/fixture-settings' && config.method === 'get') {
    data = JSON.parse(sessionStorage.getItem(key) ?? JSON.stringify(initial));
  } else if (config.url === '/spaces/fixture-settings' && config.method === 'patch') {
    const persisted = JSON.parse(sessionStorage.getItem(key) ?? JSON.stringify(initial));
    data = { ...persisted, ...JSON.parse(config.data) };
    sessionStorage.setItem(key, JSON.stringify(data));
    sessionStorage.setItem(`${key}-last-patch`, config.data);
  } else if (config.url === '/spaces/fixture-settings/graph/settings' && config.method === 'get') {
    data = { wikilinkEnabled: true, similarEnabled: false, similarThreshold: 0.86, llmEnabled: false };
  } else if (config.url === '/spaces/fixture-settings/page-templates' && config.method === 'get') {
    data = { system: [], space: [], totalSpace: 0, skip: 0, take: 1, capabilities: { canManage: false } };
  } else throw new Error(`Unsupported synthetic request: ${config.method} ${config.url}`);
  return { config, status: 200, statusText: 'OK', headers: {}, data };
};
localStorage.setItem('user', JSON.stringify({ id: 'fixture-owner', name: 'Fixture owner' }));
const root = createRoot(document.getElementById('root')!);
root.render(<AuthProvider><LanguageProvider><MemoryRouter initialEntries={['/spaces/fixture-settings/settings']}>
  <Routes><Route path="/spaces/:id/settings" element={<SpaceSettings />} /></Routes>
</MemoryRouter></LanguageProvider></AuthProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
