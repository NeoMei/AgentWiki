import { IsString, IsOptional, IsIn, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { SPACE_NAME_MAX_LENGTH } from '@agentwiki/shared';

// Read the raw input so implicit conversion cannot turn numbers into names.
const TrimSpaceName = () => Transform(({ obj, key }) => {
  const value = obj[key];
  return typeof value === 'string' ? value.trim() : value;
}, { toClassOnly: true });

export class CreateSpaceDto {
  @TrimSpaceName()
  @IsString()
  @MinLength(1)
  @MaxLength(SPACE_NAME_MAX_LENGTH)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';

  @IsOptional()
  @IsIn(['always-review', 'scoped-auto-publish'])
  approvalPolicy?: 'always-review' | 'scoped-auto-publish';
}

export class UpdateSpaceDto {
  @TrimSpaceName()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(SPACE_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';

  @IsOptional()
  @IsIn(['always-review', 'scoped-auto-publish'])
  approvalPolicy?: 'always-review' | 'scoped-auto-publish';
}

export class AddMemberDto {
  @IsString()
  @MaxLength(255)
  email: string;

  @IsOptional()
  @IsIn(['owner', 'admin', 'editor', 'viewer'])
  role?: 'owner' | 'admin' | 'editor' | 'viewer';
}

export class UpdateMemberRoleDto {
  @IsIn(['owner', 'admin', 'editor', 'viewer'])
  role: 'owner' | 'admin' | 'editor' | 'viewer';
}

/** Query contract for GET /spaces. skip/take remain accepted for older clients. */
export class SpaceListQueryDto {
  @IsOptional()
  @IsString()
  skip?: string;

  @IsOptional()
  @IsString()
  take?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  cursor?: string;
}

/** Response contract for both legacy offset and cursor-based Space listings. */
export class SpaceListResponseDto<T = unknown> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  revision: string;
  nextCursor: string | null;
  hasMore: boolean;
  resetRequired: boolean;
}
