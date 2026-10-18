import { OnboardController } from './onboard.controller';

describe('public Agent connection guide', () => {
  it('advertises bounded version-pinned steps, explicit confirmation, and actual host-read verification', () => {
    const controller = new OnboardController({} as any, {} as any);
    const guide = controller.getMarkdown();
    expect(guide).toContain("@neomei/agentwiki-local-sync@0.13.2 onboard start --server 'https://agentwiki.quukk.com/api' --client generic --protocol json");
    expect(guide).toContain('--client workbuddy');
    expect(guide).toContain('Node.js 24 或 26');
    expect(guide).toContain('browserOpened:false');
    expect(guide).toContain('configurationMode');
    expect(guide).toContain('manual-import');
    expect(guide).toContain('configPath');
    expect(guide).toContain('hostActivationSteps');
    expect(guide).toContain('客户端授权');
    expect(guide).toContain('重启客户端');
    expect(guide).not.toContain('默认使用 Codex');
    expect(guide).not.toContain('clientSetupInstructions');
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
