import api from '../../api/client';
import type {
  TaskboardPlanImportInput,
  TaskboardImportResponse,
  TaskboardResponse,
  TaskboardTask,
  TaskboardTaskInput,
} from './types';

const boardBase = (spaceId: string) => '/spaces/' + spaceId + '/taskboard';

export const taskboardApi = {
  getBoard: async (spaceId: string): Promise<TaskboardResponse> =>
    (await api.get<TaskboardResponse>(boardBase(spaceId))).data,
  importPlan: async (spaceId: string, input: TaskboardPlanImportInput): Promise<TaskboardImportResponse> =>
    (await api.post<TaskboardImportResponse>(boardBase(spaceId) + '/import-plan', input)).data,
  createTask: async (spaceId: string, input: TaskboardTaskInput): Promise<{ task: TaskboardTask }> =>
    (await api.post<{ task: TaskboardTask }>(boardBase(spaceId) + '/tasks', input)).data,
  createChild: async (
    spaceId: string,
    parentId: string,
    input: TaskboardTaskInput,
  ): Promise<{ task: TaskboardTask }> =>
    (await api.post<{ task: TaskboardTask }>(boardBase(spaceId) + '/tasks/' + parentId + '/children', input)).data,
  updateStatus: async (
    spaceId: string,
    taskId: string,
    body: { status?: string; current_step?: string },
  ): Promise<{ task: TaskboardTask }> =>
    (await api.post<{ task: TaskboardTask }>(boardBase(spaceId) + '/tasks/' + taskId + '/status', body)).data,
};
