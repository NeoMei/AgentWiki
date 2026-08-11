import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './safeReturnTo';

describe('safeReturnTo', () => {
  it('accepts only the device authorization path and preserves its query', () => {
    expect(safeReturnTo('/onboard/device?user_code=ABCD-EFGH')).toBe(
      '/onboard/device?user_code=ABCD-EFGH',
    );
    expect(safeReturnTo('/onboard/device')).toBe('/onboard/device');
  });

  it.each([
    undefined,
    '',
    '/',
    '/dashboard',
    '/onboard',
    '/onboard/device/extra',
    '//evil.example/onboard/device',
    'https://evil.example/onboard/device',
    '/onboard\\device?user_code=ABCD-EFGH',
    '/onboard/device%2f..%2fdashboard',
    '/onboard/device?user_code=ABCD%0AEFGH',
    '/onboard/device?next=%2F%2Fevil.example',
  ])('rejects an unsafe or unrelated target: %s', (value) => {
    expect(safeReturnTo(value)).toBeNull();
  });
});
