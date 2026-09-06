import {
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  AGENT_ACCESS_ROLES,
  type AgentAccessRole,
} from '@neomei/agentwiki-sync-protocol';
import {
  SUPPORTED_LOCAL_SYNC_VERSIONS,
  type SupportedLocalSyncVersion,
} from '../local-sync-version';

export class CreateLocalSyncInstallationDto {
  @IsString()
  @MinLength(1)
  spaceId: string;

  @IsIn(AGENT_ACCESS_ROLES)
  role: AgentAccessRole;

  @IsIn(SUPPORTED_LOCAL_SYNC_VERSIONS)
  pluginVersion: SupportedLocalSyncVersion;
}

export class ExchangeLocalSyncInstallationDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  code: string;
}
