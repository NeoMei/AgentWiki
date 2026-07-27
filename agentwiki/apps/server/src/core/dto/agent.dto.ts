import { IsArray, IsBoolean, IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAgentDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsIn(['always-review', 'scoped-auto-publish']) approvalMode?: string;
  @IsOptional() @IsBoolean() memoryEnabled?: boolean;
}

export class UpdateAgentDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsIn(['active', 'paused']) status?: string;
  @IsOptional() @IsIn(['always-review', 'scoped-auto-publish']) approvalMode?: string;
  @IsOptional() @IsBoolean() memoryEnabled?: boolean;
}

export class CreateAgentCredentialDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsArray() @IsString({ each: true }) @MaxLength(50, { each: true }) scopes: string[];
  @IsOptional() @IsDateString() expiresAt?: string;
}

export class UpsertAgentGrantDto {
  @IsIn(['viewer', 'editor']) role: 'viewer' | 'editor';
}
