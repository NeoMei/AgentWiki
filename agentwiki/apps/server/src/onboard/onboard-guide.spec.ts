import { OnboardController } from './onboard.controller';

describe('public Agent connection guide', () => {
  it('advertises bounded version-pinned steps, explicit confirmation, and actual host-read verification', () => {
    const controller = new OnboardController({} as any, {} as any);
    const guide = controller.getMarkdown();
    expect(guide).toContain("@neomei/agentwiki-local-sync@0.13.3 onboard start --server 'https://agentwiki.quukk.com/api' --client generic --protocol json");
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

  it('explains in both languages how to retrieve browser approval and refresh expired replies', () => {
    const guide = new OnboardController({} as any, {} as any).getMarkdown();
    expect(guide).toContain('CLI onboard status 只读取本地检查点，不会联系服务器');
    expect(guide).toContain('不能靠反复 status 等待授权');
    expect(guide).toContain('CLI onboard status only reads the local checkpoint and does not contact the server');
    expect(guide).toContain('Repeated status calls cannot observe approval');
    expect(guide).toMatch(/retryAfterMs 后必须执行不带 --reply-file 的 continue.*领取浏览器批准结果/);
    expect(guide).toMatch(/after retryAfterMs, run continue without --reply-file to retrieve browser approval/);
    expect(guide).toContain('仍为 authorization_required 时按新的 retryAfterMs 再 continue');
    expect(guide).toContain('If authorization_required remains, wait the updated retryAfterMs and run continue again');
    expect(guide).toContain('browserOpened:false 或用户确认页面未出现时');
    expect(guide).toContain('browserOpened:false or the user confirms no page appeared');
    expect(guide).toMatch(/replyExpiresAt 过期时.*不带 --reply-file 的 continue 获取新请求.*不能仅查询 status/);
    expect(guide).toMatch(/After replyExpiresAt, run continue without --reply-file to obtain a fresh request; status alone cannot refresh it/);
  });

  it('verifies current host connectivity and page access without treating historical state as identity', () => {
    const guide = new OnboardController({} as any, {} as any).getMarkdown();
    expect(guide).toContain('onboard_status（空参数）');
    expect(guide).toContain('onboard_status with empty arguments');
    for (const field of ['gateway.status', 'gateway.clientReloadRequired', 'gateway.recovery']) {
      expect(guide.match(new RegExp(field.replace('.', '\\.'), 'g'))).toHaveLength(2);
    }
    expect(guide).toContain('顶层字段是历史安装记录，不用于验证当前身份或连接');
    expect(guide).toContain('Top-level fields describe historical installation, not the current identity or connection');
    expect(guide).toMatch(/wiki_list_spaces.*当前空间权限.*wiki_get_page.*已知页面.*标题和内容/);
    expect(guide).toMatch(/wiki_list_spaces.*current Space access.*wiki_get_page.*known page.*title and contents/);
    expect(guide).not.toContain('wiki_identity');
  });
});
