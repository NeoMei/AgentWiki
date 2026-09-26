import { ProjectTaskboardService } from './project-taskboard.service';
import { BusinessException, getBusinessCode } from '../core/filters/business-error';

const PLAN = [
  '# Login Flow Implementation Plan',
  '',
  '**Goal:** Build the login flow.',
  '',
  '### Task 1: Add the login contract',
  '',
  '- [ ] **Step 1: Write the failing test**',
  '- [x] **Step 2: Run the test**',
].join('\n');

import { makeDb } from './testing/fake-taskboard-db';

function makeService(db = makeDb()) {
  const authorization = { assertSpaceAccess: jest.fn(async () => ({ role: 'owner' })) };
  const redis = { publish: jest.fn(async () => undefined) };
  const service = new ProjectTaskboardService(db.prisma, authorization as any, redis as any);
  return { service, authorization, redis, ...db };
}

describe('ProjectTaskboardService', () => {
  it('imports manual JSON tasks with their hierarchy, execution fields and stable IDs', async () => {
    const { service, db } = makeService();
    const tasks = [
      { id: 'root', title: 'Root', kind: 'phase', status: 'todo' },
      { id: 'job', parent_id: 'root', title: 'Local job', kind: 'task', status: 'done', owner: 'local-agent',
        started_at: '2026-09-20T01:00:00Z', completed_at: '2026-09-20T02:00:00Z',
        claim: { owner: 'user:forged' }, status_history: [{ from: 'todo', to: 'done', by: 'user:forged' }] },
    ];
    const dto = { content: JSON.stringify({ schema_version: 1, project: 'Local board', tasks }), sourcePath: 'board.json' };
    const first = await service.importPlan({ userId: 'u1' }, 'space-1', dto);
    expect(first.summary).toEqual({ added: 2, updated: 0 });
    const { board } = await service.getBoard({ userId: 'u1' }, 'space-1');
    expect(board.source_type).toBe('manual');
    expect(board.tasks.find((x) => x.id === 'job')).toMatchObject({
      parent_id: 'root', title: 'Local job', status: 'done', owner: 'local-agent',
      completed_at: '2026-09-20T02:00:00.000Z',
    });
    expect(board.tasks.find((x) => x.id === 'job')?.claim).toBeUndefined();
    expect(JSON.stringify(board.tasks)).not.toContain('user:forged');
    await service.updateStatus({ userId: 'u1' }, 'space-1', 'job', { status: 'blocked', current_step: 'remote review' });
    const second = await service.importPlan({ userId: 'u1' }, 'space-1', dto);
    expect(second.summary).toEqual({ added: 0, updated: 2 });
    expect(second.board.tasks.find((x) => x.id === 'job')).toMatchObject({ status: 'blocked', current_step: 'remote review' });
    expect(db.tasks).toHaveLength(2);
  });

  it.each(['{broken', '{"tasks":[{"id":"t","title":"Task","kind":"task","status":"invalid"}]}'])('rejects invalid JSON before persistence: %s', async (content) => {
    const { service, db } = makeService();
    await expect(service.importPlan({ userId: 'u1' }, 'space-1', { content, sourcePath: 'board.json' })).rejects.toThrow();
    expect(db.boards).toHaveLength(0);
    expect(db.tasks).toHaveLength(0);
  });

  it('rejects a document without executable tasks before creating a board', async () => {
    const { service, db } = makeService();
    await expect(service.importPlan({ userId: 'u1' }, 'space-1', {
      content: '# 项目规划\n\n## 里程碑\n讨论范围。', sourcePath: 'roadmap.md',
    })).rejects.toThrow('### Task');
    expect(db.boards).toHaveLength(0);
    expect(db.tasks).toHaveLength(0);
  });

  it('auto-creates the board and persists a created task', async () => {
    const { service, db } = makeService();
    const { task, board_updated_at } = await service.createTask({ userId: 'u1' } as any, 'space-1', {
      title: '搭建看板',
      owner: 'neomei',
    });
    expect(task.title).toBe('搭建看板');
    expect(task.kind).toBe('task');
    expect(task.status).toBe('todo');
    expect(board_updated_at).toBeTruthy();
    expect(db.boards).toHaveLength(1);
    expect(db.boards[0].project).toBe('演示空间');
    expect(db.tasks).toHaveLength(1);
    expect(db.tasks[0].title).toBe('搭建看板');
  });

  it('rejects duplicate ids and missing parents with business error codes', async () => {
    const { service } = makeService();
    await service.createTask({ userId: 'u1' } as any, 'space-1', { id: 'task-1', title: 'A' });
    await expect(service.createTask({ userId: 'u1' } as any, 'space-1', { id: 'task-1', title: 'B' }))
      .rejects.toMatchObject({ businessCode: 'TASKBOARD_DUPLICATE_ID' });
    await expect(service.createTask({ userId: 'u1' } as any, 'space-1', { title: 'B', parent_id: 'missing' }))
      .rejects.toMatchObject({ businessCode: 'TASKBOARD_PARENT_NOT_FOUND' });
  });

  it('reports status idempotently with started/completed stamps and history', async () => {
    const { service } = makeService();
    await service.createTask({ userId: 'u1' } as any, 'space-1', { id: 'task-1', title: '实现' });
    const first = await service.updateStatus({ agentId: 'a1' } as any, 'space-1', 'task-1', {
      status: 'in_progress',
      current_step: '写失败测试',
    });
    expect(first.task.started_at).toBeTruthy();
    expect(first.task.status_history).toHaveLength(1);

    const second = await service.updateStatus({ agentId: 'a1' } as any, 'space-1', 'task-1', {
      status: 'in_progress',
    });
    expect(second.task.status_history).toHaveLength(1);
    expect(second.task.current_step).toBe('写失败测试');

    const done = await service.updateStatus({ agentId: 'a1' } as any, 'space-1', 'task-1', { status: 'done' });
    expect(done.task.completed_at).toBeTruthy();
    expect(done.task.status_history).toHaveLength(2);
  });

  it('rejects unknown patch fields', async () => {
    const { service } = makeService();
    await service.createTask({ userId: 'u1' } as any, 'space-1', { id: 'task-1', title: '实现' });
    const error = await service
      .patchTask({ userId: 'u1' } as any, 'space-1', 'task-1', { nickname: 'x' } as any)
      .catch((exc: unknown) => exc);
    expect(error).toBeInstanceOf(BusinessException);
    expect(getBusinessCode(error)).toBe('TASKBOARD_INVALID');
  });

  it('imports a plan and preserves live execution fields on re-import', async () => {
    const { service } = makeService();
    const imported = await service.importPlan({ userId: 'u1' } as any, 'space-1', {
      content: PLAN,
      source_path: 'docs/superpowers/plans/login.md',
    });
    expect(imported.summary).toEqual({ added: 4, updated: 0 });
    expect(imported.board.tasks).toHaveLength(4);
    expect(imported.board.source_type).toBe('superpowers_plan');

    const taskId = imported.board.tasks[1].id;
    await service.updateStatus({ agentId: 'a1' } as any, 'space-1', taskId, {
      status: 'blocked',
      current_step: '等待评审',
    });
    const reimported = await service.importPlan({ userId: 'u1' } as any, 'space-1', {
      content: PLAN,
      source_path: 'docs/superpowers/plans/login.md',
      sync_status: true,
    });
    expect(reimported.summary).toEqual({ added: 0, updated: 4 });
    const persisted = reimported.board.tasks.find((task) => task.id === taskId);
    expect(persisted?.status).toBe('blocked');
    expect(persisted?.current_step).toBe('等待评审');
  });

  it('returns an empty board for spaces that never initialized one', async () => {
    const { service } = makeService();
    const { board, read_at } = await service.getBoard({ userId: 'u1' } as any, 'space-1');
    expect(board.tasks).toEqual([]);
    expect(board.project).toBe('演示空间');
    expect(board.updated_at).toBeNull();
    expect(read_at).toBeTruthy();
  });

  it('attributes status history to the acting agent or user', async () => {
    const { service } = makeService();
    await service.createTask({ userId: 'u1' } as any, 'space-1', { id: 'task-1', title: '实现' });
    await service.updateStatus({ agentId: 'a1' } as any, 'space-1', 'task-1', { status: 'in_progress' });
    const board = await service.getBoard({ userId: 'u1' } as any, 'space-1');
    const history = board.board.tasks[0].status_history ?? [];
    expect(history[history.length - 1]).toMatchObject({ from: 'todo', to: 'in_progress', by: 'agent:a1' });

    await service.updateStatus({ userId: 'u9' } as any, 'space-1', 'task-1', { status: 'done', takeover: true });
    const after = await service.getBoard({ userId: 'u1' } as any, 'space-1');
    const late = after.board.tasks[0].status_history ?? [];
    expect(late[late.length - 1]).toMatchObject({ from: 'in_progress', to: 'done', by: 'user:u9' });
  });

  it('rejects stale expected_status with a conflict', async () => {
    const { service } = makeService();
    await service.createTask({ userId: 'u1' } as any, 'space-1', { id: 'task-1', title: '实现' });
    await expect(service.updateStatus({ agentId: 'a1' } as any, 'space-1', 'task-1', {
      status: 'done',
      expected_status: 'in_progress',
    })).rejects.toMatchObject({ businessCode: 'TASKBOARD_STATUS_CONFLICT' });
    await expect(service.updateStatus({ agentId: 'a1' } as any, 'space-1', 'task-1', {
      status: 'in_progress',
      expected_status: 'todo',
    })).resolves.toMatchObject({ task: { status: 'in_progress' } });
  });

  it('enforces task claims between agents with explicit takeover', async () => {
    const { service } = makeService();
    await service.createTask({ userId: 'u1' } as any, 'space-1', { id: 'task-1', title: '实现' });
    await service.updateStatus({ agentId: 'a1' } as any, 'space-1', 'task-1', { status: 'in_progress' });
    await expect(service.updateStatus({ agentId: 'a2' } as any, 'space-1', 'task-1', { status: 'in_progress' }))
      .rejects.toMatchObject({ businessCode: 'TASKBOARD_TASK_CLAIMED' });
    await expect(service.updateStatus({ agentId: 'a2' } as any, 'space-1', 'task-1', { status: 'in_progress', takeover: true }))
      .resolves.toMatchObject({ task: { claim: { owner: 'agent:a2' } } });
    await expect(service.updateStatus({ agentId: 'a1' } as any, 'space-1', 'task-1', { status: 'done' }))
      .rejects.toMatchObject({ businessCode: 'TASKBOARD_TASK_CLAIMED' });
    await service.updateStatus({ agentId: 'a2' } as any, 'space-1', 'task-1', { status: 'done' });
  });

  it('blocks in_progress until depends_on tasks are done', async () => {
    const { service } = makeService();
    await service.createTask({ userId: 'u1' } as any, 'space-1', { id: 'dep', title: '依赖任务' });
    await service.createTask({ userId: 'u1' } as any, 'space-1', { id: 'main', title: '主任务', depends_on: ['dep'] });
    await expect(service.updateStatus({ agentId: 'a1' } as any, 'space-1', 'main', { status: 'in_progress' }))
      .rejects.toMatchObject({ businessCode: 'TASKBOARD_DEPENDENCY_UNMET' });
    await service.updateStatus({ agentId: 'a1' } as any, 'space-1', 'dep', { status: 'done' });
    await expect(service.updateStatus({ agentId: 'a1' } as any, 'space-1', 'main', { status: 'in_progress' }))
      .resolves.toMatchObject({ task: { status: 'in_progress' } });
  });

  it('records actor-attributed events and publishes a change notification', async () => {
    const { service, redis } = makeService();
    await service.createTask({ userId: 'u1' } as any, 'space-1', { id: 'task-1', title: '实现' });
    await service.updateStatus({ agentId: 'a1' } as any, 'space-1', 'task-1', { status: 'in_progress' });
    const feed = await service.listEvents({ userId: 'u1' } as any, 'space-1');
    expect(feed.event_sequence).toBe(2);
    expect(feed.events[0]).toMatchObject({ operation: 'status', actor_kind: 'agent', actor_id: 'a1' });
    expect(feed.events[1]).toMatchObject({ operation: 'create', actor_kind: 'user', actor_id: 'u1' });
    expect(redis.publish).toHaveBeenCalledWith(
      'agentwiki:taskboard:boards',
      expect.stringContaining('eventSequence'),
    );
  });

  it('imports a plan from a wiki page by pageId without local files', async () => {
    const { service, db } = makeService();
    db.pages.push({
      id: 'page-1',
      spaceId: 'space-1',
      title: '登录流程计划',
      content: ['# 页面计划 Implementation Plan', '', '**Goal:** from page.', '', '### Task 1: 页面任务', '', '- [x] **Step 1: 完成**'].join('\n'),
    });
    const result = await service.importPlan({ userId: 'u1' } as any, 'space-1', { pageId: 'page-1' });
    expect(result.board.tasks.length).toBe(3);
    expect(result.board.source_type).toBe('superpowers_plan');
    expect(result.board.sources).toEqual(['agentwiki-page:page-1']);
    expect(db.pages).toHaveLength(1);
  });

  it('rejects pageId import when the page is missing', async () => {
    const { service } = makeService();
    await expect(service.importPlan({ userId: 'u1' } as any, 'space-1', { pageId: 'nope' }))
      .rejects.toMatchObject({ businessCode: 'RESOURCE_NOT_FOUND' });
  });
});
