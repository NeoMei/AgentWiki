import { BadRequestException } from '@nestjs/common';
import { CURRENT_LOCAL_SYNC_VERSION, isSupportedLocalSyncVersion, supportsPreinstalledGateway } from '../core/local-sync-version';
import { onboardRuntimeBootstrap } from './onboard-runtime-bootstrap';

const CLIENTS = ['generic', 'codex', 'claude', 'opencode', 'workbuddy'];

/** Runtime preparation only: never starts onboarding or chooses a server Agent. */
export function onboardRuntimeGuide(client: unknown, packageVersion: unknown = CURRENT_LOCAL_SYNC_VERSION): string {
  if (typeof client !== 'string' || !CLIENTS.includes(client)) {
    throw new BadRequestException('Identify the current host and select generic, codex, claude, opencode, or workbuddy');
  }
  if (!isSupportedLocalSyncVersion(packageVersion)) {
    throw new BadRequestException('Use the exact supported Local Sync package version from the original installation instruction');
  }
  const versionNotice = `包版本：${packageVersion}。保留原连接码或会话要求的精确版本。\nPackage version: ${packageVersion}. Preserve the exact version from the original installation code or session.`;
  const hostNotice = client === 'workbuddy'
    ? [
      'WorkBuddy 运行准备：在当前宿主的工具执行环境确认 Node.js 24 或 26，托管 Node.js 22 不受支持。单独终端的版本不能证明 WorkBuddy 使用的版本。',
      'WorkBuddy runtime preparation: verify Node.js 24 or 26 in this host’s tool execution environment. Managed Node.js 22 is unsupported. A separate terminal does not establish the WorkBuddy runtime.',
    ].join('\n')
    : `当前宿主配置类型：${client}。在该宿主的工具执行环境确认 Node.js 24 或 26。\nHost configuration: ${client}. Verify Node.js 24 or 26 in this host’s tool execution environment.`;
  if (!supportsPreinstalledGateway(packageVersion)) {
    return [
      versionNotice,
      hostNotice,
      `历史版本：确认配套 npm/npx 可用后，继续原提示里的 @neomei/agentwiki-local-sync@${packageVersion} 接入命令。`,
      `Legacy version: verify its accompanying npm/npx and continue with the original @neomei/agentwiki-local-sync@${packageVersion} onboarding command.`,
    ].join('\n');
  }
  return [
    versionNotice,
    hostNotice,
    '',
    `将下方代码块中的 JavaScript 保存为临时 .cjs 文件。用已确认的 Node 绝对路径执行这个文件，文件路径作为独立参数。首次将 @neomei/agentwiki-local-sync@${packageVersion} 安装到 ~/.agentwiki/runtime；已有可用的同版本会直接复用。首次安装需要配套 npm 和可访问的 npm 源；若无法定位配套 npm，可把 npm-cli.js 的绝对路径作为脚本的下一项参数。`,
    `Save the JavaScript block below to a temporary .cjs file. Run the file with the confirmed absolute Node path and pass the file path as a separate argument. It installs @neomei/agentwiki-local-sync@${packageVersion} into ~/.agentwiki/runtime on first use and reuses a valid copy of the same version. A first install needs the accompanying npm and a reachable registry. If npm cannot be located, pass the absolute path of its npm-cli.js as the next argument to the script.`,
    '',
    '读取输出 JSON 的 nodePath、cliPath 和 version。后续接入命令分别传入这两个绝对路径，再传 onboard 及原参数。保持同一连接码或 sessionId；不要把连接码交给准备脚本。本页不启动接入，也不改变所选 Agent。',
    'Read nodePath, cliPath, and version from the JSON output. Use those two absolute paths as separate arguments before onboard and its original arguments. Keep the same code or sessionId and do not pass the code to the preparation script. This page does not start onboarding or change the selected Agent.',
    '',
    '```js',
    onboardRuntimeBootstrap(packageVersion).trimEnd(),
    '```',
    '',
  ].join('\n');
}
