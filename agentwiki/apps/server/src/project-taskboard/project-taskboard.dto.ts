import { Allow, IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * Wire-compatible task payload. Fields mirror TASKBOARD_MUTABLE_FIELDS so the
 * global whitelist ValidationPipe keeps plan free-form fields (labels, stages,
 * evidence, ...) instead of stripping them; semantic validation happens in
 * taskboard-core, matching the permissive reference Python implementation.
 */
export class TaskboardTaskDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() parent_id?: string;
  @IsOptional() @IsString() kind?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() created_at?: string;
  @IsOptional() @IsString() started_at?: string;
  @IsOptional() @IsString() completed_at?: string;
  // String-typed execution/planning fields.
  @Allow() scope_class?: unknown;
  @Allow() owner?: unknown;
  @Allow() summary?: unknown;
  @Allow() description?: unknown;
  @Allow() current_step?: unknown;
  @Allow() next_step?: unknown;
  @Allow() planned_start?: unknown;
  @Allow() planned_end?: unknown;
  @Allow() due_at?: unknown;
  @Allow() agent_id?: unknown;
  @Allow() run_id?: unknown;
  @Allow() session_id?: unknown;
  @Allow() worktree?: unknown;
  @Allow() branch?: unknown;
  @Allow() evidence?: unknown;
  @Allow() external_id?: unknown;
  @Allow() required_denominator?: unknown;
  @Allow() evidence_type?: unknown;
  @Allow() platform?: unknown;
  @Allow() spec_source?: unknown;
  @Allow() scope?: unknown;
  @Allow() blocker?: unknown;
  @Allow() audited_at?: unknown;
  // Structured fields (string or array of strings).
  @Allow() source?: unknown;
  @Allow() plan_source?: unknown;
  @Allow() labels?: unknown;
  @Allow() stages?: unknown;
  @Allow() criteria?: unknown;
  @Allow() acceptance?: unknown;
  @Allow() depends_on?: unknown;
  @IsOptional() @IsString() expected_status?: string;
  @IsOptional() @IsBoolean() takeover?: boolean;
}

export class TaskboardStatusDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() current_step?: string;
  /** Optimistic concurrency: reject when the live status differs. */
  @IsOptional() @IsString() expected_status?: string;
  /** Explicitly take over a task claimed by another actor. */
  @IsOptional() @IsBoolean() takeover?: boolean;
}

export class TaskboardImportPlanDto {
  @IsString() content!: string;
  @IsOptional() @IsString() sourcePath?: string;
  @IsOptional() @IsBoolean() syncStatus?: boolean;
  // snake_case aliases kept for project-taskboard CLI compatibility.
  @IsOptional() @IsString() source_path?: string;
  @IsOptional() @IsBoolean() sync_status?: boolean;
  @IsOptional() @IsString() project?: string;
}
