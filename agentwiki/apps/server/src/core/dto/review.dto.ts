import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewDecisionDto {
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}

export class ChangeItemDecisionDto {
  @IsIn(['accepted', 'rejected']) status: string;
}
