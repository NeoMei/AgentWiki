import { defineConfig } from '@playwright/test';
import { resolveE2ETarget } from './src/config/localTargets';

const baseURL = resolveE2ETarget({
  configured: process.env.AGENTWIKI_WEB_URL,
  fallback: 'http://127.0.0.1:5173',
  allowRemote: process.env.ALLOW_REMOTE_E2E,
  confirmRemoteHost: process.env.CONFIRM_REMOTE_E2E_HOST,
  label: 'Playwright web target',
});

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL,
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  reporter: 'list',
});
