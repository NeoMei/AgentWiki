import { IsString, IsOptional, IsNumber, Min, Max, MaxLength } from 'class-validator';

export class CreateKnowledgeRelationDto {
  @IsString()
  @MaxLength(50)
  relation: string;

  @IsString()
  @MaxLength(100)
  sourcePageId: string;

  @IsString()
  @MaxLength(100)
  targetPageId: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  strength?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  evidenceId?: string;
}

export class UpdateKnowledgeRelationStrengthDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  strength: number;
}
