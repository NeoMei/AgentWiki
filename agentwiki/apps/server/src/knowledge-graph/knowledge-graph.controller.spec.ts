import { Reflector } from '@nestjs/core';
import { KnowledgeGraphController } from './knowledge-graph.controller';

describe('KnowledgeGraphController', () => {
  const graph = {
    refresh: jest.fn().mockResolvedValue({
      wikilink: { created: 0, removed: 0, dangling: 0 },
      similar: { created: 0, removed: 0, skipped: 0 },
      llm: { changeSetId: null, proposed: 0 },
    }),
    getOrCreateState: jest.fn().mockResolvedValue({
      wikilinkEnabled: true, similarEnabled: false, similarThreshold: 0.86, llmEnabled: false, lastRunAt: null,
    }),
    updateSettings: jest.fn().mockImplementation(async (_id: string, input: any) => ({
      wikilinkEnabled: true, llmEnabled: false, ...input,
    })),
  };
  const authorization = { assertSpaceAccess: jest.fn().mockResolvedValue(undefined) };
  const controller = new KnowledgeGraphController(graph as any, authorization as any);
  const request = { user: { userId: 'user-1' } } as any;

  it('refresh requires owner/admin and delegates layers', async () => {
    await controller.refresh(request, 'space-1', { layers: ['wikilink'] });
    expect(authorization.assertSpaceAccess).toHaveBeenCalledWith(
      request.user, 'space-1', ['owner', 'admin'],
    );
    expect(graph.refresh).toHaveBeenCalledWith('space-1', ['wikilink']);
  });

  it('settings read allows viewers and write requires owner/admin', async () => {
    await controller.getSettings(request, 'space-1');
    expect(authorization.assertSpaceAccess).toHaveBeenLastCalledWith(
      request.user, 'space-1', ['owner', 'admin', 'editor', 'viewer'],
    );
    await controller.updateSettings(request, 'space-1', { similarEnabled: true, similarThreshold: 0.8 });
    expect(authorization.assertSpaceAccess).toHaveBeenLastCalledWith(
      request.user, 'space-1', ['owner', 'admin'],
    );
    expect(graph.updateSettings).toHaveBeenCalledWith('space-1', {
      wikilinkEnabled: true, similarEnabled: true, similarThreshold: 0.8, llmEnabled: false,
    });
  });
});
