import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsISO8601, IsInt, IsString, IsOptional, IsIn, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

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
  spaceId: string;

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
