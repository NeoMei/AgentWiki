import { readFileSync } from 'node:fs';
import { expect, type APIRequestContext } from '@playwright/test';

export const localSyncPackage = JSON.parse(
  readFileSync(new URL('../../../../packages/local-sync/package.json', import.meta.url), 'utf8'),
) as { name: string; version: string };

export async function expectPinnedRuntimePreparation(request: APIRequestContext, apiOrigin: string) {
  const url = new URL(`${apiOrigin}/onboard/runtime`);
  url.searchParams.set('client', 'codex');
  url.searchParams.set('packageVersion', localSyncPackage.version);
  const response = await request.get(url.href, { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/plain');
  const guide = await response.text();
  expect(guide).toContain(`${localSyncPackage.name}@${localSyncPackage.version}`);
  expect(guide).toContain(`Package version: ${localSyncPackage.version}`);
  expect(guide).toContain('nodePath');
  expect(guide).toContain('cliPath');
}
