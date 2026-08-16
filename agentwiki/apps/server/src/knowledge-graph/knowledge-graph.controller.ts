import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
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
    return this.graph.refresh(id, body?.layers);
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
    const current = await this.graph.getOrCreateState(id);
    if (body.similarThreshold !== undefined
      && (!Number.isFinite(body.similarThreshold) || body.similarThreshold < 0.5 || body.similarThreshold > 1)) {
      throw new Error('similarThreshold must be between 0.5 and 1');
    }
    const updated = await this.graph.updateSettings(id, {
      wikilinkEnabled: body.wikilinkEnabled ?? current.wikilinkEnabled,
      similarEnabled: body.similarEnabled ?? current.similarEnabled,
      similarThreshold: body.similarThreshold ?? current.similarThreshold,
      llmEnabled: body.llmEnabled ?? current.llmEnabled,
    });
    return {
      wikilinkEnabled: updated.wikilinkEnabled,
      similarEnabled: updated.similarEnabled,
      similarThreshold: updated.similarThreshold,
      llmEnabled: updated.llmEnabled,
    };
  }
}
