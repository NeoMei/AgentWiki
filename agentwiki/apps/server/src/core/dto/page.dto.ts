import { IsString, IsOptional, IsIn, MaxLength, MinLength } from 'class-validator';

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
