import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const PreserveRawInput = () => Transform(({ obj, key }) => obj[key], { toClassOnly: true });
const TREE_REVISION = /^(?:0|[1-9]\d*)$/u;

export class ReviewDecisionDto {
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}

export class ChangeItemDecisionDto {
  @IsIn(['accepted', 'rejected']) status: string;
}

export class RevertChangeSetDto {
  @PreserveRawInput()
  @IsString()
  @Matches(TREE_REVISION)
  expectedTreeRevision: string;
}
