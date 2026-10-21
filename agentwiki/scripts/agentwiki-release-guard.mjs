import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(projectRoot, 'AGENTWIKI_RELEASE_CANDIDATE');

function fail(message) {
  console.error(`AgentWiki release guard failed: ${message}`);
  process.exit(1);
}

function git(...args) {
  try {
    return execFileSync('git', ['-C', projectRoot, ...args], { encoding: 'utf8' }).replace(/\r?\n$/u, '');
  } catch (error) {
    fail(`cannot read Git state (${args.join(' ')}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readManifest() {
  let source;
  try { source = readFileSync(manifestPath, 'utf8'); } catch (error) { fail(`missing ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`); }
  return Object.fromEntries(source.split(/\r?\n/u).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => {
    const index = line.indexOf('=');
    return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : [line, ''];
  }));
}

function readJson(relativePath) {
  try { return JSON.parse(readFileSync(resolve(projectRoot, relativePath), 'utf8')); }
  catch (error) { fail(`cannot read ${relativePath}: ${error instanceof Error ? error.message : String(error)}`); }
}

const manifest = readManifest();
for (const key of ['APP_VERSION', 'CANDIDATE_BRANCH', 'CANDIDATE_COMMIT']) {
  if (!manifest[key]) fail(`${key} is missing from AGENTWIKI_RELEASE_CANDIDATE`);
}

const gitRoot = git('rev-parse', '--show-toplevel');
if (resolve(gitRoot, 'agentwiki') !== projectRoot) {
  fail(`wrong project root; expected ${resolve(gitRoot, 'agentwiki')}, got ${projectRoot}`);
}

const head = git('rev-parse', 'HEAD');
const expectedHead = git('rev-parse', manifest.CANDIDATE_COMMIT);
const branch = git('branch', '--show-current');
try {
  execFileSync('git', ['-C', projectRoot, 'merge-base', '--is-ancestor', expectedHead, head], { stdio: 'ignore' });
} catch {
  fail(`HEAD ${head.slice(0, 8)} is not based on the locked candidate ${manifest.CANDIDATE_COMMIT}`);
}
if (branch && branch !== manifest.CANDIDATE_BRANCH) fail(`branch ${branch} is not the locked candidate ${manifest.CANDIDATE_BRANCH}`);

for (const relativePath of ['package.json', 'apps/client/package.json', 'apps/server/package.json']) {
  const pkg = readJson(relativePath);
  if (pkg.version !== manifest.APP_VERSION) fail(`${relativePath} reports ${pkg.version}, expected ${manifest.APP_VERSION}`);
}

const panel = readFileSync(resolve(projectRoot, 'apps/client/src/features/agent-session/AgentSessionPanel.tsx'), 'utf8');
if (/Message mode|会话模式|agent-mode-select|<option value=["']question["']/u.test(panel)) {
  fail('the historical Agent chat mode selector is present');
}

const serverPackage = readJson('apps/server/package.json');
if (serverPackage.dependencies?.['opencode-ai'] || serverPackage.dependencies?.['@opencode/cli']) {
  fail('AgentWiki still carries a fixed OpenCode package dependency');
}

console.log(`AgentWiki release candidate verified: v${manifest.APP_VERSION} ${head.slice(0, 8)} (base ${manifest.CANDIDATE_COMMIT}) ${branch || '(detached)'}`);
