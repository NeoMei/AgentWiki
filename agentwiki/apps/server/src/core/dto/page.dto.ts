import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsISO8601, IsInt, IsString, IsOptional, IsIn, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested, registerDecorator, type ValidationArguments } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { IsPageTemplateCreateShape } from './page-template-create.validator';

const PreserveRawInput = () => Transform(({ obj, key }) => obj[key], { toClassOnly: true });
const TREE_REVISION = /^(?:0|[1-9]\d*)$/u;

function IsPagePlacementShape() {
  return (target: object, propertyName: string) => registerDecorator({
    name: 'isPagePlacementShape', target: target.constructor, propertyName,
    validator: {
      validate(_value: unknown, args: ValidationArguments) {
        const body = args.object as { folderId?: unknown; parentId?: unknown };
        return !(body.folderId !== undefined && body.parentId !== undefined);
      },
      defaultMessage: () => 'folderId and parentId cannot be submitted together',
    },
  });
}

function IsPageUpdateTreeShape() {
  return (target: object, propertyName: string) => registerDecorator({
    name: 'isPageUpdateTreeShape', target: target.constructor, propertyName,
    validator: {
      validate(_value: unknown, args: ValidationArguments) {
        const body = args.object as { title?: unknown; folderId?: unknown; expectedTreeRevision?: unknown };
        const structural = body.title !== undefined || body.folderId !== undefined;
        return !structural || (typeof body.expectedTreeRevision === 'string' && TREE_REVISION.test(body.expectedTreeRevision));
      },
      defaultMessage: () => 'expectedTreeRevision is required for title or folderId changes',
    },
  });
}

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
  @IsPagePlacementShape()
  spaceId: string;

  @PreserveRawInput()
  @IsString()
  @Matches(TREE_REVISION)
  expectedTreeRevision: string;

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
  parentId?: string | null;

  @PreserveRawInput()
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  folderId?: string | null;

  @IsOptional()
  @IsIn(['markdown', 'html', 'json'])
  format?: 'markdown' | 'html' | 'json';
}

export class UpdatePageDto {
  @IsISO8601({ strict: true })
  @IsPageUpdateTreeShape()
  expectedUpdatedAt: string;

  @PreserveRawInput()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(TREE_REVISION)
  expectedTreeRevision?: string;

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

  @PreserveRawInput()
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  folderId?: string | null;

  @IsOptional()
  @IsIn(['markdown', 'html', 'json'])
  format?: 'markdown' | 'html' | 'json';
}

export class RestorePageVersionDto {
  @PreserveRawInput()
  @IsString()
  @Matches(TREE_REVISION)
  expectedTreeRevision: string;
}

export class ArchivePageDto {
  @IsISO8601({ strict: true })
  expectedUpdatedAt: string;

  @PreserveRawInput()
  @IsString()
  @Matches(TREE_REVISION)
  expectedTreeRevision: string;
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
