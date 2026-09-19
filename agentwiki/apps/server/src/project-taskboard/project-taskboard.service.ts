import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { withCollaborationSerializableRetry } from '../collaboration-workflows/serializable-retry';
import { AuthorizationService, type Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { RedisService } from '../database/redis.service';
import { PrismaService } from '../database/prisma.service';
import { mergePlanIntoTasks, parseSuperpowersPlan, type ParsedSuperpowersPlan } from './plan-parser';
import { TASKBOARD_CHANNEL, TASKBOARD_CLAIM_GUARDED_STATUSES } from './taskboard-core';
import {
  applyTaskboardPatch,
  assertTaskboardTree,
  fromTaskboardColumns,
  isoNow,
  makeTaskboardTask,
  summarizeTaskboard,
  toTaskboardColumns,
  type TaskboardBoard,
  type TaskboardSummary,
  type TaskboardTask,
} from './taskboard-core';
import type { TaskboardImportPlanDto, TaskboardStatusDto, TaskboardTaskDto } from './project-taskboard.dto';

const READ_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
const WRITE_ROLES = ['owner', 'admin', 'editor'] as const;

type BoardRow = {
  id: string;
  project: string;
  schemaVersion: number;
  sourceType: string;
  sources: unknown;
  updatedAt: Date;
};

type PrismaTx = Prisma.TransactionClient;

interface TaskboardActor { kind: 'agent' | 'user'; id: string; label: string; }

interface BoardMutationResult<T> {
  board: TaskboardBoard;
  result: T;
}

interface BoardEventInput {
  actorKind: 'agent' | 'user' | 'system';
  actorId: string | null;
  operation: string;
  taskId?: string | null;
  detail: Record<string, unknown>;
}

function identityOf(principal: Principal): TaskboardActor {
  if (principal.agentId) return { kind: 'agent', id: principal.agentId, label: 'agent:' + principal.agentId };
  if (principal.userId) return { kind: 'user', id: principal.userId, label: 'user:' + principal.userId };
  return { kind: 'user', id: '', label: 'anonymous' };
}

function taskNotFound(taskId: string): BusinessException {
  return new BusinessException('TASKBOARD_TASK_NOT_FOUND', '任务不存在：' + taskId);
}

function duplicateTask(taskId: string): BusinessException {
  return new BusinessException('TASKBOARD_DUPLICATE_ID', '任务 ID 已存在：' + taskId);
}

function parentNotFound(parentId: string): BusinessException {
  return new BusinessException('TASKBOARD_PARENT_NOT_FOUND', '父任务不存在：' + parentId);
}

function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.map((item) => String(item));
  return [];
}

@Injectable()
export class ProjectTaskboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly redis: RedisService,
  ) {}

  async getBoard(principal: Principal, spaceId: string): Promise<{ board: TaskboardBoard; read_at: string }> {
    await this.authorization.assertSpaceAccess(principal, spaceId, [...READ_ROLES]);
    const board = await this.loadBoard(spaceId);
    return { board, read_at: isoNow() };
  }

  async getHealth(principal: Principal, spaceId: string): Promise<TaskboardSummary & { ok: boolean }> {
    await this.authorization.assertSpaceAccess(principal, spaceId, [...READ_ROLES]);
    const board = await this.loadBoard(spaceId);
    return { ok: true, ...summarizeTaskboard(board) };
  }

  async listTasks(principal: Principal, spaceId: string) {
    await this.authorization.assertSpaceAccess(principal, spaceId, [...READ_ROLES]);
    const board = await this.loadBoard(spaceId);
    return { tasks: board.tasks, project: board.project, updated_at: board.updated_at };
  }

  async listEvents(principal: Principal, spaceId: string, limit?: string) {
    await this.authorization.assertSpaceAccess(principal, spaceId, [...READ_ROLES]);
    const boardRow = await this.prisma.projectBoard.findUnique({
      where: { spaceId },
      select: { id: true, eventSequence: true },
    });
    if (!boardRow) return { event_sequence: 0, events: [] };
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = await this.prisma.projectBoardEvent.findMany({
      where: { boardId: boardRow.id },
      orderBy: { sequence: 'desc' },
      take,
    });
    return {
      event_sequence: boardRow.eventSequence,
      events: rows.map((row) => ({
        sequence: row.sequence,
        actor_kind: row.actorKind,
        actor_id: row.actorId,
        operation: row.operation,
        task_id: row.taskId,
        detail: row.detail,
        at: row.createdAt.toISOString(),
      })),
    };
  }

  async createTask(principal: Principal, spaceId: string, dto: TaskboardTaskDto) {
    const actor = await this.authorizeWrite(principal, spaceId);
    const { board, result } = await this.withBoardTx(spaceId, actor, async (board, tx, boardId, events) => {
      const mapping = assertTaskboardTree(board.tasks);
      const task = makeTaskboardTask(dto as Record<string, unknown>);
      if (mapping.has(task.id)) throw duplicateTask(task.id);
      if (task.parent_id && !mapping.has(task.parent_id)) throw parentNotFound(task.parent_id);
      await this.insertTask(tx, boardId, task, board.tasks.length);
      board.tasks.push(task);
      events.push({ actorKind: actor.kind, actorId: actor.id, operation: 'create', taskId: task.id, detail: { title: task.title, kind: task.kind, parent_id: task.parent_id } });
      return { task };
    });
    return { task: result.task, board_updated_at: board.updated_at };
  }

  async createChild(principal: Principal, spaceId: string, parentId: string, dto: TaskboardTaskDto) {
    const actor = await this.authorizeWrite(principal, spaceId);
    const { board, result } = await this.withBoardTx(spaceId, actor, async (board, tx, boardId, events) => {
      const mapping = assertTaskboardTree(board.tasks);
      if (!mapping.has(parentId)) throw taskNotFound(parentId);
      const task = makeTaskboardTask(dto as Record<string, unknown>, parentId);
      if (mapping.has(task.id)) throw duplicateTask(task.id);
      await this.insertTask(tx, boardId, task, board.tasks.length);
      board.tasks.push(task);
      events.push({ actorKind: actor.kind, actorId: actor.id, operation: 'create', taskId: task.id, detail: { title: task.title, kind: task.kind, parent_id: parentId } });
      return { task };
    });
    return { task: result.task, board_updated_at: board.updated_at };
  }

  async updateStatus(principal: Principal, spaceId: string, taskId: string, dto: TaskboardStatusDto) {
    const actor = await this.authorizeWrite(principal, spaceId);
    const { board, result } = await this.withBoardTx(spaceId, actor, async (board, tx, boardId, events) => {
      const mapping = assertTaskboardTree(board.tasks);
      const current = mapping.get(taskId);
      if (!current) throw taskNotFound(taskId);
      this.assertExpectedStatus(current, dto.expected_status);
      const patch: Record<string, unknown> = {};
      if (dto.status !== undefined) patch.status = dto.status;
      if (dto.current_step !== undefined) patch.current_step = dto.current_step;
      const target = String(patch.status ?? current.status ?? '');
      if (TASKBOARD_CLAIM_GUARDED_STATUSES.has(target)) {
        this.assertDependenciesMet(mapping, current);
        this.assertClaimOrTakeOver(current, actor, dto.takeover === true);
      }
      const before = current.status ?? null;
      const task = applyTaskboardPatch(current, patch, actor.label);
      await this.persistTask(tx, boardId, taskId, task);
      events.push({
        actorKind: actor.kind, actorId: actor.id, operation: 'status', taskId,
        detail: { from: before, to: task.status ?? null, current_step: task.current_step ?? null, takeover: dto.takeover === true },
      });
      return { task };
    });
    return { task: result.task, board_updated_at: board.updated_at };
  }

  async upsertTask(principal: Principal, spaceId: string, taskId: string, dto: TaskboardTaskDto) {
    const actor = await this.authorizeWrite(principal, spaceId);
    const { board, result } = await this.withBoardTx(spaceId, actor, async (board, tx, boardId, events) => {
      const mapping = assertTaskboardTree(board.tasks);
      const existing = mapping.get(taskId);
      if (existing) {
        const patch = { ...(dto as Record<string, unknown>) };
        delete patch.id;
        const expected = patch.expected_status;
        const takeover = patch.takeover;
        delete patch.expected_status;
        delete patch.takeover;
        this.assertExpectedStatus(existing, typeof expected === 'string' ? expected : undefined);
        const task = applyTaskboardPatch(existing, patch, actor.label);
        if (task.parent_id && !mapping.has(task.parent_id)) throw parentNotFound(task.parent_id);
        await this.persistTask(tx, boardId, taskId, task);
        events.push({ actorKind: actor.kind, actorId: actor.id, operation: 'update', taskId, detail: { fields: Object.keys(patch) } });
        return { task, created: false };
      }
      const task = makeTaskboardTask({ ...(dto as Record<string, unknown>), id: taskId });
      if (task.parent_id && !mapping.has(task.parent_id)) throw parentNotFound(task.parent_id);
      await this.insertTask(tx, boardId, task, board.tasks.length);
      board.tasks.push(task);
      events.push({ actorKind: actor.kind, actorId: actor.id, operation: 'create', taskId, detail: { title: task.title, kind: task.kind, upsert: true } });
      return { task, created: true };
    });
    return { task: result.task, created: result.created, board_updated_at: board.updated_at };
  }

  async patchTask(principal: Principal, spaceId: string, taskId: string, dto: TaskboardTaskDto) {
    const actor = await this.authorizeWrite(principal, spaceId);
    const { board, result } = await this.withBoardTx(spaceId, actor, async (board, tx, boardId, events) => {
      const mapping = assertTaskboardTree(board.tasks);
      const current = mapping.get(taskId);
      if (!current) throw taskNotFound(taskId);
      const patch = { ...(dto as Record<string, unknown>) };
      const expected = patch.expected_status;
      const takeover = patch.takeover;
      delete patch.expected_status;
      delete patch.takeover;
      this.assertExpectedStatus(current, typeof expected === 'string' ? expected : undefined);
      if (patch.parent_id !== undefined && patch.parent_id !== null && patch.parent_id !== '') {
        if (!mapping.has(String(patch.parent_id))) throw parentNotFound(String(patch.parent_id));
      }
      const target = patch.status === undefined ? undefined : String(patch.status);
      if (target === 'in_progress') {
        this.assertDependenciesMet(mapping, current);
        this.assertClaimOrTakeOver(current, actor, takeover === true);
      }
      const task = applyTaskboardPatch(current, patch, actor.label);
      await this.persistTask(tx, boardId, taskId, task);
      events.push({ actorKind: actor.kind, actorId: actor.id, operation: 'patch', taskId, detail: { fields: Object.keys(patch) } });
      return { task };
    });
    return { task: result.task, board_updated_at: board.updated_at };
  }

  async importPlan(principal: Principal, spaceId: string, dto: TaskboardImportPlanDto) {
    const actor = await this.authorizeWrite(principal, spaceId);
    const sourcePath = dto.sourcePath ?? dto.source_path ?? 'superpowers-plan.md';
    const syncStatus = dto.syncStatus ?? dto.sync_status ?? false;
    const incoming: ParsedSuperpowersPlan = parseSuperpowersPlan(dto.content, sourcePath);
    const { board, result } = await this.withBoardTx(
      spaceId,
      actor,
      async (board, tx, boardId, events) => {
        const summary = mergePlanIntoTasks(board, incoming, sourcePath, syncStatus);
        if (dto.project) board.project = dto.project;
        const persisted = await tx.projectBoardTask.findMany({ where: { boardId }, select: { id: true } });
        const persistedIds = new Set(persisted.map((row) => row.id));
        let nextOrdinal = persistedIds.size;
        for (const task of board.tasks) {
          if (persistedIds.has(task.id)) await this.persistTask(tx, boardId, task.id, task);
          else {
            await this.insertTask(tx, boardId, task, nextOrdinal);
            nextOrdinal += 1;
          }
        }
        events.push({ actorKind: actor.kind, actorId: actor.id, operation: 'import', taskId: null, detail: { source: sourcePath, added: summary.added, updated: summary.updated } });
        return { summary };
      },
      incoming.project,
    );
    return { board, summary: result.summary, project: board.project };
  }

  private assertExpectedStatus(task: TaskboardTask, expected?: string) {
    if (expected === undefined) return;
    if (String(task.status ?? '') !== expected) {
      throw new BusinessException(
        'TASKBOARD_STATUS_CONFLICT',
        '任务状态已并发变更为 ' + String(task.status) + '（预期 ' + expected + '），请刷新后重试',
      );
    }
  }

  private assertDependenciesMet(mapping: Map<string, TaskboardTask>, task: TaskboardTask) {
    const dependsOn = Array.isArray(task.depends_on) ? task.depends_on.map((item) => String(item)) : [];
    if (dependsOn.length === 0) return;
    const unmet = dependsOn.filter((depId) => mapping.get(depId)?.status !== 'done');
    if (unmet.length > 0) {
      throw new BusinessException('TASKBOARD_DEPENDENCY_UNMET', '依赖任务未完成：' + unmet.join(', '));
    }
  }

  private assertClaimOrTakeOver(task: TaskboardTask, actor: TaskboardActor, takeover: boolean) {
    const claim = task.claim as { owner?: string; at?: string } | undefined;
    if (!claim?.owner) {
      task.claim = { owner: actor.label, at: isoNow() };
      return;
    }
    if (claim.owner === actor.label) return;
    if (!takeover) {
      throw new BusinessException(
        'TASKBOARD_TASK_CLAIMED',
        '任务已由 ' + claim.owner + ' 认领；如需接管请携带 takeover=true',
        { claimed_by: claim.owner, claimed_at: claim.at ?? null },
      );
    }
    task.claim = { owner: actor.label, at: isoNow(), takeover_from: claim.owner };
  }

  private async authorizeWrite(principal: Principal, spaceId: string) {
    await this.authorization.assertSpaceAccess(principal, spaceId, [...WRITE_ROLES]);
    return identityOf(principal);
  }

  private async loadBoard(spaceId: string): Promise<TaskboardBoard> {
    const boardRow = await this.prisma.projectBoard.findUnique({ where: { spaceId } });
    if (!boardRow) {
      const space = await this.prisma.space.findUnique({ where: { id: spaceId }, select: { name: true } });
      return { schema_version: 1, project: space?.name ?? '', source_type: 'manual', sources: [], updated_at: null, tasks: [] };
    }
    const taskRows = await this.prisma.projectBoardTask.findMany({
      where: { boardId: boardRow.id },
      orderBy: [{ ordinal: 'asc' }, { id: 'asc' }],
    });
    return this.toBoardWire(boardRow, taskRows);
  }

  private toBoardWire(boardRow: BoardRow, taskRows: Array<Record<string, unknown>>): TaskboardBoard {
    return {
      schema_version: boardRow.schemaVersion,
      project: boardRow.project,
      source_type: boardRow.sourceType,
      sources: asStringArray(boardRow.sources),
      updated_at: boardRow.updatedAt.toISOString(),
      tasks: taskRows.map((row) => fromTaskboardColumns(row as Parameters<typeof fromTaskboardColumns>[0])),
    };
  }

  private async withBoardTx<T>(
    spaceId: string,
    actor: TaskboardActor,
    mutate: (board: TaskboardBoard, tx: PrismaTx, boardId: string, events: BoardEventInput[]) => Promise<T>,
    defaultProject?: string,
  ): Promise<BoardMutationResult<T>> {
    const outcome = await withCollaborationSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          let boardRow = await tx.projectBoard.findUnique({ where: { spaceId } });
          if (!boardRow) {
            const space = await tx.space.findUnique({ where: { id: spaceId }, select: { name: true } });
            if (!space) throw new BusinessException('SPACE_NOT_FOUND', 'Space not found: ' + spaceId);
            boardRow = await tx.projectBoard.create({ data: { spaceId, project: defaultProject ?? space.name } });
          }
          const taskRows = await tx.projectBoardTask.findMany({
            where: { boardId: boardRow.id },
            orderBy: [{ ordinal: 'asc' }, { id: 'asc' }],
          });
          const board = this.toBoardWire(boardRow, taskRows);
          const events: BoardEventInput[] = [];
          const result = await mutate(board, tx, boardRow.id, events);
          for (let index = 0; index < events.length; index += 1) {
            const event = events[index];
            await tx.projectBoardEvent.create({
              data: {
                boardId: boardRow.id,
                sequence: boardRow.eventSequence + index + 1,
                actorKind: event.actorKind,
                actorId: event.actorId,
                operation: event.operation,
                taskId: event.taskId ?? null,
                detail: event.detail as Prisma.InputJsonValue,
              },
            });
          }
          const updatedBoardRow = await tx.projectBoard.update({
            where: { id: boardRow.id },
            data: {
              project: board.project,
              sourceType: board.source_type,
              sources: board.sources,
              eventSequence: { increment: events.length },
            },
          });
          return { board, result, boardRow: updatedBoardRow, events };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
    if (outcome.events.length > 0) {
      await this.redis.publish(
        TASKBOARD_CHANNEL,
        JSON.stringify({ spaceId, boardId: outcome.boardRow.id, eventSequence: outcome.boardRow.eventSequence }),
      );
    }
    return { board: { ...outcome.board, updated_at: outcome.boardRow.updatedAt.toISOString() }, result: outcome.result };
  }

  private async insertTask(tx: PrismaTx, boardId: string, task: TaskboardTask, ordinal: number) {
    const columns = toTaskboardColumns(task, ordinal);
    await tx.projectBoardTask.create({
      data: {
        boardId,
        id: columns.id,
        parentId: columns.parentId,
        kind: columns.kind,
        title: columns.title,
        status: columns.status,
        scopeClass: columns.scopeClass,
        owner: columns.owner,
        summary: columns.summary,
        description: columns.description,
        currentStep: columns.currentStep,
        ordinal: columns.ordinal,
        startedAt: columns.startedAt,
        completedAt: columns.completedAt,
        createdAt: columns.createdAt,
        payload: columns.payload as Prisma.InputJsonValue,
        statusHistory: columns.statusHistory as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async persistTask(tx: PrismaTx, boardId: string, taskId: string, task: TaskboardTask) {
    const existing = await tx.projectBoardTask.findUnique({
      where: { boardId_id: { boardId, id: taskId } },
      select: { ordinal: true },
    });
    const columns = toTaskboardColumns(task, existing?.ordinal ?? 0);
    await tx.projectBoardTask.update({
      where: { boardId_id: { boardId, id: taskId } },
      data: {
        parentId: columns.parentId,
        kind: columns.kind,
        title: columns.title,
        status: columns.status,
        scopeClass: columns.scopeClass,
        owner: columns.owner,
        summary: columns.summary,
        description: columns.description,
        currentStep: columns.currentStep,
        startedAt: columns.startedAt,
        completedAt: columns.completedAt,
        payload: columns.payload as Prisma.InputJsonValue,
        statusHistory: columns.statusHistory as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
