import { IsString, IsOptional, IsIn, MaxLength, MinLength } from 'class-validator';

export class CreateSpaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
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
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
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
