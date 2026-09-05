import { Prisma } from '@prisma/client';
import { queryCurrentTemplateCatalog } from './current-template-catalog-query';

describe('queryCurrentTemplateCatalog', () => {
  it('filters exact current versions before bounded SQL pagination and returns a separate count', async () => {
    const db = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: 'late-legacy', kind: 'single_page', supportsCollaboration: false }])
        .mockResolvedValueOnce([{ total: 1200n }]),
    } as any;

    await expect(queryCurrentTemplateCatalog(db, {
      mode: 'legacy', spaceId: 'space-1', locale: 'en', scope: 'space', archived: 'all',
      skip: 1199, take: 1,
    })).resolves.toMatchObject({ rows: [{ id: 'late-legacy' }], total: 1200 });

    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    const pageQuery = db.$queryRaw.mock.calls[0]?.[0] as Prisma.Sql;
    const countQuery = db.$queryRaw.mock.calls[1]?.[0] as Prisma.Sql;
    expect(pageQuery.sql).toContain('version."version" = template."currentVersion"');
    expect(pageQuery.sql).toContain('version."definition" IS NULL');
    expect(pageQuery.sql).toContain('LIMIT ?');
    expect(pageQuery.sql).toContain('OFFSET ?');
    expect(pageQuery.sql).not.toContain('version."definition" AS');
    expect(pageQuery.values).toEqual(expect.arrayContaining([1, 1199]));
    expect(countQuery.sql).toContain('COUNT(*) AS "total"');
  });

  it('pushes composite kind and collaboration filters before pagination without selecting definitions', async () => {
    const db = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: 'group', kind: 'page_group', supportsCollaboration: false }])
        .mockResolvedValueOnce([{ total: 1n }]),
    } as any;

    await queryCurrentTemplateCatalog(db, {
      mode: 'composite', spaceId: 'space-1', locale: 'en', scope: 'all', archived: 'active',
      kind: 'page_group', supportsCollaboration: false, skip: 0, take: 10,
    });

    const query = db.$queryRaw.mock.calls[0]?.[0] as Prisma.Sql;
    expect(query.sql).toContain('COALESCE(version."definition" ->> \'kind\', \'single_page\') = ?');
    expect(query.sql).toMatch(/CASE\s+WHEN version\."definition" IS NULL THEN FALSE/u);
    expect(query.sql).not.toContain('version."definition" AS');
    expect(query.sql.indexOf('COALESCE(version."definition"')).toBeLessThan(query.sql.indexOf('LIMIT ?'));
  });

  it('escapes LIKE wildcard characters so q remains a literal substring', async () => {
    const db = {
      $queryRaw: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0n }]),
    } as any;

    await queryCurrentTemplateCatalog(db, {
      mode: 'legacy', spaceId: 'space-1', locale: 'en', scope: 'all', archived: 'active',
      q: String.raw`100%_done\path`, skip: 0, take: 10,
    });

    const query = db.$queryRaw.mock.calls[0]?.[0] as Prisma.Sql;
    expect(query.sql).toContain('LIKE ? ESCAPE ?');
    expect(query.values).toContain(String.raw`%100\%\_done\\path%`);
    expect(query.values.filter((value) => value === '\\')).toHaveLength(2);
  });
});
