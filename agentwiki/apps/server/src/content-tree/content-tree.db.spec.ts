import { createHash } from 'crypto';
import { ContentTreeService } from './content-tree.service';

const rootUpdatedAt = new Date('2026-08-28T08:00:00.000Z');

const folderRow = (id: string, depth: number) => ({
  kind: 'folder',
  id,
  parentId: depth === 0 ? null : 'folder-root',
  folderId: null,
  name: id,
  title: null,
  path: depth === 0 ? 'pages/Root' : `pages/Root/${id}`,
  pathKey: depth === 0 ? 'pages/root' : `pages/root/${id}`,
  sortOrder: depth,
  createdAt: rootUpdatedAt,
  updatedAt: rootUpdatedAt,
  depth,
  knowledgeKey: null,
  content: null,
});

const pageRow = (id: string) => ({
  kind: 'page',
  id,
  parentId: null,
  folderId: 'folder-root',
  name: null,
  title: id,
  path: `pages/Root/${id}.md`,
  pathKey: `pages/root/${id}.md`,
  sortOrder: 0,
  createdAt: rootUpdatedAt,
  updatedAt: rootUpdatedAt,
  depth: 1,
  knowledgeKey: `knowledge-${id}`,
  content: '',
});

function impactHarness(rows: any[]) {
  const tx: any = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue(rows),
    space: { findUnique: jest.fn().mockResolvedValue({ contentTreeRevision: 7n }) },
  };
  const prisma: any = {
    $transaction: jest.fn((callback: (transaction: any) => unknown) => callback(tx)),
  };
  return {
    service: new ContentTreeService(prisma, {} as any, {} as any),
    tx,
  };
}

describe('ContentTree lifecycle database planning boundary', () => {
  it('hashes the complete affected set in byte-stable identifier order', async () => {
    const rows = [pageRow('page-z'), folderRow('folder-root', 0), pageRow('page-a')];
    const { service } = impactHarness(rows);
    const expectedHash = createHash('sha256').update([
      'folder:folder-root',
      'page:page-a',
      'page:page-z',
    ].join('\n'), 'utf8').digest('hex');

    await expect((service as any).deleteImpact({
      spaceId: 'space-1', folderId: 'folder-root',
    })).resolves.toEqual({
      treeRevision: 7n,
      rootUpdatedAt,
      folderCount: 1,
      pageCount: 2,
      impactHash: expectedHash,
    });
  });

  it('rejects the 10,001st affected object before issuing any write', async () => {
    const rows = [folderRow('folder-root', 0), ...Array.from(
      { length: 10_000 }, (_, index) => pageRow(`page-${index}`),
    )];
    const { service, tx } = impactHarness(rows);

    await expect((service as any).deleteImpact({
      spaceId: 'space-1', folderId: 'folder-root',
    })).rejects.toEqual(expect.objectContaining({ code: 'FOLDER_MUTATION_LIMIT' }));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('preserves adjacency and complete paths across deterministic random subtree plans', () => {
    const service = new ContentTreeService({} as any, {} as any, {} as any);
    let state = 0x4f1bbcdc;
    const random = () => {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
    };

    for (let sample = 0; sample < 200; sample += 1) {
      const rows: any[] = [{
        ...folderRow(`root-${sample}`, 0),
        parentId: `source-${sample}`,
        name: `Root-${sample}`,
        path: `pages/Source-${sample}/Root-${sample}`,
        pathKey: `pages/source-${sample}/root-${sample}`,
      }];
      const folders = [rows[0]];
      const folderCount = 2 + Math.floor(random() * 40);
      for (let index = 1; index < folderCount; index += 1) {
        const parent = folders[Math.floor(random() * folders.length)]!;
        const name = `Node-${sample}-${index}`;
        const row = {
          ...folderRow(`folder-${sample}-${index}`, parent.depth + 1),
          parentId: parent.id,
          name,
          path: `${parent.path}/${name}`,
          pathKey: `${parent.pathKey}/${name.toLowerCase()}`,
        };
        rows.push(row);
        folders.push(row);
        if (random() < 0.6) {
          rows.push({
            ...pageRow(`page-${sample}-${index}`),
            folderId: row.id,
            path: `${row.path}/Page-${index}.md`,
            pathKey: `${row.pathKey}/page-${index}.md`,
            depth: row.depth + 1,
          });
        }
      }

      const planned = (service as any).planSubtreePaths(
        rows,
        rows[0].id,
        `target-${sample}`,
        `pages/Target-${sample}`,
        `Moved-${sample}`,
        `moved-${sample}`,
      );
      const byId = new Map(planned.folders.map((folder: any) => [folder.id, folder]));
      expect(planned.folders).toHaveLength(folders.length);
      expect(new Set(planned.folders.map((folder: any) => folder.pathKey)).size)
        .toBe(planned.folders.length);
      expect(byId.get(rows[0].id)).toEqual(expect.objectContaining({
        parentId: `target-${sample}`,
        path: `pages/Target-${sample}/Moved-${sample}`,
      }));
      for (const folder of planned.folders.slice(1)) {
        const parent = byId.get(folder.parentId) as any;
        expect(parent).toBeDefined();
        expect(folder.path).toBe(`${parent.path}/${folder.name}`);
      }
      for (const page of planned.pages) {
        const parent = byId.get(page.folderId) as any;
        expect(parent).toBeDefined();
        expect(page.path.startsWith(`${parent.path}/`)).toBe(true);
        expect(page.path.endsWith('.md')).toBe(true);
      }
    }
  });
});
