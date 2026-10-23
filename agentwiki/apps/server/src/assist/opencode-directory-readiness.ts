import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

export const DIRECTORY_READINESS_MARKER = 'agentwiki-directory-tools-ready-v1';

/** Wait on OpenCode's actual registry before it snapshots tools for the provider. */
export function createDirectoryReadinessPlugin(sandbox: string, deadlineMs: number): { pluginPath: string; markerPath: string } {
  if (!Number.isFinite(deadlineMs)) throw new TypeError('Directory readiness requires a finite deadline');
  const pluginPath = join(sandbox, 'directory-readiness-plugin');
  const markerPath = join(sandbox, 'directory-tools-ready');
  mkdirSync(pluginPath, { mode: 0o700 });
  rmSync(markerPath, { force: true });
  writeFileSync(join(pluginPath, 'package.json'), JSON.stringify({ type: 'module' }), { mode: 0o600, flag: 'wx' });
  // This module is loaded by OpenCode, not by AgentWiki. It deliberately has no
  // package dependencies and never copies prompts, documents or tool outputs.
  writeFileSync(join(pluginPath, 'index.js'), `import { rmSync, writeFileSync } from 'node:fs';
const markerPath = ${JSON.stringify(markerPath)};
const deadline = ${JSON.stringify(deadlineMs)};
const required = ['agentwiki_directory_list_documents', 'agentwiki_directory_read_document'];
const clearMarker = () => rmSync(markerPath, { force: true });
const timeout = () => new Error('AgentWiki directory tools did not become ready before the execution deadline');
export default {
  id: 'agentwiki.directory-readiness',
  async setup(ctx) {
    await ctx.session.hook('prompt', async () => {
      clearMarker();
      while (Date.now() < deadline) {
        const tools = await ctx.tool.list();
        if (Date.now() >= deadline) break;
        if (required.every(id => tools.some(tool => tool.id === id && tool.options?.codemode === false))) return;
        await new Promise(resolve => setTimeout(resolve, Math.min(25, Math.max(0, deadline - Date.now()))));
      }
      throw timeout();
    });
    await ctx.session.hook('context', async event => {
      clearMarker();
      if (Date.now() >= deadline) throw timeout();
      if (!event.tools || !required.every(id => Object.prototype.hasOwnProperty.call(event.tools, id))) {
        throw new Error('AgentWiki directory tools are unavailable in the model context');
      }
      writeFileSync(markerPath, ${JSON.stringify(DIRECTORY_READINESS_MARKER)}, { mode: 0o600, flag: 'wx' });
    });
  },
};
`, { mode: 0o600, flag: 'wx' });
  return { pluginPath, markerPath };
}
