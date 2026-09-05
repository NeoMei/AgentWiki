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

  canCreate(spaceId: string): boolean {
    return this.allowedSpaceIds.has(spaceId);
  }
}
