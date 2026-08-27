import { Injectable } from '@nestjs/common';
import { pathKey } from '@neomei/agentwiki-sync-protocol';
import { Prisma } from '@prisma/client';
import { normalizeAttachmentName } from '../attachments/attachment.service';
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
const MAX_ATTACHMENT_ROWS = 100;

interface PageRow {
  id: string;
  spaceId: string;
  title: string;
  slug: string;
  syncPath: string;
  syncPathKey: string;
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
    const pagePathTargets = unique(pageReferences.map((reference) => pathKey(reference.target.trim())));
    const pageFallbackTargets = unique(pageTargets.map(withoutMarkdownSuffix));
    const titleTargets = unique([...pageTargets, ...pageFallbackTargets]);
    const attachmentTargets = unique(attachmentReferences.map((reference) => (
      normalizeAttachmentName(reference.target).nameKey
    )));

    const exactPageRows = pageTargets.length > 0
      ? await this.prisma.page.findMany({
          where: {
            spaceId,
            deletedAt: null,
            OR: [
              { id: { in: pageTargets } },
              { syncPathKey: { in: pagePathTargets } },
            ],
          },
          select: {
            id: true,
            spaceId: true,
            title: true,
            slug: true,
            syncPath: true,
            syncPathKey: true,
          },
          take: MAX_EXACT_PAGE_ROWS,
        }) as PageRow[]
      : [];
    const slugPageRows = titleTargets.length > 0
      ? await this.prisma.$queryRaw<PageRow[]>(Prisma.sql`
          SELECT "id", "spaceId", "title", "slug", "syncPath", "syncPathKey"
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
          SELECT "id", "spaceId", "title", "slug", "syncPath", "syncPathKey"
          FROM "Page"
          WHERE "spaceId" = ${spaceId}
            AND "deletedAt" IS NULL
            AND markdown_page_identity("title") IN (${Prisma.join(titleTargets)})
          ORDER BY "id" ASC
          LIMIT ${MAX_TITLE_PAGE_ROWS}
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

    const scopedExactPages = exactPageRows.filter((page) => page.spaceId === spaceId);
    const scopedSlugPages = slugPageRows.filter((page) => page.spaceId === spaceId);
    const scopedTitlePages = titlePageRows.filter((page) => page.spaceId === spaceId);
    const scopedAttachments = attachmentRows.filter((attachment) => attachment.spaceId === spaceId);
    const slugQueryWasCapped = slugPageRows.length >= MAX_SLUG_PAGE_ROWS;
    const titleQueryWasCapped = titlePageRows.length >= MAX_TITLE_PAGE_ROWS;

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
      const targetPathKey = pathKey(reference.target.trim());
      const fallbackTarget = withoutMarkdownSuffix(target);
      const tiers: PageRow[][] = [
        scopedExactPages.filter((candidate) => normalizeMarkdownPageIdentity(candidate.id) === target),
        scopedExactPages.filter((candidate) => pathKey(candidate.syncPath) === targetPathKey),
      ];
      for (const matches of tiers) {
        if (matches.length > 1) return { key: reference.key, status: 'ambiguous' };
        if (matches.length === 1) return pageResult(reference.key, matches[0]);
      }
      if (slugQueryWasCapped) return { key: reference.key, status: 'ambiguous' };
      const slugMatches = scopedSlugPages.filter((candidate) => {
        const slug = normalizeMarkdownPageIdentity(candidate.slug);
        return slug === target || (fallbackTarget !== target && slug === fallbackTarget);
      });
      if (slugMatches.length > 1) return { key: reference.key, status: 'ambiguous' };
      if (slugMatches.length === 1) return pageResult(reference.key, slugMatches[0]);
      const titleMatches = scopedTitlePages.filter((candidate) => {
        const title = normalizeMarkdownPageIdentity(candidate.title);
        return title === target || (fallbackTarget !== target && title === fallbackTarget);
      });
      if (titleMatches.length > 1 || titleQueryWasCapped) {
        return { key: reference.key, status: 'ambiguous' };
      }
      if (titleMatches.length === 1) return pageResult(reference.key, titleMatches[0]);
      return { key: reference.key, status: 'unresolved' };
    });
  }
}
