import { validate } from 'class-validator';
import { BusinessException } from '../filters/business-error';
import {
  CreateLocalSyncInstallationDto,
  ExchangeLocalSyncInstallationDto,
} from './local-sync.dto';

describe('local sync installation DTOs and business errors', () => {
  it('accepts a Space-bound role and the 0.5.0 protocol version', async () => {
    const dto = Object.assign(new CreateLocalSyncInstallationDto(), {
      spaceId: 'space-1',
      role: 'editor',
      pluginVersion: '0.5.0',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects an empty Space, unknown role and any other protocol version', async () => {
    const dto = Object.assign(new CreateLocalSyncInstallationDto(), {
      spaceId: '',
      role: 'owner',
      pluginVersion: '0.4.0',
    });

    await expect(validate(dto)).resolves.toHaveLength(3);
  });

  it('requires an installation code between 12 and 128 characters', async () => {
    const tooShort = Object.assign(new ExchangeLocalSyncInstallationDto(), { code: 'AW-SHORT' });
    const valid = Object.assign(new ExchangeLocalSyncInstallationDto(), {
      code: 'AW-1234567890',
    });

    await expect(validate(tooShort)).resolves.toHaveLength(1);
    await expect(validate(valid)).resolves.toEqual([]);
  });

  it.each([
    ['LOCAL_SYNC_CODE_INVALID', 401],
    ['LOCAL_SYNC_VERSION_UNSUPPORTED', 409],
    ['SYNC_CONFIRMATION_REQUIRED', 400],
  ] as const)('maps %s to HTTP %d', (code, status) => {
    expect(new BusinessException(code).getStatus()).toBe(status);
  });
});
