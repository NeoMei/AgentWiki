/// <reference types="vite/client" />
// Local acceptance harness: real ProductPage, synthetic transport, no account writes.
import React, { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import api from '../../src/api/client';
import { LanguageProvider } from '../../src/context/LanguageContext';
import { ProductPage } from '../../src/features/about/ProductPage';
import '../../src/index.css';

const scenarios = {
  duplicate: '邮箱已注册 · 409 AUTH_EMAIL_IN_USE',
  'duplicate-legacy': '旧接口邮箱已注册 · 409 RESOURCE_CONFLICT',
  'invalid-server': '服务端邮箱格式错误 · 400 BAD_REQUEST',
  'unknown-server': '未知服务端错误 · 400 BAD_REQUEST',
  success: '模拟成功 · 200（不写入账户信息）',
} as const;
type Scenario = keyof typeof scenarios;
const requestedScenario = new URLSearchParams(window.location.search).get('scenario');
let scenario: Scenario = requestedScenario && Object.prototype.hasOwnProperty.call(scenarios, requestedScenario)
  ? requestedScenario as Scenario : 'duplicate';

interface RequestRecord { method: string; url: string; status: number }
let requests: RequestRecord[] = [];
const listeners = new Set<() => void>();
const publish = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const record = (config: InternalAxiosRequestConfig, status: number) => {
  // Never retain the request body, email, password, or Authorization header.
  requests = [...requests, { method: (config.method ?? 'get').toUpperCase(), url: config.url ?? '', status }];
  publish();
};
const reject = (config: InternalAxiosRequestConfig, status: number, data: unknown): never => {
  record(config, status);
  throw new AxiosError('Synthetic registration response', 'ERR_BAD_REQUEST', config, undefined, {
    data, status, statusText: status === 409 ? 'Conflict' : 'Bad Request', headers: {}, config,
  });
};

// The production request interceptor reads the stored user token. This isolated
// page has no need for it; all traffic stays inside the adapter below.
api.interceptors.request.clear();
api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
  const url = config.url ?? '';
  if (config.method !== 'post' || (url !== '/auth/register' && url !== '/auth/login')) {
    return reject(config, 400, { code: 'FIXTURE_UNEXPECTED_REQUEST', message: 'This fixture does not allow this request.' });
  }
  if (url === '/auth/register') {
    if (scenario === 'duplicate') return reject(config, 409, {
      statusCode: 409, code: 'AUTH_EMAIL_IN_USE', message: 'Email already in use',
    });
    if (scenario === 'duplicate-legacy') return reject(config, 409, {
      statusCode: 409, code: 'RESOURCE_CONFLICT', message: 'Email already in use',
    });
  }
  if (scenario === 'invalid-server') return reject(config, 400, {
    statusCode: 400, code: 'BAD_REQUEST', message: 'email must be an email', error: 'Bad Request',
  });
  if (scenario === 'unknown-server') return reject(config, 400, {
    statusCode: 400, code: 'BAD_REQUEST', message: 'An unrelated validation failed', error: 'Bad Request',
  });
  record(config, 200);
  return {
    data: { access_token: 'inert-fixture-value', user: { id: 'fixture-user', name: '本地验收用户', email: 'fixture@example.test' } },
    status: 200, statusText: 'OK', headers: {}, config,
  };
};

function Fixture() {
  const [activeScenario, setActiveScenario] = useState(scenario);
  const [revision, setRevision] = useState(0);
  const requestLog = useSyncExternalStore(subscribe, () => requests);
  const lastRequest = requestLog[requestLog.length - 1];
  const reset = (nextScenario: Scenario) => {
    scenario = nextScenario;
    setActiveScenario(nextScenario);
    requests = [];
    publish();
    setRevision(value => value + 1);
  };
  return <>
    <aside aria-label="本地注册验收工具" className="border-b border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-3">
        <strong>本地注册验收 · 合成接口</strong>
        <label className="flex flex-wrap items-center gap-2">
          场景
          <select aria-label="验收场景" value={activeScenario}
            onChange={event => reset(event.target.value as Scenario)}
            className="max-w-full rounded border border-indigo-200 bg-white px-2 py-1">
            {Object.entries(scenarios).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <span>注册请求：<output data-testid="registration-requests" aria-live="polite">{requestLog.filter(item => item.url === '/auth/register').length}</output></span>
        <span>登录请求：<output data-testid="login-requests" aria-live="polite">{requestLog.filter(item => item.url === '/auth/login').length}</output></span>
        <span>总请求：<output data-testid="total-requests" aria-live="polite">{requestLog.length}</output></span>
        <button type="button" className="rounded border border-indigo-300 bg-white px-3 py-1 hover:bg-indigo-100"
          onClick={() => reset(activeScenario)}>重置验收</button>
      </div>
      <p className="mx-auto mt-2 max-w-7xl text-xs text-indigo-700">不连接真实接口；访客上下文不读取或更改 token / user。中英文使用页面右上角语言按钮切换。成功场景只验证路由跳转。</p>
      {requestLog.length > 0 && <output data-testid="last-request" className="mx-auto mt-1 block max-w-7xl text-xs">
        最后请求：{lastRequest?.method} {lastRequest?.url} → {lastRequest?.status}
      </output>}
    </aside>
    {/* AuthContext's default guest state is intentional. The real AuthProvider
        reads/writes account storage and resets workspace state; its private
        context cannot be injected without changing production source. */}
    <MemoryRouter key={revision} initialEntries={['/?intent=workspace#login']}>
      <Routes>
        <Route path="/" element={<ProductPage />} />
        <Route path="/dashboard" element={<main className="mx-auto max-w-xl p-8">
          <h1 className="text-2xl font-semibold">模拟成功：已跳转工作台</h1>
          <p className="my-4">真实注册组件已收到模拟响应并完成导航；未建立真实登录会话。</p>
          <button type="button" onClick={() => reset(activeScenario)} className="rounded bg-blue-600 px-4 py-2 text-white">重新验收</button>
        </main>} />
        <Route path="*" element={<main className="p-8">该链接不属于注册验收范围。<button type="button" onClick={() => reset(activeScenario)}>返回验收页面</button></main>} />
      </Routes>
    </MemoryRouter>
  </>;
}

const root = createRoot(document.getElementById('root')!);
root.render(<LanguageProvider><Fixture /></LanguageProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
