import { Injectable } from '@nestjs/common';
import { pathKey, validatePortablePath } from '@neomei/agentwiki-sync-protocol';
import { Prisma } from '@prisma/client';
import { normalizeAttachmentName } from '../attachments/attachment.service';
import { ContentTreeError } from '../content-tree/content-tree.types';
import {
  AuthorizationService,
  type Principal,
} from '../core/authorization/authorization.service';
import { PrismaService } from '../database/prisma.service';
import {
  type MarkdownResourceReferenceDto,
  type ResolvedMarkdownResource,
  normalizeMarkdownPageIdentity,
} from './markdown-resource.dto';

const READ_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|gif)$/iu;
const MAX_EXACT_PAGE_ROWS = 201;
const MAX_SLUG_PAGE_ROWS = 201;
const MAX_TITLE_PAGE_ROWS = 201;
const MAX_ALIAS_PAGE_ROWS = 201;
const MAX_ATTACHMENT_ROWS = 100;

interface PageRow {
  id: string;
  spaceId: string;
  title: string;
  slug: string;
  folderId: string | null;
  syncPath: string;
  syncPathKey: string;
}

interface AliasPageRow extends PageRow {
  aliasPathKey: string;
}

interface AttachmentRow {
  id: string;
  spaceId: string;
  displayName: string;
  nameKey: string;
  mimeType: string;
  width: number;
  height: number;
}

function withoutMarkdownSuffix(value: string): string {
  return value.endsWith('.md') ? value.slice(0, -3) : value;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function portablePathKey(value: string): string | null {
  try {
    return validatePortablePath(value).key;
  } catch {
    return null;
  }
}

function directoryOf(syncPath: string): string | null {
  const offset = syncPath.lastIndexOf('/');
  return offset > 0 ? syncPath.slice(0, offset) : null;
}

function referencePathKeys(target: string, sourceSyncPath?: string): string[] {
  const normalized = target.normalize('NFC').trim();
  const markdownTarget = /\.md$/iu.test(normalized) ? normalized : `${normalized}.md`;
  const candidates: string[] = [pathKey(normalized)];
  const addPortable = (value: string) => {
    const key = portablePathKey(value);
    if (key) candidates.push(key);
  };
  if (!normalized.includes('/')) {
    const sourceDirectory = sourceSyncPath ? directoryOf(sourceSyncPath) : null;
    if (sourceDirectory) addPortable(`${sourceDirectory}/${markdownTarget}`);
    addPortable(markdownTarget);
    addPortable(`pages/${markdownTarget}`);
  } else {
    addPortable(markdownTarget);
    if (!/^pages\//iu.test(markdownTarget)) addPortable(`pages/${markdownTarget}`);
  }
  return unique(candidates);
}

function pageResult(key: string, page: PageRow): ResolvedMarkdownResource {
  return {
    key,
    status: 'resolved',
    kind: 'page',
    pageId: page.id,
    title: page.title,
    slug: page.slug,
  };
}

function uniqueSortedPages(rows: PageRow[]): PageRow[] {
  const byId = new Map<string, PageRow>();
  for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row);
  return [...byId.values()].sort((left, right) => (
    Buffer.from(left.syncPathKey).compare(Buffer.from(right.syncPathKey))
    || Buffer.from(left.id).compare(Buffer.from(right.id))
  ));
}

function ambiguousPageResult(key: string, rows: PageRow[]): ResolvedMarkdownResource {
  const candidates = uniqueSortedPages(rows).map((page) => ({
    pageId: page.id,
    title: page.title,
    path: page.syncPath,
  }));
  return candidates.length > 0
    ? { key, status: 'ambiguous', candidates }
    : { key, status: 'ambiguous' };
}

@Injectable()
export class MarkdownResourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async resolve(
    spaceId: string,
    references: MarkdownResourceReferenceDto[],
    principal: Principal,
    sourcePageId?: string,
  ): Promise<ResolvedMarkdownResource[]> {
    await this.authorization.assertSpaceAccess(
      principal,
      spaceId,
      [...READ_ROLES],
      'pages:read',
    );

    const pageReferences = references.filter((reference) => (
      reference.kind === 'page' && !IMAGE_EXTENSION.test(reference.target.trim())
    ));
    const attachmentReferences = references.filter((reference) => reference.kind === 'attachment');
    const pageTargets = unique(pageReferences.map((reference) => (
      normalizeMarkdownPageIdentity(reference.target)
    )));
    const initialPathTargets = unique(pageReferences.flatMap((reference) => (
      referencePathKeys(reference.target)
    )));
    const pageFallbackTargets = unique(pageTargets.map(withoutMarkdownSuffix));
    const titleTargets = unique([...pageTargets, ...pageFallbackTargets]);
    const attachmentTargets = unique(attachmentReferences.map((reference) => (
      normalizeAttachmentName(reference.target).nameKey
    )));
    const exactIdTargets = pageTargets;

    const sourcePage = sourcePageId
      ? await this.prisma.page.findFirst({
          where: { id: sourcePageId, spaceId, deletedAt: null },
          select: {
            id: true, spaceId: true, title: true, slug: true, folderId: true,
            syncPath: true, syncPathKey: true,
          },
        }) as PageRow | null
      : undefined;
    if (
      sourcePageId
      && (!sourcePage || sourcePage.id !== sourcePageId || sourcePage.spaceId !== spaceId)
    ) {
      throw new ContentTreeError('CONTENT_TREE_PAGE_NOT_FOUND', 'Source Page not found');
    }

    const exactPageRows = pageTargets.length > 0
      ? await this.prisma.$queryRaw<PageRow[]>(Prisma.sql`
          SELECT "id", "spaceId", "title", "slug", "folderId", "syncPath", "syncPathKey"
          FROM "Page"
          WHERE "spaceId" = ${spaceId}
            AND "deletedAt" IS NULL
            AND (
              "id" IN (${Prisma.join(exactIdTargets)})
              OR markdown_page_identity("syncPath") IN (${Prisma.join(initialPathTargets)})
            )
          ORDER BY "id" ASC
          LIMIT ${MAX_EXACT_PAGE_ROWS}
        `)
      : [];
    const scopedExactPages = exactPageRows.filter((page) => page.spaceId === spaceId);
    const resolvedPathTargets = unique(pageReferences.flatMap((reference) => (
      referencePathKeys(reference.target, sourcePage?.syncPath)
    )));

    const slugPageRows = titleTargets.length > 0
      ? await this.prisma.$queryRaw<PageRow[]>(Prisma.sql`
          SELECT "id", "spaceId", "title", "slug", "folderId", "syncPath", "syncPathKey"
          FROM "Page"
          WHERE "spaceId" = ${spaceId}
            AND "deletedAt" IS NULL
            AND markdown_page_identity("slug") IN (${Prisma.join(titleTargets)})
          ORDER BY "id" ASC
          LIMIT ${MAX_SLUG_PAGE_ROWS}
        `)
      : [];
    const titlePageRows = titleTargets.length > 0
      ? await this.prisma.$queryRaw<PageRow[]>(Prisma.sql`
          SELECT "id", "spaceId", "title", "slug", "folderId", "syncPath", "syncPathKey"
          FROM "Page"
          WHERE "spaceId" = ${spaceId}
            AND "deletedAt" IS NULL
            AND markdown_page_identity("title") IN (${Prisma.join(titleTargets)})
          ORDER BY "id" ASC
          LIMIT ${MAX_TITLE_PAGE_ROWS}
        `)
      : [];
    const aliasPageRows = resolvedPathTargets.length > 0
      ? await this.prisma.$queryRaw<AliasPageRow[]>(Prisma.sql`
          SELECT page."id", page."spaceId", page."title", page."slug", page."folderId",
                 page."syncPath", page."syncPathKey", alias."pathKey" AS "aliasPathKey"
          FROM "PagePathAlias" alias
          JOIN "Page" page ON page."id" = alias."pageId"
          WHERE alias."spaceId" = ${spaceId}
            AND page."spaceId" = ${spaceId}
            AND page."deletedAt" IS NULL
            AND (alias."expiresAt" IS NULL OR alias."expiresAt" > statement_timestamp())
            AND alias."pathKey" IN (${Prisma.join(resolvedPathTargets)})
          ORDER BY alias."pathKey" ASC, page."syncPathKey" ASC, page."id" ASC
          LIMIT ${MAX_ALIAS_PAGE_ROWS}
        `)
      : [];
    const attachmentRows = attachmentTargets.length > 0
      ? await this.prisma.spaceAttachment.findMany({
          where: { spaceId, nameKey: { in: attachmentTargets } },
          select: {
            id: true,
            spaceId: true,
            displayName: true,
            nameKey: true,
            mimeType: true,
            width: true,
            height: true,
          },
          take: MAX_ATTACHMENT_ROWS,
        }) as AttachmentRow[]
      : [];

    const scopedSlugPages = slugPageRows.filter((page) => page.spaceId === spaceId);
    const scopedTitlePages = titlePageRows.filter((page) => page.spaceId === spaceId);
    const scopedAliasPages = aliasPageRows.filter((page) => page.spaceId === spaceId);
    const scopedAttachments = attachmentRows.filter((attachment) => attachment.spaceId === spaceId);
    const exactQueryWasCapped = exactPageRows.length >= MAX_EXACT_PAGE_ROWS;
    const slugQueryWasCapped = slugPageRows.length >= MAX_SLUG_PAGE_ROWS;
    const titleQueryWasCapped = titlePageRows.length >= MAX_TITLE_PAGE_ROWS;
    const aliasQueryWasCapped = aliasPageRows.length >= MAX_ALIAS_PAGE_ROWS;

    return references.map((reference) => {
      if (reference.kind === 'attachment') {
        const target = normalizeAttachmentName(reference.target).nameKey;
        const matches = scopedAttachments.filter((candidate) => candidate.nameKey === target);
        if (matches.length !== 1) {
          return matches.length > 1
            ? { key: reference.key, status: 'ambiguous' }
            : { key: reference.key, status: 'unresolved' };
        }
        const [match] = matches;
        return {
          key: reference.key,
          status: 'resolved',
          kind: 'attachment',
          attachmentId: match.id,
          displayName: match.displayName,
          mimeType: match.mimeType,
          width: match.width,
          height: match.height,
        };
      }

      if (IMAGE_EXTENSION.test(reference.target.trim())) {
        return { key: reference.key, status: 'unresolved' };
      }
      const target = normalizeMarkdownPageIdentity(reference.target);
      const fallbackTarget = withoutMarkdownSuffix(target);
      const exactIdMatches = scopedExactPages.filter((candidate) => (
        normalizeMarkdownPageIdentity(candidate.id) === target
      ));
      if (exactIdMatches.length > 1) return ambiguousPageResult(reference.key, exactIdMatches);
      if (exactIdMatches.length === 1) return pageResult(reference.key, exactIdMatches[0]);

      const qualified = reference.target.trim().includes('/');
      if (!qualified) {
        if (titleQueryWasCapped) return { key: reference.key, status: 'ambiguous' };
        const titleMatches = scopedTitlePages.filter((candidate) => {
          const title = normalizeMarkdownPageIdentity(candidate.title);
          return title === target || (fallbackTarget !== target && title === fallbackTarget);
        });
        if (sourcePage) {
          const sameFolderMatches = titleMatches.filter((candidate) => (
            candidate.folderId === sourcePage.folderId
          ));
          if (sameFolderMatches.length > 1) {
            return ambiguousPageResult(reference.key, sameFolderMatches);
          }
          if (sameFolderMatches.length === 1) {
            return pageResult(reference.key, sameFolderMatches[0]);
          }
        }
        if (titleMatches.length > 1) return ambiguousPageResult(reference.key, titleMatches);
        if (titleMatches.length === 1) return pageResult(reference.key, titleMatches[0]);

        if (slugQueryWasCapped) return { key: reference.key, status: 'ambiguous' };
        const slugMatches = scopedSlugPages.filter((candidate) => {
          const slug = normalizeMarkdownPageIdentity(candidate.slug);
          return slug === target || (fallbackTarget !== target && slug === fallbackTarget);
        });
        if (slugMatches.length > 1) return ambiguousPageResult(reference.key, slugMatches);
        if (slugMatches.length === 1) return pageResult(reference.key, slugMatches[0]);
        return { key: reference.key, status: 'unresolved' };
      }

      const pathTargets = referencePathKeys(reference.target, sourcePage?.syncPath);
      for (const targetPathKey of pathTargets) {
        const currentMatches = scopedExactPages.filter((candidate) => (
          normalizeMarkdownPageIdentity(candidate.syncPath) === targetPathKey
        ));
        if (currentMatches.length > 1) return ambiguousPageResult(reference.key, currentMatches);
        if (currentMatches.length === 1) return pageResult(reference.key, currentMatches[0]);
      }
      if (exactQueryWasCapped) return { key: reference.key, status: 'ambiguous' };

      if (aliasQueryWasCapped) return { key: reference.key, status: 'ambiguous' };
      for (const targetPathKey of pathTargets) {
        const aliasMatches = scopedAliasPages.filter((candidate) => (
          normalizeMarkdownPageIdentity(candidate.aliasPathKey) === targetPathKey
        ));
        if (aliasMatches.length > 1) return ambiguousPageResult(reference.key, aliasMatches);
        if (aliasMatches.length === 1) return pageResult(reference.key, aliasMatches[0]);
      }
      return { key: reference.key, status: 'unresolved' };
    });
  }
}
