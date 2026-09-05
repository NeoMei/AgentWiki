import type { Principal } from '../core/authorization/authorization.service';
import { PageResultService } from './page-result.service';

const principal: Principal = { userId: 'agent-owner', agentId: 'agent-1' };
const task = {
  id: 'task-1', runId: 'run-1', nodeId: 'write-page', generation: 2,
  name: 'Write Page', targetPageId: 'page-1', targetSpaceId: 'space-1',
  humanAcceptance: true, outputContract: { key: 'page-markdown', kind: 'markdown' },
};
const attempt = {
  id: 'attempt-1', runId: 'run-1', taskId: 'task-1', generation: 2, agentId: 'agent-1',
  basePageVersionId: 'version-current',
  basePageUpdatedAt: new Date('2026-09-05T08:00:00.000Z'),
  baseContentHash: 'a'.repeat(64),
};
const artifact = {
  id: 'artifact-1', runId: 'run-1', taskId: 'task-1', attemptId: 'attempt-1',
  generation: 2, kind: 'markdown', status: 'pending', payload: { markdown: '# Submitted' },
};

describe('PageResultService', () => {
  const tx = {
    changeSet: { create: jest.fn() },
    collaborationArtifactChangeSetLink: { findUnique: jest.fn(), create: jest.fn() },
  } as any;
  const service = new PageResultService();

  beforeEach(() => {
    jest.clearAllMocks();
    tx.collaborationArtifactChangeSetLink.findUnique.mockResolvedValue(null);
    tx.changeSet.create.mockResolvedValue({ id: 'change-set-1', items: [{ id: 'item-1' }] });
    tx.collaborationArtifactChangeSetLink.create.mockResolvedValue({
      id: 'link-1', artifactId: 'artifact-1', changeSetId: 'change-set-1',
    });
  });

  it('creates one forced-review Markdown ChangeSet and dedicated collaboration link', async () => {
    await expect(service.proposeLocked(tx, task, attempt, artifact, principal)).resolves.toMatchObject({
      changeSetId: 'change-set-1', artifactId: 'artifact-1', pageId: 'page-1',
    });

    expect(tx.changeSet.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        spaceId: 'space-1', origin: 'collaboration', status: 'pending_review',
        createdByAgentId: 'agent-1',
        items: { create: expect.objectContaining({
          type: 'update_page', status: 'pending',
          payload: {
            pageId: 'page-1',
            expectedUpdatedAt: '2026-09-05T08:00:00.000Z',
            expectedContentHash: 'a'.repeat(64),
            expectedPageVersionId: 'version-current',
            changes: { content: '# Submitted' },
          },
        }) },
      }),
      include: { items: true },
    });
    expect(tx.changeSet.create.mock.calls[0][0].data).not.toHaveProperty('runId');
    expect(tx.collaborationArtifactChangeSetLink.create).toHaveBeenCalledWith({ data: {
      artifactId: 'artifact-1', changeSetId: 'change-set-1', runId: 'run-1',
      taskId: 'task-1', spaceId: 'space-1', pageId: 'page-1',
    } });
  });

  it('rejects targeted output that exceeds the ordinary Page code-point ceiling', async () => {
    await expect(service.proposeLocked(tx, task, attempt, {
      ...artifact, payload: { markdown: '😀'.repeat(200_001) },
    }, principal)).rejects.toMatchObject({ businessCode: 'COLLABORATION_TEMPLATE_INVALID' });
    expect(tx.changeSet.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...task, targetPageId: null }, artifact],
    [{ ...task, humanAcceptance: false }, artifact],
    [{ ...task, outputContract: { key: 'data', kind: 'json' } }, artifact],
    [task, { ...artifact, kind: 'json', payload: { json: {} } }],
  ])('rejects an invalid targeted Page publication contract', async (invalidTask, invalidArtifact) => {
    await expect(service.proposeLocked(tx, invalidTask, attempt, invalidArtifact, principal))
      .rejects.toMatchObject({ businessCode: 'COLLABORATION_PROGRESS_INVARIANT' });
    expect(tx.changeSet.create).not.toHaveBeenCalled();
  });
});
