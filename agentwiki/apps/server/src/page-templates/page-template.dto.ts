import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class PageTemplateListQueryDto {
  @IsIn(['zh-CN', 'en']) locale!: 'zh-CN' | 'en';
  @IsOptional() @IsIn(['all', 'system', 'space']) scope?: 'all' | 'system' | 'space';
  @IsOptional() @IsIn(['active', 'archived', 'all']) archived?: 'active' | 'archived' | 'all';
  @IsOptional() @IsIn(['planning', 'reporting', 'knowledge', 'other']) category?: 'planning' | 'reporting' | 'knowledge' | 'other';
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) skip = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take = 100;
}

export class CreatePageTemplateDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string;
  @IsIn(['planning', 'reporting', 'knowledge', 'other']) category!: 'planning' | 'reporting' | 'knowledge' | 'other';
  @IsString() @MinLength(1) @MaxLength(200) defaultTitle!: string;
  @IsIn(['zh-CN', 'en']) locale!: 'zh-CN' | 'en';
  @IsString() @MaxLength(100) sourcePageId!: string;
  @IsISO8601({ strict: true }) expectedSourceUpdatedAt!: string;
}

export class UpdatePageTemplateDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string;
  @IsIn(['planning', 'reporting', 'knowledge', 'other']) category!: 'planning' | 'reporting' | 'knowledge' | 'other';
  @IsString() @MinLength(1) @MaxLength(200) defaultTitle!: string;
  @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
}

export class CreatePageTemplateVersionDto {
  @IsString() @MaxLength(100) sourcePageId!: string;
  @IsISO8601({ strict: true }) expectedSourceUpdatedAt!: string;
  @IsInt() @Min(1) @Max(2_147_483_647) expectedCurrentVersion!: number;
}

export class PageTemplateStateDto {
  @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
}
