import { BadRequestException } from '@nestjs/common';
import { CURRENT_LOCAL_SYNC_VERSION, isSupportedLocalSyncVersion } from '../core/local-sync-version';

const CLIENTS = ['generic', 'codex', 'claude', 'opencode', 'workbuddy'];
const WORKBUDDY_CACHE_BOOTSTRAP = `node -e "const fs=require('node:fs'),os=require('node:os'),path=require('node:path');if(![24,26].includes(Number(process.versions.node.split('.')[0])))throw new Error('Use Node.js 24 or 26 in this host');const cache=fs.mkdtempSync(path.join(os.tmpdir(),'agentwiki-npx-'));if(process.platform!=='win32')fs.chmodSync(cache,0o700);console.log(JSON.stringify({node:process.execPath,nodeVersion:process.version,npmCache:cache}));"`;

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
  const workbuddyRunner = `npx --cache '<absolute-npm-cache>' --yes @neomei/agentwiki-local-sync@${packageVersion}`;
  return `${versionNotice}\nWorkBuddy 启动准备：仅用于已确认的 WorkBuddy 宿主，必须在首次 npx 前完成。先在当前宿主的工具执行环境定位或安装 Node.js 24 或 26 及配套 npm/npx；单独终端的版本不能证明 WorkBuddy 的版本，托管 Node.js 22 不受支持。将下方 node 安全替换为该 Node 的绝对路径，执行后核对返回的 node 与 nodeVersion。
WorkBuddy preparation: only for the confirmed WorkBuddy host; complete this before the first npx invocation. In the current host's tool execution environment, locate or install Node.js 24 or 26 and its accompanying npm/npx. A version in a separate terminal does not establish WorkBuddy's runtime; managed Node.js 22 is unsupported. Safely replace node below with that Node executable's absolute path, execute it, and verify the returned node and nodeVersion.

\`\`\`sh
${WORKBUDDY_CACHE_BOOTSTRAP}
\`\`\`

此命令在系统 os.tmpdir() 下随机创建私有 npm 缓存，POSIX 权限0700，Windows 使用当前用户系统 Temp ACL。持久保存绝对 npmCache 路径、Node/npx 绝对路径及精确包版本。每次调用都在当前宿主将该 Node 所在目录放在子进程 PATH 首位，并把命令开头的 npx 换成同一安装的绝对 npx 路径，防止包的子进程回到托管 Node.js 22；使用参数数组或当前 shell 的安全引用（PowerShell 调用带引号的可执行路径需要 &）。将 <absolute-npm-cache> 替换为保存的 npmCache，所有 start/status/continue/--reply-file 命令都复用下方同一个 runner，--cache 必须在包名之前。
This creates a random private npm cache under the system os.tmpdir(), with POSIX mode 0700 and the current user's system Temp ACL on Windows. Persist the absolute npmCache path, absolute Node/npx paths, and exact package version. For every invocation in this host, prepend that Node directory to the child process PATH and replace the leading npx with the absolute npx from the same installation so package subprocesses cannot fall back to managed Node.js 22. Use an argument array or safe native-shell quoting (PowerShell needs & before a quoted executable path). Replace <absolute-npm-cache> with the saved npmCache. Reuse the following runner for every start/status/continue/--reply-file command; --cache must precede the package name.

\`\`\`sh
${workbuddyRunner}
\`\`\`

缓存只存放可丢弃的 npm 文件；session、回复文件与凭据仍在各自正常持久目录，绝不放进缓存。每次复用（包括长期恢复会话）前确认缓存仍位于系统 os.tmpdir() 下、属于当前用户且是真实目录而非符号链接，POSIX 权限0700，Windows 仍受当前用户 Temp ACL 保护。缓存缺失、被替换或权限变化时，不 chmod、不接管不明旧缓存；按同一规则新建私有缓存、更新保存的路径并重新下载同一精确版本，保留原 sessionId 和会话文件。不要修改 NODE_OPTIONS、关闭安全保护或删除旧 npm 缓存。
The cache holds disposable npm files only. Keep sessions, reply files, and credentials in their normal persistent locations, never inside this cache. Before every reuse, including a later session resume, verify that it is still under the system os.tmpdir() and is a real directory owned by the current user, not a symlink, with POSIX mode 0700 or the current user's Temp ACL on Windows. If it is missing, replaced, or has changed permissions, do not chmod or take over an unknown old cache: create a new private cache by the same rule, update the saved path, and reinstall the same exact version while preserving sessionId and session files. Do not change NODE_OPTIONS, disable security protections, or delete the old npm cache.

完成后继续原接入命令，保留原连接码或 sessionId；本页不启动新接入，也不改变所选 Agent。
Continue the original onboarding command with the same code or sessionId. This page does not start onboarding or change the selected Agent.
`;
}
