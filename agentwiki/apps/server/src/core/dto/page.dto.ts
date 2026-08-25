import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsISO8601, IsInt, IsString, IsOptional, IsIn, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { IsPageTemplateCreateShape } from './page-template-create.validator';

const PreserveRawInput = () => Transform(({ obj, key }) => obj[key], { toClassOnly: true });

export class CreatePageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200000)
  content?: string;

  @IsString()
  @MaxLength(100)
  @IsPageTemplateCreateShape()
  spaceId: string;

  @PreserveRawInput()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @Matches(/\S/u)
  @MaxLength(100)
  templateId?: string;

  @PreserveRawInput()
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  templateVersion?: number;

  @PreserveRawInput()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsIn(['zh-CN', 'en'])
  templateLocale?: 'zh-CN' | 'en';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  parentId?: string;

  @IsOptional()
  @IsIn(['markdown', 'html', 'json'])
  format?: 'markdown' | 'html' | 'json';
}

export class UpdatePageDto {
  @IsISO8601({ strict: true })
  expectedUpdatedAt: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200000)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  parentId?: string;

  @IsOptional()
  @IsIn(['markdown', 'html', 'json'])
  format?: 'markdown' | 'html' | 'json';
}

export class ReorderPageItem {
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  parentId: string | null;

  @IsInt()
  sortOrder: number;
}

export class ReorderPagesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ReorderPageItem)
  items: ReorderPageItem[];
}
