import { Injectable } from '@nestjs/common';
import { capabilitiesHash } from '@neomei/agentwiki-sync-protocol';
import { DEFAULT_SYNC_CAPABILITIES } from './obsidian-crypto.service';

@Injectable()
export class SyncCapabilitiesService {
  capabilities() {
    return { ...DEFAULT_SYNC_CAPABILITIES };
  }

  async hash(): Promise<string> {
    return capabilitiesHash(DEFAULT_SYNC_CAPABILITIES);
  }
}
