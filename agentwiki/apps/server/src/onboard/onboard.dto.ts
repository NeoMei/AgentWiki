import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsObject,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import type {
  BootstrapInput,
  DeviceDecisionInput,
  PollDeviceInput,
  ServerPlan,
  StartDeviceInput,
} from './onboard.types';

export class StartDeviceDto implements StartDeviceInput {
  @IsIn(['0.3.6'])
  packageVersion: '0.3.6';

  @IsIn(['codex', 'claude', 'opencode'])
  clientType: 'codex' | 'claude' | 'opencode';

  @IsIn(['full-onboarding'])
  purpose: 'full-onboarding';
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

  @IsString()
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

  @IsIn(['editor', 'full'])
  permissionPreset: 'editor' | 'full';

  @IsIn(['always-review', 'scoped-auto-publish'])
  approvalMode: 'always-review' | 'scoped-auto-publish';

  @IsIn(['0.3.6'])
  packageVersion: '0.3.6';
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
