import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  type ValidationArguments,
  type ValidationOptions,
  registerDecorator,
} from 'class-validator';

const PreserveRawInput = () => Transform(({ obj, key }) => obj[key], { toClassOnly: true });
const TREE_REVISION = /^(?:0|[1-9]\d*)$/u;
const IMPACT_HASH = /^[a-f0-9]{64}$/u;

function IsRestoreFolderShape(options?: ValidationOptions) {
  return (target: object, propertyName: string) => registerDecorator({
    name: 'isRestoreFolderShape',
    target: target.constructor,
    propertyName,
    options,
    validator: {
      validate(_value: unknown, arguments_: ValidationArguments) {
        const body = arguments_.object as { mode?: unknown; name?: unknown };
        return body.mode === 'rename-root'
          ? typeof body.name === 'string'
          : body.name === undefined;
      },
      defaultMessage: () => 'name is required only when mode is rename-root',
    },
  });
}

export class ContentTreeListQueryDto {
  @IsOptional() @PreserveRawInput() @IsString() @MaxLength(100) parentFolderId?: string;
  @IsOptional() @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(2048) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) take = 100;
}

export class FolderListQueryDto {
  @IsOptional() @PreserveRawInput() @IsString() @MaxLength(200) query?: string;
  @IsOptional() @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(2048) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) take = 100;
}

export class CreateFolderDto {
  @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsDefined()
  @PreserveRawInput()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  parentId!: string | null;
  @PreserveRawInput() @IsString() @Matches(TREE_REVISION) expectedTreeRevision!: string;
}

export class RenameFolderDto {
  @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @PreserveRawInput() @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
  @PreserveRawInput() @IsString() @Matches(TREE_REVISION) expectedTreeRevision!: string;
}

export class MoveContentTreeNodeDto {
  @PreserveRawInput() @IsIn(['folder', 'page']) kind!: 'folder' | 'page';
  @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(100) id!: string;
  @IsDefined()
  @PreserveRawInput()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  targetParentFolderId!: string | null;
  @IsOptional() @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(100) beforeId?: string;
  @PreserveRawInput() @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
  @PreserveRawInput() @IsString() @Matches(TREE_REVISION) expectedTreeRevision!: string;
}

export class DeleteFolderDto {
  @PreserveRawInput() @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
  @PreserveRawInput() @IsString() @Matches(TREE_REVISION) expectedTreeRevision!: string;
  @PreserveRawInput() @IsString() @Matches(IMPACT_HASH) expectedImpactHash!: string;
}

export class RestoreFolderDto {
  @PreserveRawInput() @IsString() @MinLength(1) @MaxLength(100) deletionBatchId!: string;
  @PreserveRawInput() @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
  @PreserveRawInput() @IsString() @Matches(TREE_REVISION) expectedTreeRevision!: string;
  @PreserveRawInput()
  @IsIn(['original', 'root', 'rename-root'])
  @IsRestoreFolderShape()
  mode!: 'original' | 'root' | 'rename-root';
  @PreserveRawInput()
  @ValidateIf((object: RestoreFolderDto) => object.mode === 'rename-root')
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;
}

export function parseTreeRevision(value: string): bigint {
  return BigInt(value);
}
