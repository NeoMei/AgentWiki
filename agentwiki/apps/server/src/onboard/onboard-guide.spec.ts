import { OnboardController } from './onboard.controller';

describe('public Agent connection guide', () => {
  it('advertises bounded version-pinned steps, explicit confirmation, and actual host-read verification', () => {
    const controller = new OnboardController({} as any, {} as any);
    const guide = controller.getMarkdown();
    expect(guide).toContain("@neomei/agentwiki-local-sync@0.10.0 onboard start --server 'https://agentwiki.quukk.com/api' --client codex --protocol json");
    expect(guide).toContain('onboard continue --session <sessionId> --reply-file <absolute-json-file> --protocol json');
    expect(guide).toContain('onboard status --session <sessionId> --protocol json');
    expect(guide).toContain('planHash'); expect(guide).toContain('0600'); expect(guide).toContain('hostVerification');
    expect(guide).toContain('Legacy NDJSON');
    expect(guide).not.toContain('sourcePaths'); expect(guide).not.toContain('onboard --server');
    expect(guide).toMatch(/authorization_expired.*不带 --reply-file.*continue.*authorization_required.*authorizationUrl/);
    expect(guide).toMatch(/authorization_expired.*continue.*without --reply-file.*authorization_required.*authorizationUrl/);
    expect(controller.getJsonRedirect().replacement).toContain('onboard start');
  });
});
