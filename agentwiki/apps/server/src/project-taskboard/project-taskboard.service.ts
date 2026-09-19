import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthorizationService, type Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { PrismaService } from '../database/prisma.service';
import {
  mergePlanIntoTasks,
  parseSuperpowersPlan,
  type ParsedSuperpowersPlan,
} from './plan-parser';
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
import type {
  TaskboardImportPlanDto,
  TaskboardStatusDto,
  TaskboardTaskDto,
} from './project-taskboard.dto';

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

interface BoardMutationResult<T> {
  board: TaskboardBoard;
  result: T;
}

function taskNotFound(taskId: string): BusinessException {
  return new BusinessException('TASKBOARD_TASK_NOT_FOUND', `任务不存在：${taskId}`);
}

function duplicateTask(taskId: string): BusinessException {
  return new BusinessException('TASKBOARD_DUPLICATE_ID', `任务 ID 已存在：${taskId}`);
}

function parentNotFound(parentId: string): BusinessException {
  return new BusinessException('TASKBOARD_PARENT_NOT_FOUND', `父任务不存在：${parentId}`);
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

  async createTask(principal: Principal, spaceId: string, dto: TaskboardTaskDto) {
    await this.authorizeWrite(principal, spaceId);
    const { board, result } = await this.withBoardTx(spaceId, async (board, tx, boardId) => {
      const mapping = assertTaskboardTree(board.tasks);
      const task = makeTaskboardTask(dto as Record<string, unknown>);
      if (mapping.has(task.id)) throw duplicateTask(task.id);
      if (task.parent_id && !mapping.has(task.parent_id)) throw parentNotFound(task.parent_id);
      await this.insertTask(tx, boardId, task, board.tasks.length);
      board.tasks.push(task);
      return { task };
    });
    return { task: result.task, board_updated_at: board.updated_at };
  }

  async createChild(principal: Principal, spaceId: string, parentId: string, dto: TaskboardTaskDto) {
    await this.authorizeWrite(principal, spaceId);
    const { board, result } = await this.withBoardTx(spaceId, async (board, tx, boardId) => {
      const mapping = assertTaskboardTree(board.tasks);
      if (!mapping.has(parentId)) throw taskNotFound(parentId);
      const task = makeTaskboardTask(dto as Record<string, unknown>, parentId);
      if (mapping.has(task.id)) throw duplicateTask(task.id);
      await this.insertTask(tx, boardId, task, board.tasks.length);
      board.tasks.push(task);
      return { task };
    });
    return { task: result.task, board_updated_at: board.updated_at };
  }

  /** Idempotent agent reporting endpoint: accepts status and current_step only. */
  async updateStatus(principal: Principal, spaceId: string, taskId: string, dto: TaskboardStatusDto) {
    await this.authorizeWrite(principal, spaceId);
    const { board, result } = await this.withBoardTx(spaceId, async (board, tx, boardId) => {
      const mapping = assertTaskboardTree(board.tasks);
      const current = mapping.get(taskId);
      if (!current) throw taskNotFound(taskId);
      const patch: Record<string, unknown> = {};
      if (dto.status !== undefined) patch.status = dto.status;
      if (dto.current_step !== undefined) patch.current_step = dto.current_step;
      const task = applyTaskboardPatch(current, patch);
      await this.persistTask(tx, boardId, taskId, task);
      return { task };
    });
    return { task: result.task, board_updated_at: board.updated_at };
  }

  async upsertTask(principal: Principal, spaceId: string, taskId: string, dto: TaskboardTaskDto) {
    await this.authorizeWrite(principal, spaceId);
    const { board, result } = await this.withBoardTx(spaceId, async (board, tx, boardId) => {
      const mapping = assertTaskboardTree(board.tasks);
      const existing = mapping.get(taskId);
      if (existing) {
        const patch = { ...(dto as Record<string, unknown>) };
        delete patch.id;
        const task = applyTaskboardPatch(existing, patch);
        if (task.parent_id && !mapping.has(task.parent_id)) throw parentNotFound(task.parent_id);
        await this.persistTask(tx, boardId, taskId, task);
        return { task, created: false };
      }
      const task = makeTaskboardTask({ ...(dto as Record<string, unknown>), id: taskId });
      if (task.parent_id && !mapping.has(task.parent_id)) throw parentNotFound(task.parent_id);
      await this.insertTask(tx, boardId, task, board.tasks.length);
      board.tasks.push(task);
      return { task, created: true };
    });
    return { task: result.task, created: result.created, board_updated_at: board.updated_at };
  }

  async patchTask(principal: Principal, spaceId: string, taskId: string, dto: TaskboardTaskDto) {
    await this.authorizeWrite(principal, spaceId);
    const { board, result } = await this.withBoardTx(spaceId, async (board, tx, boardId) => {
      const mapping = assertTaskboardTree(board.tasks);
      const current = mapping.get(taskId);
      if (!current) throw taskNotFound(taskId);
      const patch = dto as Record<string, unknown>;
      if (patch.parent_id !== undefined && patch.parent_id !== null && patch.parent_id !== '') {
        if (!mapping.has(String(patch.parent_id))) throw parentNotFound(String(patch.parent_id));
      }
      const task = applyTaskboardPatch(current, patch);
      await this.persistTask(tx, boardId, taskId, task);
      return { task };
    });
    return { task: result.task, board_updated_at: board.updated_at };
  }

  async importPlan(principal: Principal, spaceId: string, dto: TaskboardImportPlanDto) {
    await this.authorizeWrite(principal, spaceId);
    const sourcePath = dto.sourcePath ?? dto.source_path ?? 'superpowers-plan.md';
    const syncStatus = dto.syncStatus ?? dto.sync_status ?? false;
    const incoming: ParsedSuperpowersPlan = parseSuperpowersPlan(dto.content, sourcePath);
    const { board, result } = await this.withBoardTx(
      spaceId,
      async (board, tx, boardId) => {
        const summary = mergePlanIntoTasks(board, incoming, sourcePath, syncStatus);
        if (dto.project) board.project = dto.project;
        const persisted = await tx.projectBoardTask.findMany({
          where: { boardId },
          select: { id: true },
        });
        const persistedIds = new Set(persisted.map((row) => row.id));
        let nextOrdinal = persistedIds.size;
        for (const task of board.tasks) {
          if (persistedIds.has(task.id)) {
            await this.persistTask(tx, boardId, task.id, task);
          } else {
            await this.insertTask(tx, boardId, task, nextOrdinal);
            nextOrdinal += 1;
          }
        }
        return { summary };
      },
      incoming.project,
    );
    return { board, summary: result.summary, project: board.project };
  }

  private async authorizeWrite(principal: Principal, spaceId: string) {
    await this.authorization.assertSpaceAccess(principal, spaceId, [...WRITE_ROLES]);
  }

  private async loadBoard(spaceId: string): Promise<TaskboardBoard> {
    const boardRow = await this.prisma.projectBoard.findUnique({ where: { spaceId } });
    if (!boardRow) {
      const space = await this.prisma.space.findUnique({ where: { id: spaceId }, select: { name: true } });
      return {
        schema_version: 1,
        project: space?.name ?? '',
        source_type: 'manual',
        sources: [],
        updated_at: null,
        tasks: [],
      };
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
    mutate: (board: TaskboardBoard, tx: PrismaTx, boardId: string) => Promise<T>,
    defaultProject?: string,
  ): Promise<BoardMutationResult<T>> {
    const { board, result, boardRow } = await this.prisma.$transaction(
      async (tx) => {
        let boardRow = await tx.projectBoard.findUnique({ where: { spaceId } });
        if (!boardRow) {
          const space = await tx.space.findUnique({ where: { id: spaceId }, select: { name: true } });
          if (!space) {
            throw new BusinessException('SPACE_NOT_FOUND', `Space not found: ${spaceId}`);
          }
          boardRow = await tx.projectBoard.create({
            data: { spaceId, project: defaultProject ?? space.name },
          });
        }
        const taskRows = await tx.projectBoardTask.findMany({
          where: { boardId: boardRow.id },
          orderBy: [{ ordinal: 'asc' }, { id: 'asc' }],
        });
        const board = this.toBoardWire(boardRow, taskRows);
        const result = await mutate(board, tx, boardRow.id);
        const updatedBoardRow = await tx.projectBoard.update({
          where: { id: boardRow.id },
          data: {
            project: board.project,
            sourceType: board.source_type,
            sources: board.sources,
          },
        });
        return { board, result, boardRow: updatedBoardRow };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return { board: { ...board, updated_at: boardRow.updatedAt.toISOString() }, result };
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
