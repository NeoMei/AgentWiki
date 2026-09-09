import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsObject,
  IsString,
  Matches,
  ValidateNested,
  ValidateBy,
  minLength,
  maxLength,
} from 'class-validator';
import { SPACE_NAME_MAX_LENGTH } from '@agentwiki/shared';
import {
  SUPPORTED_LOCAL_SYNC_VERSIONS,
  type SupportedLocalSyncVersion,
} from '../core/local-sync-version';
import type {
  BootstrapInput,
  DeviceDecisionInput,
  PollDeviceInput,
  ServerPlan,
  StartDeviceInput,
} from './onboard.types';

export class StartDeviceDto implements StartDeviceInput {
  @IsIn(SUPPORTED_LOCAL_SYNC_VERSIONS)
  packageVersion: SupportedLocalSyncVersion;

  @IsIn(['codex', 'claude', 'opencode'])
  clientType: 'codex' | 'claude' | 'opencode';

  @IsIn(['full-onboarding', 'agent-connect'])
  purpose: 'full-onboarding' | 'agent-connect';
}

export class StartObsidianDeviceDto {
  @Transform(({ obj, key }) => obj[key], { toClassOnly: true })
  @IsString()
  @Matches(/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/)
  pluginVersion: string;
}

export class PollDeviceDto implements PollDeviceInput {
  @IsString()
  deviceCode: string;
}

export class DeviceDecisionDto implements DeviceDecisionInput {
  @IsString()
  userCode: string;

  @IsIn(['approve', 'deny'])
  decision: 'approve' | 'deny';
}

class CreateSpacePlanDto {
  @IsIn(['create'])
  mode: 'create';

  // Preserve the confirmed raw plan for hashing, including surrounding spaces.
  // Restore the raw type so implicit conversion cannot authorize numeric names.
  @Transform(({ obj, key }) => obj[key], { toClassOnly: true })
  @ValidateBy({
    name: 'spaceName',
    validator: {
      validate: (value: unknown) => typeof value === 'string'
        && minLength(value.trim(), 1) && maxLength(value.trim(), SPACE_NAME_MAX_LENGTH),
      defaultMessage: () => `Space name must contain 1 to ${SPACE_NAME_MAX_LENGTH} characters after trimming`,
    },
  })
  name: string;
}

class ExistingSpacePlanDto {
  @IsIn(['existing'])
  mode: 'existing';

  @IsString()
  id: string;
}

export class ServerPlanDto implements ServerPlan {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => Object, {
    discriminator: {
      property: 'mode',
      subTypes: [
        { name: 'create', value: CreateSpacePlanDto },
        { name: 'existing', value: ExistingSpacePlanDto },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  space: CreateSpacePlanDto | ExistingSpacePlanDto;

  @IsString()
  agentName: string;

  @IsIn(['reader', 'editor', 'publisher'])
  role: 'reader' | 'editor' | 'publisher';

  @IsIn(SUPPORTED_LOCAL_SYNC_VERSIONS)
  packageVersion: SupportedLocalSyncVersion;
}

export class BootstrapDto implements BootstrapInput {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ServerPlanDto)
  serverPlan: ServerPlanDto;

  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  serverPlanHash: string;
}
