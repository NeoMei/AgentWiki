import { AGENT_ACCESS_ROLES, type AgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAgentDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsBoolean() memoryEnabled?: boolean;
}

export class UpdateAgentDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsIn(['active', 'paused']) status?: string;
  @IsOptional() @IsBoolean() memoryEnabled?: boolean;
}

export class UpsertAgentGrantDto {
  @IsIn(AGENT_ACCESS_ROLES) role: AgentAccessRole;
}
