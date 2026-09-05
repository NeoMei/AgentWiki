import { Prisma, type PageTemplateCategory, type PageTemplateScope } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';
import { normalizeTemplateName, type PageTemplateLocale } from './page-template.types';

export type CurrentTemplateCatalogRow = {
  id: string;
  scope: PageTemplateScope;
  spaceId: string | null;
  stableKey: string;
  category: PageTemplateCategory;
  displayOrder: number | null;
  nameI18n: Prisma.JsonValue;
  descriptionI18n: Prisma.JsonValue;
  defaultTitleI18n: Prisma.JsonValue;
  sourceLocale: string | null;
  currentVersion: number;
  archivedAt: Date | null;
  updatedAt: Date;
  kind: 'single_page' | 'page_group';
  supportsCollaboration: boolean;
};

export type CurrentTemplateCatalogQuery = {
  mode: 'legacy' | 'composite';
  spaceId: string;
  locale: PageTemplateLocale;
  scope?: 'all' | 'system' | 'space';
  archived?: 'active' | 'archived' | 'all';
  category?: PageTemplateCategory;
  kind?: 'single_page' | 'page_group';
  supportsCollaboration?: boolean;
  q?: string;
  skip: number;
  take: number;
};

type CatalogQueryClient = Pick<PrismaService, '$queryRaw'> | Prisma.TransactionClient;

export async function queryCurrentTemplateCatalog(
  db: CatalogQueryClient,
  input: CurrentTemplateCatalogQuery,
): Promise<{ rows: CurrentTemplateCatalogRow[]; total: number }> {
  const scopePredicates: Prisma.Sql[] = [];
  if (input.scope !== 'space') {
    scopePredicates.push(Prisma.sql`(template."scope" = 'system' AND template."archivedAt" IS NULL)`);
  }
  if (input.scope !== 'system') {
    const archived = input.archived === 'archived'
      ? Prisma.sql`template."archivedAt" IS NOT NULL`
      : input.archived === 'all'
        ? Prisma.sql`TRUE`
        : Prisma.sql`template."archivedAt" IS NULL`;
    scopePredicates.push(Prisma.sql`(
      template."scope" = 'space'
      AND template."spaceId" = ${input.spaceId}
      AND ${archived}
    )`);
  }
  const predicates: Prisma.Sql[] = [
    Prisma.sql`(${Prisma.join(scopePredicates, ' OR ')})`,
    input.mode === 'legacy'
      ? Prisma.sql`version."definition" IS NULL`
      : Prisma.sql`TRUE`,
  ];
  if (input.category) predicates.push(Prisma.sql`template."category" = ${input.category}::"PageTemplateCategory"`);
  if (input.kind) {
    predicates.push(Prisma.sql`COALESCE(version."definition" ->> 'kind', 'single_page') = ${input.kind}`);
  }
  const supportsExpression = Prisma.sql`CASE
    WHEN version."definition" IS NULL THEN FALSE
    ELSE COALESCE(version."definition" -> 'collaboration' <> 'null'::jsonb, FALSE)
  END`;
  if (input.supportsCollaboration !== undefined) {
    predicates.push(Prisma.sql`(${supportsExpression}) = ${input.supportsCollaboration}`);
  }
  if (input.q?.trim()) {
    const localizedNeedle = `%${escapeLikePattern(input.q.trim().toLocaleLowerCase(input.locale))}%`;
    const normalizedNeedle = `%${escapeLikePattern(normalizeTemplateName(input.q))}%`;
    predicates.push(Prisma.sql`(
      (template."scope" = 'system' AND LOWER(COALESCE(
        template."nameI18n" ->> ${input.locale},
        template."nameI18n" ->> 'en',
        template."nameI18n" ->> 'zh-CN'
      )) LIKE ${localizedNeedle} ESCAPE ${'\\'})
      OR
      (template."scope" = 'space' AND template."nameKey" LIKE ${normalizedNeedle} ESCAPE ${'\\'})
    )`);
  }
  const where = Prisma.sql`${Prisma.join(predicates, ' AND ')}`;
  const from = Prisma.sql`
    FROM "PageTemplate" AS template
    INNER JOIN "PageTemplateVersion" AS version
      ON version."templateId" = template."id"
      AND version."version" = template."currentVersion"
  `;
  const order = input.scope === 'system'
    ? Prisma.sql`template."displayOrder" ASC NULLS LAST, template."id" ASC`
    : input.scope === 'space'
      ? Prisma.sql`template."updatedAt" DESC, template."id" DESC`
      : Prisma.sql`
        CASE WHEN template."scope" = 'system' THEN 0 ELSE 1 END ASC,
        template."displayOrder" ASC NULLS LAST,
        template."updatedAt" DESC,
        template."id" ASC
      `;
  const [rows, totals] = await Promise.all([
    db.$queryRaw<CurrentTemplateCatalogRow[]>(Prisma.sql`
      SELECT
        template."id", template."scope", template."spaceId", template."stableKey",
        template."category", template."displayOrder", template."nameI18n",
        template."descriptionI18n", template."defaultTitleI18n", template."sourceLocale",
        template."currentVersion", template."archivedAt", template."updatedAt",
        COALESCE(version."definition" ->> 'kind', 'single_page') AS "kind",
        ${supportsExpression} AS "supportsCollaboration"
      ${from}
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ${input.take}
      OFFSET ${input.skip}
    `),
    db.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
      SELECT COUNT(*) AS "total"
      ${from}
      WHERE ${where}
    `),
  ]);
  return { rows, total: Number(totals[0]?.total ?? 0) };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, '\\$&');
}
