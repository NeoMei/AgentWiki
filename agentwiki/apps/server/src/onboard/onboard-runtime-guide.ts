import { BadRequestException } from '@nestjs/common';
import { CURRENT_LOCAL_SYNC_VERSION, isSupportedLocalSyncVersion } from '../core/local-sync-version';

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
  if (client !== 'workbuddy') {
    return `${versionNotice}\n当前宿主配置类型：${client}。在该宿主的工具执行环境确认 Node.js 24 或 26 与配套 npm/npx 可用；此运行环境准备不创建或命名服务端 Agent。完成后继续原接入会话。\nHost configuration: ${client}. Verify Node.js 24 or 26 and its accompanying npm/npx in this host's tool execution environment. This runtime preparation does not create or name a server Agent. Continue the original onboarding flow afterwards.`;
  }
  return [
    versionNotice,
    'WorkBuddy 运行准备：仅用于已确认的 WorkBuddy 宿主。先在当前宿主的工具执行环境定位或安装 Node.js 24 或 26 及配套 npm；单独终端中的版本不能证明 WorkBuddy 的版本，托管 Node.js 22 不受支持。确认要使用的是该 Node 可执行文件的绝对路径。',
    'WorkBuddy runtime preparation: only for the confirmed WorkBuddy host. In this host\'s tool execution environment, locate or install Node.js 24 or 26 with its accompanying npm. A version in a separate terminal does not establish WorkBuddy\'s runtime; managed Node.js 22 is unsupported. Confirm the absolute path of that Node executable.',
    '',
    `接入命令用该绝对 Node 路径完成一次安装：把 @neomei/agentwiki-local-sync@${packageVersion} 装到 ~/.agentwiki/runtime，并把 WorkBuddy 配置写成该 Node 加本地 CLI 的绝对路径。之后每次启动 MCP 都直接执行本地文件，不再运行 npx、解析包或访问 npm 源；离线或没有代理的网络也能启动。`,
    `The onboarding command installs @neomei/agentwiki-local-sync@${packageVersion} once into ~/.agentwiki/runtime using that absolute Node, then writes WorkBuddy's configuration as that Node plus the local CLI. Every later MCP startup runs the local file directly: no npx, no package resolution, no registry access. Startup works offline and without a proxy.`,
    '',
    '如果删除或损坏了 ~/.agentwiki/runtime，MCP 会报告本地 CLI 缺失；重跑同一接入命令重建运行时，不要改回 npx 启动方式。',
    'If ~/.agentwiki/runtime is removed or damaged, MCP reports a missing local CLI. Rerun the same onboarding command to rebuild the runtime instead of restoring an npx launch.',
    '',
    '完成后继续原接入命令，保留原连接码或 sessionId；本页不启动新接入，也不改变所选 Agent。',
    'Continue the original onboarding command with the same code or sessionId. This page does not start onboarding or change the selected Agent.',
    '',
  ].join('\n');
}
