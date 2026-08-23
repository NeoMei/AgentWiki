import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateMemoryDto {
  @IsString() @MaxLength(100) spaceId: string;
  @IsIn(['episodic', 'semantic']) type: string;
  @IsString() @MinLength(1) @MaxLength(10000) content: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) importance?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(50, { each: true }) tags?: string[];
  @IsOptional() @IsObject() entities?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(100) sourceEvidenceId?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @IsIn(['private', 'space']) visibility?: 'private' | 'space';
}

export class RecallMemoryDto {
  @IsString() @MaxLength(100) spaceId: string;
  @IsString() @MinLength(1) @MaxLength(2000) query: string;
  @IsOptional() @IsNumber() @Min(1) @Max(50) limit?: number;
}

export class ConsolidateMemoryDto {
  @IsString() @MaxLength(100) spaceId: string;
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(100, { each: true }) memoryIds: string[];
  @IsOptional() @IsString() @MaxLength(10000) summary?: string;
}
