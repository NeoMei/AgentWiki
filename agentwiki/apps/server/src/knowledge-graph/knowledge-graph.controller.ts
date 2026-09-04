import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../core/auth/jwt-auth.guard';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { GraphRefreshService, type GraphLayer } from './graph-refresh.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class KnowledgeGraphController {
  constructor(
    private readonly graph: GraphRefreshService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Post('spaces/:id/graph/refresh')
  async refresh(@Req() req: Request, @Param('id') id: string, @Body() body: { layers?: GraphLayer[] }) {
    await this.authorization.assertSpaceAccess(req.user as any, id, ['owner', 'admin']);
    if (body === null || (body !== undefined && (typeof body !== 'object' || Array.isArray(body)))) {
      throw new BadRequestException('body must be an object');
    }
    const layers = body?.layers;
    if (layers !== undefined && (
      !Array.isArray(layers)
      || layers.some((layer) => !['wikilink', 'similar', 'llm'].includes(layer))
    )) {
      throw new BadRequestException('layers must contain only wikilink, similar, or llm');
    }
    return this.graph.refresh(id, layers, req.user as any);
  }

  @Get('spaces/:id/graph/settings')
  async getSettings(@Req() req: Request, @Param('id') id: string) {
    await this.authorization.assertSpaceAccess(req.user as any, id, ['owner', 'admin', 'editor', 'viewer']);
    const state = await this.graph.getOrCreateState(id);
    return {
      wikilinkEnabled: state.wikilinkEnabled,
      similarEnabled: state.similarEnabled,
      similarThreshold: state.similarThreshold,
      llmEnabled: state.llmEnabled,
      lastRunAt: state.lastRunAt,
    };
  }

  @Patch('spaces/:id/graph/settings')
  async updateSettings(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: {
      wikilinkEnabled?: boolean;
      similarEnabled?: boolean;
      similarThreshold?: number;
      llmEnabled?: boolean;
    },
  ) {
    await this.authorization.assertSpaceAccess(req.user as any, id, ['owner', 'admin']);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('body must be an object');
    }
    if (Object.keys(body).length === 0) {
      throw new BadRequestException('body must contain at least one graph setting');
    }
    const allowed = new Set(['wikilinkEnabled', 'similarEnabled', 'similarThreshold', 'llmEnabled']);
    if (Object.keys(body).some((key) => !allowed.has(key))) {
      throw new BadRequestException('body contains unknown graph settings');
    }
    for (const key of ['wikilinkEnabled', 'similarEnabled', 'llmEnabled'] as const) {
      if (body[key] !== undefined && typeof body[key] !== 'boolean') {
        throw new BadRequestException(`${key} must be a boolean`);
      }
    }
    if (body.similarThreshold !== undefined
      && (!Number.isFinite(body.similarThreshold) || body.similarThreshold < 0.5 || body.similarThreshold > 1)) {
      throw new BadRequestException('similarThreshold must be between 0.5 and 1');
    }
    const updated = await this.graph.updateSettings(id, body, req.user as any);
    return {
      wikilinkEnabled: updated.wikilinkEnabled,
      similarEnabled: updated.similarEnabled,
      similarThreshold: updated.similarThreshold,
      llmEnabled: updated.llmEnabled,
    };
  }
}
