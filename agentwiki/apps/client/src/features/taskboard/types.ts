export interface TaskboardTask {
  id: string;
  title: string;
  parent_id?: string | null;
  kind?: string;
  status?: string;
  scope_class?: string | null;
  owner?: string | null;
  summary?: string | null;
  description?: string | null;
  current_step?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  [extra: string]: unknown;
}

export interface TaskboardBoard {
  schema_version: number;
  project: string;
  source_type: string;
  sources: string[];
  updated_at: string | null;
  tasks: TaskboardTask[];
}

export interface TaskboardResponse {
  board: TaskboardBoard;
  read_at: string;
}

export interface TaskboardImportResponse extends TaskboardResponse {
  summary: { added: number; updated: number };
  project?: string;
}

export interface TaskboardPlanImportInput {
  content?: string;
  pageId?: string;
  sourcePath?: string;
  syncStatus?: boolean;
  project?: string;
}

export interface TaskboardTaskInput {
  title: string;
  parent_id?: string;
  kind?: string;
  status?: string;
  owner?: string;
  summary?: string;
  current_step?: string;
}
