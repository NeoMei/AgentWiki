import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSourceDto {
  @IsIn(['text', 'url', 'git']) type: 'text' | 'url' | 'git';
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsOptional() @IsString() @MaxLength(2048) uri?: string;
  @IsOptional() @IsString() @MaxLength(500000) content?: string;
}

export class UpdateSourceDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsIn(['active', 'archived']) status?: string;
}
