import { BadRequestException } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CURRENT_LOCAL_SYNC_VERSION } from '../core/local-sync-version';
import { OnboardController } from './onboard.controller';

describe('public Agent connection guide', () => {
  it('runs the guide installer once and returns the same launch paths when npm is unavailable', () => {
    const controller = new OnboardController({} as any, {} as any);
    const source = controller.getRuntime('codex').match(/\x60\x60\x60js\n([\s\S]+?)\n\x60\x60\x60/)?.[1];
    expect(source).toBeDefined();
    const home = mkdtempSync(join(tmpdir(), 'agentwiki runtime '));
    try {
      const script = join(home, 'prepare.cjs');
      const npm = join(home, 'npm-cli.js');
      const log = join(home, 'install.log');
      writeFileSync(script, source!);
      writeFileSync(npm, `
        const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs');
        const { join } = require('node:path');
        const args = process.argv.slice(2);
        if (args[0] === '--version') {
          console.log('11.0.0');
          process.exit(0);
        }
        const [command, prefixFlag, prefix, spec] = args;
        if (command !== 'install' || prefixFlag !== '--prefix') process.exit(1);
        const [name, version] = spec.split(/@(?=[^@]+$)/);
        appendFileSync(${JSON.stringify(log)}, spec + '\\n');
        const pkg = join(prefix, 'node_modules', name);
        mkdirSync(join(pkg, 'dist'), { recursive: true });
        writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name, version }));
        writeFileSync(join(pkg, 'dist', 'cli.js'), '');
      `);
      const run = (npmPath: string) => JSON.parse(execFileSync(process.execPath, [script, npmPath], {
        encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home },
      }));
      const first = run(npm);
      const second = run(join(home, 'missing', 'npm-cli.js'));
      expect(second).toEqual(first);
      expect(first.version).toBe(CURRENT_LOCAL_SYNC_VERSION);
      expect(first.cliPath).toBe(join(home, '.agentwiki', 'runtime', `local-sync-${CURRENT_LOCAL_SYNC_VERSION}`,
        'node_modules', '@neomei', 'agentwiki-local-sync', 'dist', 'cli.js'));
      expect(readFileSync(log, 'utf8')).toBe(`@neomei/agentwiki-local-sync@${CURRENT_LOCAL_SYNC_VERSION}\n`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('prepares WorkBuddy for a local runtime before onboarding', () => {
    const guide = new OnboardController({} as any, {} as any).getRuntime('workbuddy');
    expect(guide).not.toMatch(/^npx /m);
    expect(guide).not.toContain('--cache');
    expect(guide).toContain('.agentwiki/runtime');
    expect(guide).toContain('reuses a valid copy');
    expect(guide).not.toContain('onboard start');
    expect(guide).toContain('Node.js 24 or 26');
  });

  it.each(['0.13.4', '0.13.6'])('pins WorkBuddy runtime preparation to the requested %s installation version', (packageVersion) => {
    const controller = new OnboardController({} as any, {} as any);
    const guide = Reflect.apply(controller.getRuntime, controller, ['workbuddy', packageVersion]);
    expect(guide).toContain(`@neomei/agentwiki-local-sync@${packageVersion}`);
    expect(guide).toContain(`Package version: ${packageVersion}`);
    expect(guide).not.toContain(`@neomei/agentwiki-local-sync@${packageVersion === '0.13.4' ? '0.13.6' : '0.13.4'}`);
  });

  it('defaults only an omitted runtime package version to the current release', () => {
    const guide = new OnboardController({} as any, {} as any).getRuntime('workbuddy');
    expect(guide).toContain(`@neomei/agentwiki-local-sync@${CURRENT_LOCAL_SYNC_VERSION}`);
    expect(guide).toContain(`Package version: ${CURRENT_LOCAL_SYNC_VERSION}`);
  });

  it.each(['', 'latest', '0.13.7', '0.13.4;echo unsafe', ['0.13.4', '0.13.6'], null])('rejects an unsupported or ambiguous runtime version %j before generating a runner', (packageVersion) => {
    const controller = new OnboardController({} as any, {} as any);
    for (const client of ['workbuddy', 'generic', 'codex']) {
      expect(() => Reflect.apply(controller.getRuntime, controller, [client, packageVersion])).toThrow(BadRequestException);
    }
  });

  it.each(['generic', 'codex', 'claude', 'opencode'])('does not execute another host\'s runtime preparation for %s', (client) => {
    const controller = new OnboardController({} as any, {} as any);
    const runtime = controller.getRuntime(client);
    expect(runtime).not.toMatch(/workbuddy|--cache/i);
    expect(runtime).toContain('Node.js 24 or 26');
    expect(controller.getMarkdown()).not.toMatch(/^node -e|^npx --cache/m);
  });

  it.each([undefined, '', 'unknown', 'codex&client=workbuddy'])('requires an exact host for runtime instructions: %s', (client) => {
    expect(() => new OnboardController({} as any, {} as any).getRuntime(client)).toThrow();
  });

  it('advertises bounded version-pinned steps, explicit confirmation, and actual host-read verification', () => {
    const controller = new OnboardController({} as any, {} as any);
    const guide = controller.getMarkdown();
    expect(guide).toContain("<nodePath> <cliPath> onboard start --server 'https://agentwiki.quukk.com/api' --client <host-client> --protocol json");
    expect(guide.match(/^<nodePath> <cliPath> onboard /gm)).toHaveLength(4);
    expect(guide).not.toMatch(/^npx /m);
    expect(guide).toContain('/onboard/runtime?client=<host-client>&packageVersion=0.13.6');
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
    expect(guide).toMatch(/wiki_get_writing_schema\(\{\}\).*写作/);
    expect(guide).toMatch(/wiki_get_writing_schema\(\{\}\).*authoring/);
    expect(guide).not.toContain('wiki_identity');
  });
});
