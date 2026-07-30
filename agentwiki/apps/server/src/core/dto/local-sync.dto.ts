import {
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateLocalSyncInstallationDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  scopes: string[];

  @IsString()
  @Matches(/^\d+\.\d+\.\d+$/)
  pluginVersion: string;
}

export class ExchangeLocalSyncInstallationDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  code: string;
}
