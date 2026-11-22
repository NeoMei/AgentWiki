import { ConfigService } from '@nestjs/config';
import { agentWikiReturnTo, UniHubClient } from './unihub-client';

describe('UniHub redirect targets', () => {
  it('preserves local page and device approval destinations', () => {
    expect(agentWikiReturnTo('/pages/old-page?tab=notes#selection')).toBe('/pages/old-page?tab=notes#selection');
    expect(agentWikiReturnTo('/onboard/device?user_code=1234-ABCD')).toBe('/onboard/device?user_code=1234-ABCD');
  });

  it.each(['https://other.test', '//other.test', '/\\other.test', '/%0dtarget', '/api/auth/unihub/start', '/unihub?continue=1', '/onboard/device?unexpected=1'])('rejects %s', value => {
    expect(agentWikiReturnTo(value)).toBe('/');
  });
});

describe('UniHub pilot users', () => {
  const create = (ids: string, enabled = true) => new UniHubClient(new ConfigService({
    UNIHUB_IDENTITY_ENABLED: String(enabled),
    UNIHUB_IDENTITY_PILOT_USER_IDS: ids,
    UNIHUB_IDENTITY_API_ORIGIN: 'http://127.0.0.1:58081',
    UNIHUB_IDENTITY_PUBLIC_ORIGIN: 'http://127.0.0.1:58081',
    UNIHUB_IDENTITY_CALLBACK_URL: 'http://127.0.0.1:51793/api/auth/unihub/callback',
    UNIHUB_IDENTITY_CLIENT_ID: 'agentwiki-test',
    UNIHUB_IDENTITY_RUNTIME_TOKEN: 'local-test-secret-at-least-32-bytes',
  }));

  it('admits only listed original AgentWiki user IDs', () => {
    expect(create('old-user-a,old-user-b').allowsLocalUser('old-user-b')).toBe(true);
    expect(create('old-user-a').allowsLocalUser('old-user-b')).toBe(false);
    expect(create('').allowsLocalUser('old-user-a')).toBe(false);
    expect(create('*', false).allowsLocalUser('old-user-a')).toBe(false);
  });

  it('requires a standalone wildcard for an explicitly unrestricted rollout', () => {
    expect(create('*').allowsLocalUser('old-user-a')).toBe(true);
    expect(() => create('*,old-user-a')).toThrow('pilot user IDs');
  });
});
