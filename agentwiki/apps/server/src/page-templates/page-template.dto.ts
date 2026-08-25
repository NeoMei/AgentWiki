import { PageTemplateCategory } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const PreserveRawInput = () => Transform(({ obj, key }) => obj[key], { toClassOnly: true });

export class PageTemplateListQueryDto {
  @IsIn(['zh-CN', 'en']) locale!: 'zh-CN' | 'en';
  @IsOptional() @IsIn(['all', 'system', 'space']) scope?: 'all' | 'system' | 'space';
  @IsOptional() @IsIn(['active', 'archived', 'all']) archived?: 'active' | 'archived' | 'all';
  @IsOptional() @IsEnum(PageTemplateCategory) category?: PageTemplateCategory;
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) skip = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take = 100;
}

export class PageTemplateLocaleQueryDto {
  @IsIn(['zh-CN', 'en']) locale!: 'zh-CN' | 'en';
}

export class PageTemplateSourceListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) skip = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take = 100;
}

export class CreatePageTemplateDto {
  @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @PreserveRawInput() @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(240) description?: string;
  @PreserveRawInput() @IsEnum(PageTemplateCategory) category!: PageTemplateCategory;
  @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(200) defaultTitle!: string;
  @PreserveRawInput() @IsIn(['zh-CN', 'en']) locale!: 'zh-CN' | 'en';
  @PreserveRawInput() @IsString() @MaxLength(100) sourcePageId!: string;
  @PreserveRawInput() @IsISO8601({ strict: true }) expectedSourceUpdatedAt!: string;
}

export class UpdatePageTemplateDto {
  @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @PreserveRawInput() @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(240) description?: string;
  @PreserveRawInput() @IsEnum(PageTemplateCategory) category!: PageTemplateCategory;
  @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(200) defaultTitle!: string;
  @PreserveRawInput() @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
}

export class CreatePageTemplateVersionDto {
  @PreserveRawInput() @IsString() @MaxLength(100) sourcePageId!: string;
  @PreserveRawInput() @IsISO8601({ strict: true }) expectedSourceUpdatedAt!: string;
  @PreserveRawInput() @IsInt() @Min(1) @Max(2_147_483_647) expectedCurrentVersion!: number;
}

export class PageTemplateStateDto {
  @PreserveRawInput() @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
}
