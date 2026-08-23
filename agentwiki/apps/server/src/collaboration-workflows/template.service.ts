import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { CollaborationTemplateDefinitionSchema, type CollaborationTemplateDefinition } from '@neomei/agentwiki-sync-protocol';
import { PrismaService } from '../database/prisma.service';
import { AuthorizationService, type Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { BUILT_IN_COLLABORATION_TEMPLATES, type BuiltInCollaborationTemplate } from './template-definitions';
import { validateCollaborationTemplate } from './template-validator';
import type { CreateTemplateDto } from './template.dto';

const READ_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
const MANAGE_ROLES = ['owner', 'admin'] as const;

@Injectable()
export class TemplateService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const role = String(this.config.get('PROCESS_ROLE') || 'api').toLowerCase();
    if (role === 'api' || role === 'all') await this.seedBuiltIns();
  }

  async seedBuiltIns(): Promise<void> {
    for (const seed of BUILT_IN_COLLABORATION_TEMPLATES) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.seedOne(tx, seed);
        });
      } catch (error) {
        if (!isUniqueConflict(error)) throw error;
        await this.prisma.$transaction(async (tx) => {
          const current = await tx.collaborationTemplate.findUnique({
            where: { scopeKey_slug: { scopeKey: 'system', slug: seed.slug } },
          });
          if (current?.system && (current.seedVersion ?? 0) < seed.seedVersion) {
            await this.updateSeed(tx, current.id, seed);
          }
        });
      }
    }
  }

  async list(spaceId: string, principal: Principal) {
    await this.authorization.assertSpaceAccess(principal, spaceId, [...READ_ROLES]);
    return this.prisma.collaborationTemplate.findMany({
      where: {
        archivedAt: null,
        OR: [{ system: true, scopeKey: 'system', spaceId: null }, { system: false, spaceId, scopeKey: spaceId }],
      },
      orderBy: [{ system: 'desc' }, { name: 'asc' }, { slug: 'asc' }],
    });
  }

  async get(spaceId: string, templateId: string, principal: Principal) {
    await this.authorization.assertSpaceAccess(principal, spaceId, [...READ_ROLES]);
    const template = await this.prisma.collaborationTemplate.findFirst({
      where: {
        id: templateId,
        archivedAt: null,
        OR: [{ system: true, scopeKey: 'system', spaceId: null }, { system: false, spaceId, scopeKey: spaceId }],
      },
    });
    if (!template) throw new BusinessException('COLLABORATION_TEMPLATE_NOT_FOUND');
    return template;
  }

  async createSpaceTemplate(spaceId: string, body: CreateTemplateDto, principal: Principal) {
    await this.assertCanManage(principal, spaceId);
    const definition = this.parseDefinition(body.definition);
    return this.prisma.$transaction(async (tx) => {
      const slug = await this.allocateSlug(tx, spaceId, body.slug || body.name);
      return tx.collaborationTemplate.create({
        data: {
          spaceId,
          scopeKey: spaceId,
          slug,
          name: body.name.trim(),
          description: body.description?.trim() ?? '',
          system: false,
          definition: toJson(definition),
          createdById: principal.userId,
        },
      });
    });
  }

  async copySystemTemplate(spaceId: string, templateId: string, name: string, principal: Principal) {
    await this.assertCanManage(principal, spaceId);
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.collaborationTemplate.findUnique({ where: { id: templateId } });
      if (!source || !source.system || source.scopeKey !== 'system' || source.spaceId !== null || source.archivedAt) {
        throw new BusinessException('COLLABORATION_TEMPLATE_NOT_FOUND');
      }
      const definition = this.parseDefinition(source.definition);
      const slug = await this.allocateSlug(tx, spaceId, `${source.slug}-copy`);
      return tx.collaborationTemplate.create({
        data: {
          spaceId,
          scopeKey: spaceId,
          slug,
          name: name.trim(),
          description: source.description,
          system: false,
          definition: toJson(structuredClone(definition)),
          createdById: principal.userId,
        },
      });
    });
  }

  async validateDefinition(spaceId: string, definition: unknown, principal: Principal) {
    await this.authorization.assertSpaceAccess(principal, spaceId, [...READ_ROLES]);
    const issues = validateCollaborationTemplate(definition);
    return { valid: issues.length === 0, issues };
  }

  async updateSpaceTemplate(
    spaceId: string,
    templateId: string,
    expectedVersion: number,
    definitionInput: unknown,
    principal: Principal,
  ) {
    await this.assertCanManage(principal, spaceId);
    const definition = this.parseDefinition(definitionInput);
    const current = await this.prisma.collaborationTemplate.findUnique({ where: { id: templateId } });
    if (!current || (!current.system && current.spaceId !== spaceId)) {
      throw new BusinessException('COLLABORATION_TEMPLATE_NOT_FOUND');
    }
    if (current.system) throw new BusinessException('COLLABORATION_SYSTEM_TEMPLATE_IMMUTABLE');
    const result = await this.prisma.collaborationTemplate.updateMany({
      where: { id: templateId, spaceId, system: false, version: expectedVersion, archivedAt: null },
      data: { definition: toJson(definition), version: { increment: 1 } },
    });
    if (result.count !== 1) throw new BusinessException('COLLABORATION_TEMPLATE_VERSION_CONFLICT');
    return this.prisma.collaborationTemplate.findUniqueOrThrow({ where: { id: templateId } });
  }

  async archiveSpaceTemplate(spaceId: string, templateId: string, expectedVersion: number, principal: Principal) {
    await this.assertCanManage(principal, spaceId);
    const current = await this.prisma.collaborationTemplate.findUnique({ where: { id: templateId } });
    if (!current || (!current.system && current.spaceId !== spaceId)) {
      throw new BusinessException('COLLABORATION_TEMPLATE_NOT_FOUND');
    }
    if (current.system) throw new BusinessException('COLLABORATION_SYSTEM_TEMPLATE_IMMUTABLE');
    const result = await this.prisma.collaborationTemplate.updateMany({
      where: { id: templateId, spaceId, system: false, version: expectedVersion, archivedAt: null },
      data: { archivedAt: new Date(), version: { increment: 1 } },
    });
    if (result.count !== 1) throw new BusinessException('COLLABORATION_TEMPLATE_VERSION_CONFLICT');
    return this.prisma.collaborationTemplate.findUniqueOrThrow({ where: { id: templateId } });
  }

  private async seedOne(tx: Prisma.TransactionClient, seed: BuiltInCollaborationTemplate): Promise<void> {
    const current = await tx.collaborationTemplate.findUnique({
      where: { scopeKey_slug: { scopeKey: 'system', slug: seed.slug } },
    });
    if (!current) {
      await tx.collaborationTemplate.create({
        data: {
          scopeKey: 'system',
          slug: seed.slug,
          name: bilingual(seed.name),
          description: bilingual(seed.description),
          seedVersion: seed.seedVersion,
          system: true,
          definition: toJson(structuredClone(seed.definition)),
        },
      });
      return;
    }
    if (current.system && (current.seedVersion ?? 0) < seed.seedVersion) {
      await this.updateSeed(tx, current.id, seed);
    }
  }

  private async updateSeed(
    tx: Prisma.TransactionClient,
    id: string,
    seed: BuiltInCollaborationTemplate,
  ): Promise<void> {
    await tx.collaborationTemplate.updateMany({
      where: { id, system: true, seedVersion: { lt: seed.seedVersion } },
      data: {
        name: bilingual(seed.name),
        description: bilingual(seed.description),
        seedVersion: seed.seedVersion,
        definition: toJson(structuredClone(seed.definition)),
        archivedAt: null,
        version: { increment: 1 },
      },
    });
  }

  private parseDefinition(input: unknown): CollaborationTemplateDefinition {
    const issues = validateCollaborationTemplate(input);
    if (issues.length > 0) {
      throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', undefined, { issues });
    }
    return CollaborationTemplateDefinitionSchema.parse(input);
  }

  private async assertCanManage(principal: Principal, spaceId: string): Promise<void> {
    try {
      await this.authorization.assertSpaceAccess(principal, spaceId, [...MANAGE_ROLES]);
    } catch (error) {
      if (error instanceof BusinessException && error.businessCode === 'SPACE_ACCESS_DENIED') {
        throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
      }
      throw error;
    }
  }

  private async allocateSlug(tx: Prisma.TransactionClient, spaceId: string, value: string): Promise<string> {
    const base = slugify(value);
    for (let suffix = 1; suffix <= 100; suffix += 1) {
      const slug = suffix === 1 ? base : `${base}-${suffix}`;
      const exists = await tx.collaborationTemplate.findFirst({
        where: { scopeKey: spaceId, slug },
        select: { id: true },
      });
      if (!exists) return slug;
    }
    throw new BusinessException('COLLABORATION_TEMPLATE_VERSION_CONFLICT', 'Unable to allocate a unique template slug');
  }
}

function bilingual(value: { zh: string; en: string }): string {
  return `${value.zh} / ${value.en}`;
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 100);
  return slug || 'template';
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
