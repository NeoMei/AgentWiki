// @vitest-environment node

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import playwrightConfig from './playwright.config';
import viteConfig from './vite.config.ts';

describe('local development target contract', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('binds Vite locally and defaults both proxies to the local API', () => {
    expect(typeof viteConfig).toBe('object');
    const config = viteConfig as any;
    expect(config.server?.host).toBe('127.0.0.1');
    expect(config.server?.proxy?.['/api']?.target).toBe('http://127.0.0.1:3000');
    expect(config.server?.proxy?.['/socket.io']?.target).toBe('http://127.0.0.1:3000');
  });

  it('pins standard client commands to the TypeScript Vite config', () => {
    const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
    expect(packageJson.scripts.dev).toContain('--config vite.config.ts');
    expect(packageJson.scripts.build).toContain('--config vite.config.ts');
    expect(packageJson.scripts.preview).toContain('--config vite.config.ts');
  });

  it('defaults Playwright and its API fixture to loopback targets', () => {
    expect((playwrightConfig as any).use?.baseURL).toBe('http://127.0.0.1:5173');
    const e2eSource = readFileSync(new URL('./e2e/editor-language.spec.ts', import.meta.url), 'utf8');
    expect(e2eSource).toContain("'http://127.0.0.1:3000/api/'");
    expect(e2eSource).not.toContain('100.64.35.78');
  });

  it('fails closed before Playwright starts for a remote URL without explicit opt-in and does not echo secrets', async () => {
    vi.stubEnv('AGENTWIKI_WEB_URL', 'https://example.test:7443/?token=super-secret');
    vi.stubEnv('ALLOW_REMOTE_E2E', '');
    vi.resetModules();

    let thrown: unknown;
    try {
      await import('./playwright.config.ts');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/ALLOW_REMOTE_E2E=true/);
    expect((thrown as Error).message).not.toMatch(/example\.test|super-secret/);
  });

  it('allows an explicitly opted-in remote Playwright target', async () => {
    vi.stubEnv('AGENTWIKI_WEB_URL', 'https://qa.example.test:7443');
    vi.stubEnv('ALLOW_REMOTE_E2E', 'true');
    vi.resetModules();

    const configured = (await import('./playwright.config.ts')).default as any;
    expect(configured.use?.baseURL).toBe('https://qa.example.test:7443');
  });
});
