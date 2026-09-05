import { ExistingRunOrchestrationService } from './existing-run-orchestration.service';
import { BusinessException } from '../core/filters/business-error';

const principal = { userId: 'human-1' };

describe('ExistingRunOrchestrationService', () => {
  function harness() {
    const tx: any = Object.assign({
      collaborationRunEvent: { findFirst: jest.fn().mockResolvedValue(null) },
      space: { findUnique: jest.fn().mockResolvedValue({ contentTreeRevision: 4n }) },
    }, { contentTreeRevision: 4n });
    const prisma: any = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const authorization: any = {
      lockLiveHumanPrincipal: jest.fn(),
      assertLiveHumanSpaceAccess: jest.fn().mockResolvedValue({ role: 'editor' }),
    };
    const contentTree: any = { lockPageMutationSpace: jest.fn().mockResolvedValue(tx) };
    const sources: any = {
      assertExistingPageScope: jest.fn().mockResolvedValue({ pageIds: ['page-1'] }),
      prepareExistingRunSource: jest.fn().mockResolvedValue({
      name: 'Existing group', source: { kind: 'page_selection', templateVersion: 1 },
	      definition: { schemaVersion: 1, inputs: [], roleSlots: [], nodes: [], dependencies: [], terminalNodeIds: [] },
	      taskPageIds: {}, defaultBindings: [], pageIds: ['page-1'], pages: [{ pageId: 'page-1', title: 'Page' }],
	      issues: [], sourceInstantiationId: null,
    }),
    };
    const pageBindings: any = {
      readBindings: jest.fn().mockResolvedValue([{ pageId: 'page-1', agentId: null, roleSlotKey: null, updatedAt: null }]),
      setBindings: jest.fn().mockResolvedValue([]),
      setBindingsForExactScope: jest.fn().mockResolvedValue([]),
    };
    const expansion: any = { createStarted: jest.fn().mockResolvedValue('run-1') };
    const events: any = { executeIdempotent: jest.fn(async (_tx: any, _scope: any, fn: any) => fn()), findReplay: jest.fn() };
    const notifications: any = { publishCurrentRun: jest.fn() };
    return {
      service: new ExistingRunOrchestrationService(
        prisma, authorization, contentTree, sources, pageBindings, expansion, events, notifications,
      ),
      tx, authorization, contentTree, sources, pageBindings, expansion, events,
    };
  }

  it('previews an explicit selection without writes or silently adding a new child Page', async () => {
    const h = harness();
    const result = await h.service.preview('space-1', 'folder-1', {
      source: { kind: 'page_selection' }, pageIds: ['page-1'], collaborationInputs: {}, bindings: [],
    }, principal as any);
    expect(result).toEqual(expect.objectContaining({
      pageIds: ['page-1'], treeRevision: 4n, inputDefinitions: [],
    }));
    expect(h.sources.prepareExistingRunSource).toHaveBeenCalledWith(h.tx, 'space-1', 'folder-1', expect.objectContaining({
      pageIds: ['page-1'],
    }));
    expect(h.pageBindings.setBindings).not.toHaveBeenCalled();
    expect(h.expansion.createStarted).not.toHaveBeenCalled();
  });

  it('saves optional bindings and starts one Run in the same caller transaction', async () => {
    const h = harness();
    const result = await h.service.start('space-1', 'folder-1', {
      source: { kind: 'page_selection' }, pageIds: ['page-1'], collaborationInputs: {}, bindings: [],
      bindingEdits: [{ pageId: 'page-1', agentId: 'agent-1', roleSlotKey: 'writer', expectedUpdatedAt: null }],
      name: 'Next run', expectedTreeRevision: 4n, idempotencyKey: 'next-run-0001',
    }, principal as any);
    expect(result).toEqual({ runId: 'run-1' });
    expect(h.pageBindings.setBindings).toHaveBeenCalledWith(h.tx, 'space-1', expect.any(Array), principal);
    expect(h.expansion.createStarted).toHaveBeenCalledWith(h.tx, expect.objectContaining({
      spaceId: 'space-1', name: 'Next run',
    }), principal);
  });

  it('revalidates current access before replay', async () => {
    const h = harness();
    h.tx.collaborationRunEvent.findFirst.mockResolvedValue({ runId: 'run-existing' });
    h.events.findReplay.mockResolvedValue({ runId: 'run-existing' });
    await h.service.start('space-1', 'folder-1', {
      source: { kind: 'page_selection' }, pageIds: ['page-1'], collaborationInputs: {}, bindings: [],
      name: 'Next run', expectedTreeRevision: 1n, idempotencyKey: 'next-run-0001',
    }, principal as any);
    expect(h.authorization.assertLiveHumanSpaceAccess.mock.invocationCallOrder[0])
      .toBeLessThan(h.events.findReplay.mock.invocationCallOrder[0]);
    expect(h.expansion.createStarted).not.toHaveBeenCalled();
  });

  it('rejects a Viewer before source resolution or any binding or Run write', async () => {
    const h = harness();
    h.authorization.assertLiveHumanSpaceAccess.mockRejectedValueOnce(
      new BusinessException('SPACE_ACCESS_DENIED'),
    );
    await expect(h.service.start('space-1', 'folder-1', {
      source: { kind: 'page_selection' }, pageIds: ['page-1'], collaborationInputs: {}, bindings: [],
      name: 'Denied run', expectedTreeRevision: 4n, idempotencyKey: 'denied-run-0001',
    }, principal as any)).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    expect(h.sources.prepareExistingRunSource).not.toHaveBeenCalled();
    expect(h.pageBindings.setBindings).not.toHaveBeenCalled();
    expect(h.expansion.createStarted).not.toHaveBeenCalled();
    expect(h.events.executeIdempotent).not.toHaveBeenCalled();
  });

  it('validates every Folder binding page against the route Folder subtree', async () => {
    const h = harness();
    await expect(h.service.previewFolderBindings(
      'space-1', 'folder-1', ['page-1'], principal as any,
    )).resolves.toEqual({
      treeRevision: 4n,
      pages: [{ pageId: 'page-1', agentId: null, roleSlotKey: null, updatedAt: null }],
    });
    expect(h.sources.assertExistingPageScope).toHaveBeenCalledWith(
      h.tx, 'space-1', 'folder-1', ['page-1'], { requireFolder: true },
    );
    expect(h.pageBindings.readBindings).toHaveBeenCalledWith(h.tx, 'space-1', ['page-1']);
  });

  it('discovers a bounded Folder subtree when no binding page selection exists yet', async () => {
    const h = harness();
    h.sources.discoverExistingFolderPages = jest.fn().mockResolvedValue([
      { pageId: 'page-1', title: 'One' }, { pageId: 'page-2', title: 'Two' },
    ]);
    h.pageBindings.readBindings.mockResolvedValue([
      { pageId: 'page-1', agentId: null, roleSlotKey: null, updatedAt: null },
      { pageId: 'page-2', agentId: null, roleSlotKey: null, updatedAt: null },
    ]);
    const result = await h.service.previewFolderBindings(
      'space-1', 'folder-1', undefined, principal as any,
    );
    expect(result).toEqual({
      treeRevision: 4n,
      pages: [
        { pageId: 'page-1', title: 'One', agentId: null, roleSlotKey: null, updatedAt: null },
        { pageId: 'page-2', title: 'Two', agentId: null, roleSlotKey: null, updatedAt: null },
      ],
    });
    expect(h.sources.discoverExistingFolderPages).toHaveBeenCalledWith(
      h.tx, 'space-1', 'folder-1',
    );
  });

  it('saves an exact Folder binding scope under the human and Space locks', async () => {
    const h = harness();
    const edits = [{ pageId: 'page-1', agentId: null, roleSlotKey: null, expectedUpdatedAt: null }];
    await h.service.setFolderBindings('space-1', 'folder-1', {
      pageIds: ['page-1'], expectedTreeRevision: 4n, edits,
    }, principal as any);
    expect(h.authorization.lockLiveHumanPrincipal).toHaveBeenCalledWith(h.tx, principal);
    expect(h.sources.assertExistingPageScope).toHaveBeenCalledWith(
      h.tx, 'space-1', 'folder-1', ['page-1'], { requireFolder: true },
    );
    expect(h.pageBindings.setBindingsForExactScope).toHaveBeenCalledWith(
      h.tx, 'space-1', ['page-1'], edits, principal,
    );
  });

  it('reports required Run inputs as preview issues before start', async () => {
    const h = harness();
    h.sources.prepareExistingRunSource.mockResolvedValueOnce({
      name: 'Existing group', source: { kind: 'page_selection', templateVersion: 1 },
      definition: {
        schemaVersion: 1,
        inputs: [{ key: 'brief', label: 'Brief', type: 'long_text', required: true }],
        roleSlots: [], nodes: [], dependencies: [], terminalNodeIds: [],
      },
	      taskPageIds: {}, defaultBindings: [], pageIds: ['page-1'], pages: [{ pageId: 'page-1', title: 'Page' }],
	      issues: [], sourceInstantiationId: null,
    });
    const result = await h.service.preview('space-1', 'folder-1', {
      source: { kind: 'page_selection' }, pageIds: ['page-1'], collaborationInputs: {}, bindings: [],
    }, principal as any);
    expect(result.issues).toContainEqual({ code: 'COLLABORATION_INPUT_REQUIRED', inputKey: 'brief' });
  });

  it('returns Page metadata and a role-required issue for an unbound preview', async () => {
    const h = harness();
    h.sources.prepareExistingRunSource.mockResolvedValueOnce({
      name: 'Existing group', source: { kind: 'page_selection', templateVersion: 1 },
      definition: null, taskPageIds: {}, defaultBindings: [], pageIds: ['page-1'],
      pages: [{ pageId: 'page-1', title: 'Page' }],
      issues: [{ code: 'PAGE_ROLE_REQUIRED', pageId: 'page-1' }],
      sourceInstantiationId: null,
    });
    const result = await h.service.preview('space-1', 'folder-1', {
      source: { kind: 'page_selection' }, pageIds: ['page-1'], collaborationInputs: {}, bindings: [],
    }, principal as any);
    expect(result).toEqual(expect.objectContaining({
      pages: [{ pageId: 'page-1', title: 'Page' }],
      tasks: [], roles: [], assignments: [], participants: [],
      issues: [{ code: 'PAGE_ROLE_REQUIRED', pageId: 'page-1' }],
    }));
  });

  it('blocks start before binding or Run writes while a selected Page still lacks a responsibility', async () => {
    const h = harness();
    h.sources.prepareExistingRunSource.mockResolvedValueOnce({
      name: 'Existing group', source: { kind: 'page_selection', templateVersion: 1 },
      definition: null, taskPageIds: {}, defaultBindings: [], pageIds: ['page-1'],
      pages: [{ pageId: 'page-1', title: 'Page' }],
      issues: [{ code: 'PAGE_ROLE_REQUIRED', pageId: 'page-1' }],
      sourceInstantiationId: null,
    });
    await expect(h.service.start('space-1', 'folder-1', {
      source: { kind: 'page_selection' }, pageIds: ['page-1'], collaborationInputs: {}, bindings: [],
      name: 'Blocked run', expectedTreeRevision: 4n, idempotencyKey: 'blocked-run-0001',
    }, principal as any)).rejects.toMatchObject({
      businessCode: 'COLLABORATION_TEMPLATE_INVALID',
    });
    expect(h.pageBindings.setBindings).not.toHaveBeenCalled();
    expect(h.expansion.createStarted).not.toHaveBeenCalled();
    expect(h.events.executeIdempotent).not.toHaveBeenCalled();
  });
});
