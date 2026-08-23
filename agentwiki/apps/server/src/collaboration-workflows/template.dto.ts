import { IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8_000)
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  @MaxLength(120)
  slug?: string;

  @IsObject()
  definition!: Record<string, unknown>;
}

export class ValidateTemplateDto {
  @IsObject()
  definition!: Record<string, unknown>;
}

export class CopyTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  name!: string;
}

export class UpdateTemplateDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedVersion!: number;

  @IsObject()
  definition!: Record<string, unknown>;
}

export class ArchiveTemplateDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedVersion!: number;
}
