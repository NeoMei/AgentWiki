import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]+$/u;

export class CollaborationRoleBindingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  roleSlotId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  agentId!: string;
}

export class CreateRunDraftDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  templateId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(240)
  name!: string;

  @IsObject()
  inputs!: Record<string, unknown>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CollaborationRoleBindingDto)
  roleBindings!: CollaborationRoleBindingDto[];
}

export class UpdateRunDraftDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  name?: string;

  @IsOptional()
  @IsObject()
  inputs?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CollaborationRoleBindingDto)
  roleBindings?: CollaborationRoleBindingDto[];
}

export class ValidateRunDraftDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedVersion!: number;
}

export class StartRunDto extends ValidateRunDraftDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(IDEMPOTENCY_KEY)
  idempotencyKey!: string;
}

export class RunActionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  reason!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(IDEMPOTENCY_KEY)
  idempotencyKey!: string;
}

export class ReassignTaskDto extends RunActionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  agentId!: string;
}
