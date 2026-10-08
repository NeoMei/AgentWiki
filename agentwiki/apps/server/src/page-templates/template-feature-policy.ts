import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const COMPOSITE_TEMPLATE_SPACE_ALLOWLIST = 'COMPOSITE_TEMPLATE_SPACE_ALLOWLIST';

@Injectable()
export class TemplateFeaturePolicy {
  private readonly allowedSpaceIds: ReadonlySet<string>;

  constructor(config: ConfigService) {
    const configured = config.get<unknown>(COMPOSITE_TEMPLATE_SPACE_ALLOWLIST);
    this.allowedSpaceIds = new Set(typeof configured === 'string'
      ? configured.split(',').map((value) => value.trim()).filter((value) => value.length > 0 && value !== '*')
      : []);
  }

  /** Public action projection mirrors the existing service role gates. */
  capabilities(spaceId: string, role: string, isAgent = false) {
    const canManage = !isAgent && ['owner', 'admin'].includes(role);
    const canCreate = !isAgent && ['owner', 'admin', 'editor'].includes(role);
    const enabled = this.canCreate(spaceId);
    return {
      canManage, canCreate,
      canManageDefinitions: canManage && enabled,
      canSaveFolderTemplate: canManage && enabled,
      // Shared human authorization includes admin wherever editor is allowed.
      canBindAgent: canCreate,
      canStartPageCollaboration: canCreate && enabled,
    };
  }

  canCreate(spaceId: string): boolean {
    return this.allowedSpaceIds.has(spaceId);
  }
}
