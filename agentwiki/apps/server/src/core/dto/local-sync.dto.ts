import {
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  AGENT_ACCESS_ROLES,
  type AgentAccessRole,
} from '@neomei/agentwiki-sync-protocol';

export class CreateLocalSyncInstallationDto {
  @IsString()
  @MinLength(1)
  spaceId: string;

  @IsIn(AGENT_ACCESS_ROLES)
  role: AgentAccessRole;

  @IsString()
  @Matches(/^0\.6\.0$/)
  pluginVersion: '0.6.0';
}

export class ExchangeLocalSyncInstallationDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  code: string;
}
