import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { createDirectoryReadinessPlugin } from './opencode-directory-readiness';

describe('OpenCode directory readiness plugin', () => {
  let sandbox: string;
  beforeEach(() => { sandbox = mkdtempSync(join(tmpdir(), 'agentwiki-readiness-test-')); });
  afterEach(() => { rmSync(sandbox, { recursive: true, force: true }); });

  const runPlugin = (pluginPath: string, script: string) => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-'], {
      input: `import plugin from ${JSON.stringify(pathToFileURL(join(pluginPath, 'index.js')).href)};
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const hooks = {};
const readyTools = [
  { id: 'agentwiki_directory_list_documents', options: { codemode: false } },
  { id: 'agentwiki_directory_read_document', options: { codemode: false } },
];
const contextTools = { agentwiki_directory_list_documents: {}, agentwiki_directory_read_document: {} };
const register = async list => plugin.setup({ tool: { list }, session: { hook: async (name, callback) => { hooks[name] = callback; } } });
${script}`,
      encoding: 'utf8', timeout: 3000,
    });
    if (child.error) throw child.error;
    if (child.status !== 0) throw new Error(child.stderr || `Plugin process exited ${child.status}`);
    return JSON.parse(child.stdout.trim());
  };

  it('creates a private plugin without granting readiness before either hook runs', () => {
    const { pluginPath, markerPath } = createDirectoryReadinessPlugin(sandbox, Date.now() + 2000);
    expect(statSync(pluginPath).mode & 0o777).toBe(0o700);
    expect(statSync(join(pluginPath, 'index.js')).mode & 0o777).toBe(0o600);
    expect(statSync(join(pluginPath, 'package.json')).mode & 0o777).toBe(0o600);
    expect(markerPath).toBe(join(sandbox, 'directory-tools-ready'));
    expect(existsSync(markerPath)).toBe(false);
  });

  it('marks readiness only after both direct tools reach the actual model context', () => {
    const { pluginPath, markerPath } = createDirectoryReadinessPlugin(sandbox, Date.now() + 2000);
    const result = runPlugin(pluginPath, `
await register(async () => readyTools);
await hooks.prompt();
const beforeContext = existsSync(${JSON.stringify(markerPath)});
await hooks.context({ tools: contextTools });
console.log(JSON.stringify({ beforeContext, marker: readFileSync(${JSON.stringify(markerPath)}, 'utf8') }));`);
    expect(result).toEqual({ beforeContext: false, marker: 'agentwiki-directory-tools-ready-v1' });
    expect(statSync(markerPath).mode & 0o777).toBe(0o600);
  });

  it('waits for delayed registration rather than starting with a partial tool catalog', () => {
    const { pluginPath, markerPath } = createDirectoryReadinessPlugin(sandbox, Date.now() + 2000);
    const result = runPlugin(pluginPath, `
const readyAt = Date.now() + 75;
await register(async () => Date.now() >= readyAt ? readyTools : readyTools.slice(0, 1));
await hooks.prompt();
await hooks.context({ tools: contextTools });
console.log(JSON.stringify({ waitedForTools: Date.now() >= readyAt, marked: existsSync(${JSON.stringify(markerPath)}) }));`);
    expect(result).toEqual({ waitedForTools: true, marked: true });
  });

  it('fails closed when tools remain hidden behind code mode until the deadline', () => {
    const { pluginPath, markerPath } = createDirectoryReadinessPlugin(sandbox, Date.now() + 500);
    const result = runPlugin(pluginPath, `
await register(async () => readyTools.map(tool => ({ ...tool, options: { codemode: true } })));
let rejected = false;
try { await hooks.prompt(); } catch { rejected = true; }
console.log(JSON.stringify({ rejected, marked: existsSync(${JSON.stringify(markerPath)}) }));`);
    expect(result).toEqual({ rejected: true, marked: false });
  });

  it('rejects an already expired deadline even when the tools are ready', () => {
    const { pluginPath, markerPath } = createDirectoryReadinessPlugin(sandbox, Date.now() - 1);
    const result = runPlugin(pluginPath, `
await register(async () => readyTools);
let promptRejected = false;
let contextRejected = false;
try { await hooks.prompt(); } catch { promptRejected = true; }
try { await hooks.context({ tools: contextTools }); } catch { contextRejected = true; }
console.log(JSON.stringify({ promptRejected, contextRejected, marked: existsSync(${JSON.stringify(markerPath)}) }));`);
    expect(result).toEqual({ promptRejected: true, contextRejected: true, marked: false });
  });

  it('invalidates an earlier marker if a later model context loses either tool', () => {
    const { pluginPath, markerPath } = createDirectoryReadinessPlugin(sandbox, Date.now() + 2000);
    const result = runPlugin(pluginPath, `
await register(async () => readyTools);
await hooks.prompt();
await hooks.context({ tools: contextTools });
const markedBefore = existsSync(${JSON.stringify(markerPath)});
let rejected = false;
try { await hooks.context({ tools: { agentwiki_directory_list_documents: {} } }); } catch { rejected = true; }
console.log(JSON.stringify({ markedBefore, rejected, markedAfter: existsSync(${JSON.stringify(markerPath)}) }));`);
    expect(result).toEqual({ markedBefore: true, rejected: true, markedAfter: false });
  });

  it('removes a stale marker before waiting for a new prompt that cannot become ready', () => {
    const { pluginPath, markerPath } = createDirectoryReadinessPlugin(sandbox, Date.now() + 500);
    const result = runPlugin(pluginPath, `
writeFileSync(${JSON.stringify(markerPath)}, 'agentwiki-directory-tools-ready-v1');
await register(async () => []);
let rejected = false;
try { await hooks.prompt(); } catch { rejected = true; }
console.log(JSON.stringify({ rejected, marked: existsSync(${JSON.stringify(markerPath)}) }));`);
    expect(result).toEqual({ rejected: true, marked: false });
  });

  it('rejects a non-finite deadline instead of creating an unbounded wait', () => {
    expect(() => createDirectoryReadinessPlugin(sandbox, Number.NaN)).toThrow();
    expect(existsSync(join(sandbox, 'directory-tools-ready'))).toBe(false);
  });
});
