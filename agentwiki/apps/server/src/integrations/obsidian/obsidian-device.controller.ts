import { Body, Controller, HttpCode, HttpStatus, Ip, Post, UseInterceptors } from '@nestjs/common';
import { OnboardDeviceService } from '../../onboard/onboard-device.service';
import { PollDeviceDto, StartObsidianDeviceDto } from '../../onboard/onboard.dto';
import { ObsidianIntegrationService } from './obsidian-integration.service';
import { SyncNoStoreInterceptor } from './sync-no-store.interceptor';

@Controller('integrations/obsidian/device')
@UseInterceptors(SyncNoStoreInterceptor)
export class ObsidianDeviceController {
  constructor(private readonly devices: OnboardDeviceService, private readonly installations: ObsidianIntegrationService) {}

  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  start(@Body() dto: StartObsidianDeviceDto, @Ip() ip: string) {
    return this.devices.start({packageVersion: dto.pluginVersion, clientType: 'obsidian', purpose: 'obsidian-connect'}, ip);
  }

  @Post('poll')
  @HttpCode(HttpStatus.OK)
  poll(@Body() dto: PollDeviceDto, @Ip() ip: string) {
    return this.devices.pollObsidian(dto, ip, this.installations);
  }
}
