import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: process.env.AGENTWIKI_WEB_URL || 'http://100.64.35.78:5173',
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  reporter: 'list',
});
