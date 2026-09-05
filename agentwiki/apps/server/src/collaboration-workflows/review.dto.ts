import { IsDefined, IsIn, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class ReviewDecisionDto {
  @IsString()
  @IsIn(['approve', 'reject_for_revision', 'terminate'])
  kind!: 'approve' | 'reject_for_revision' | 'terminate';

  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  reason!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/u)
  idempotencyKey!: string;
}

export class ResolvePageConflictDto {
  @IsString()
  @IsIn(['regenerate', 'adopt_current'])
  kind!: 'regenerate' | 'adopt_current';

  @IsDefined()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  expectedPageVersionId!: string | null;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/u)
  expectedContentHash!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/u)
  idempotencyKey!: string;
}
