import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { ModuleKind, transpileModule } from 'typescript';
import { spawn } from 'child_process';

describe('directory MCP real stdio boundary', () => {
  let sandbox: string;
  let client: Client;
  let transport: StdioClientTransport;
  const content = '开头🙂' + '完整正文'.repeat(9_000) + '尾部证据';
  const documents = Array.from({ length: 103 }, (_, index) => ({
    pageId: `page-${index}`, title: index < 2 ? 'Same title' : `Document ${index}`,
    content: index === 0 ? content : `body-${index}`, updatedAt: '2026-10-19T00:00:00.000Z', folderId: index % 2 ? 'child' : 'folder',
  }));

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    return JSON.parse((result.content as Array<{ text: string }>)[0].text);
  };

  beforeAll(async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'assist-directory-stdio-'));
    const helper = join(sandbox, 'directory.cjs');
    // Run the actual production helper in its own Node process, with no Jest mocks.
    writeFileSync(helper, transpileModule(readFileSync(join(__dirname, 'assist-directory-mcp.ts'), 'utf8'), {
      compilerOptions: { module: ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText);
    const snapshot = join(sandbox, 'scope.json');
    writeFileSync(snapshot, JSON.stringify({ folderId: 'folder', title: 'Research', recursive: true, documents }), { mode: 0o600 });
    client = new Client({ name: 'directory-test', version: '1' });
    transport = new StdioClientTransport({ command: process.execPath, args: [helper, snapshot],
      env: { NODE_PATH: resolve(__dirname, '../../node_modules') }, stderr: 'pipe' });
    await client.connect(transport);
  });

  afterAll(async () => { await client?.close(); rmSync(sandbox, { recursive: true, force: true }); });

  it('offers only the two read-only directory tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name).sort()).toEqual(['list_documents', 'read_document']);
    expect(tools.every(tool => tool.annotations?.readOnlyHint === true && tool.annotations?.openWorldHint === false)).toBe(true);
  });

  it('exits when its owning OpenCode process closes stdin', async () => {
    const child = spawn(process.execPath, [join(sandbox, 'directory.cjs'), join(sandbox, 'scope.json')], {
      env: { NODE_PATH: resolve(__dirname, '../../node_modules') }, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
    });
    try {
      const exited = new Promise<number | null>((resolveExit, reject) => { child.once('close', resolveExit); child.once('error', reject); });
      child.stdin.end();
      await expect(exited).resolves.toBe(0);
    } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
  });

  it('returns an explicit complete result for an empty directory', async () => {
    const snapshot = join(sandbox, 'empty.json');
    writeFileSync(snapshot, JSON.stringify({ folderId: null, title: 'Root', recursive: true, documents: [] }));
    const emptyClient = new Client({ name: 'empty-test', version: '1' });
    try {
      await emptyClient.connect(new StdioClientTransport({ command: process.execPath,
        args: [join(sandbox, 'directory.cjs'), snapshot], env: { NODE_PATH: resolve(__dirname, '../../node_modules') }, stderr: 'pipe' }));
      const result = await emptyClient.callTool({ name: 'list_documents', arguments: {} });
      expect(JSON.parse((result.content as Array<{ text: string }>)[0].text)).toMatchObject({ total: 0, documents: [], hasMore: false, nextCursor: null });
      expect((await emptyClient.callTool({ name: 'read_document', arguments: { pageId: 'page-0' } })).isError).toBe(true);
    } finally { await emptyClient.close(); }
  });

  it('reports an unavailable snapshot as an error instead of an empty directory', async () => {
    const snapshot = join(sandbox, 'unavailable.json');
    writeFileSync(snapshot, JSON.stringify({ folderId: null, title: 'Root', recursive: true, documents: [], unavailableReason: 'Snapshot limit exceeded' }));
    const unavailableClient = new Client({ name: 'unavailable-test', version: '1' });
    try {
      await unavailableClient.connect(new StdioClientTransport({ command: process.execPath,
        args: [join(sandbox, 'directory.cjs'), snapshot], env: { NODE_PATH: resolve(__dirname, '../../node_modules') }, stderr: 'pipe' }));
      for (const [name, args] of [['list_documents', {}], ['read_document', { pageId: 'page-0' }]] as const) {
        const result = await unavailableClient.callTool({ name, arguments: args });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).toContain('Snapshot limit exceeded');
        expect(JSON.stringify(result)).not.toContain('"total":0');
      }
    } finally { await unavailableClient.close(); }
  });

  it('enumerates every page across list pages, preserving duplicate titles and folder membership', async () => {
    const pages: any[] = [];
    let cursor: number | undefined;
    do {
      const page = await call('list_documents', cursor === undefined ? { limit: 40 } : { cursor, limit: 40 });
      expect(page.total).toBe(103);
      expect(page.documents.length).toBeLessThanOrEqual(40);
      expect(page.hasMore).toBe(page.nextCursor !== null);
      pages.push(...page.documents);
      cursor = page.nextCursor === null ? undefined : page.nextCursor;
    } while (cursor !== undefined);
    expect(pages.map(page => page.pageId)).toEqual(documents.map(page => page.pageId));
    expect(pages[0]).toMatchObject({ title: 'Same title', folderId: 'folder', url: '/pages/page-0', contentLength: content.length });
    expect(pages[1]).toMatchObject({ title: 'Same title', folderId: 'child' });
    expect(pages.every(page => !Object.prototype.hasOwnProperty.call(page, 'content'))).toBe(true);
  });

  it('reads the complete long document through offset pages without truncating the tail', async () => {
    let assembled = '';
    let offset = 0;
    for (;;) {
      const page = await call('read_document', { pageId: 'page-0', offset, length: 1_001 });
      expect(page.totalCharacters).toBe(content.length);
      expect(page.offset).toBe(offset);
      expect(page.content.length).toBeLessThanOrEqual(1_001);
      assembled += page.content;
      if (!page.hasMore) { expect(page.nextOffset).toBeNull(); break; }
      expect(page.nextOffset).toBeGreaterThan(offset);
      offset = page.nextOffset;
    }
    expect(assembled).toBe(content);
    expect(await call('read_document', { pageId: 'page-0', offset: content.length })).toMatchObject({ content: '', hasMore: false, nextOffset: null });
  });

  it.each([
    ['read_document', { pageId: '../../outside' }],
    ['read_document', { pageId: 'page-0', offset: -1 }],
    ['read_document', { pageId: 'page-0', offset: 1e9 }],
    ['read_document', { pageId: 'page-0', length: 0 }],
    ['read_document', { pageId: 'page-0', length: 20_001 }],
    ['read_document', { pageId: 'page-0', offset: '0' }],
    ['read_document', { pageId: 'page-0', path: '/etc/passwd' }],
    ['list_documents', { cursor: -1 }],
    ['list_documents', { cursor: 104 }],
    ['list_documents', { cursor: 0.5 }],
    ['list_documents', { limit: 101 }],
    ['list_documents', { folderId: 'outside' }],
    ['bash', { command: 'id' }],
  ])('rejects invalid or out-of-scope %s parameters %j', async (name, args) => {
    const result = await client.callTool({ name: name as string, arguments: args as Record<string, unknown> });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('尾部证据');
  });
});
