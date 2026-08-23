import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

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
