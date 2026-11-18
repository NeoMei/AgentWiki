// Delivered as a standalone .cjs file in the runtime guide. It uses the
// directory and manifest understood by the already published Local Sync CLI.
export function onboardRuntimeBootstrap(version: string): string {
  return `const version = ${JSON.stringify(version)};\n` + String.raw`const fs = require('node:fs');
const { homedir } = require('node:os');
const { dirname, isAbsolute, join } = require('node:path');
const { spawnSync } = require('node:child_process');

const name = '@neomei/agentwiki-local-sync';
const root = join(homedir(), '.agentwiki', 'runtime');
const target = join(root, 'local-sync-' + version);
const cli = join('node_modules', '@neomei', 'agentwiki-local-sync', 'dist', 'cli.js');
const manifest = 'runtime.json';
const node = fs.realpathSync(process.execPath);
const supportedNode = /^v(?:24|26)\./;

function readRuntime(directory) {
  try {
    const info = fs.lstatSync(directory);
    const privateDirectory = process.platform === 'win32' || (info.mode & 0o077) === 0;
    if (!info.isDirectory() || !privateDirectory) return null;
    const cliPath = join(directory, cli);
    const pkg = JSON.parse(fs.readFileSync(join(dirname(dirname(cliPath)), 'package.json'), 'utf8'));
    if (pkg.name !== name || pkg.version !== version || !fs.statSync(cliPath).isFile()) return null;
    let nodePath = process.execPath;
    try {
      const recorded = JSON.parse(fs.readFileSync(join(directory, manifest), 'utf8')).nodePath;
      if (typeof recorded === 'string' && isAbsolute(recorded)) nodePath = recorded;
    } catch { /* Match the CLI's fallback when a manifest is missing or unreadable. */ }
    return { nodePath, cliPath, version };
  } catch {
    return null;
  }
}

function findNpm() {
  const bin = dirname(node);
  const adjacent = process.platform === 'win32'
    ? join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const sibling = join(dirname(process.execPath), 'npm');
  let linkedCli;
  if (process.platform !== 'win32') {
    try { linkedCli = fs.realpathSync(sibling); } catch { /* npm need not be a symlink. */ }
  }
  const configured = process.argv[2];
  const candidates = configured ? [configured] : [adjacent, linkedCli];
  for (const candidate of candidates) {
    if (!candidate || !isAbsolute(candidate) || !candidate.endsWith('npm-cli.js')) continue;
    const result = spawnSync(node, [candidate, '--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (result.status === 0 && /^\d+\.\d+\.\d+/.test(result.stdout.trim())) return candidate;
  }
  throw new Error('Locate npm-cli.js from this Node installation and pass its absolute path to this script.');
}

function install() {
  if (!supportedNode.test(process.version)) throw new Error('Use Node.js 24 or 26 in the current host.');
  const existing = readRuntime(target);
  if (existing) return existing;
  if (fs.lstatSync(target, { throwIfNoEntry: false })) {
    throw new Error('Runtime is incomplete or has unsafe permissions. Inspect and move it aside before retrying: ' + target);
  }
  const npm = findNpm();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const staging = fs.mkdtempSync(join(root, '.install-' + version + '-'));
  try {
    fs.chmodSync(staging, 0o700);
    fs.writeFileSync(join(staging, 'package.json'), '{"private":true}\n', { mode: 0o600 });
    const result = spawnSync(node, [npm, 'install', '--prefix', staging, name + '@' + version,
      '--global=false', '--save-exact', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: staging,
      stdio: ['ignore', 2, 2],
      timeout: 600000,
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0 || !readRuntime(staging)) {
      throw new Error('Could not install and verify ' + name + '@' + version);
    }
    fs.writeFileSync(join(staging, manifest), JSON.stringify({ nodePath: node, version }) + '\n', { mode: 0o600 });
    try {
      fs.renameSync(staging, target);
    } catch (error) {
      if (!readRuntime(target)) throw error;
    }
    return readRuntime(target);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

try {
  const runtime = install();
  if (!runtime) throw new Error('Local Sync runtime could not be read after installation.');
  const result = spawnSync(runtime.nodePath, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (result.status !== 0 || !supportedNode.test(result.stdout.trim())) {
    throw new Error('The recorded Node.js is unavailable or unsupported: ' + runtime.nodePath);
  }
  process.stdout.write(JSON.stringify(runtime) + '\n');
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
}
`;
}
