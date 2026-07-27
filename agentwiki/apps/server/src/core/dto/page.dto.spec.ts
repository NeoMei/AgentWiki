import 'reflect-metadata';
import { validate } from 'class-validator';
import { UpdatePageDto } from './page.dto';

describe('UpdatePageDto', () => {
  it('requires an ISO timestamp identifying the page version being edited', async () => {
    const missing = Object.assign(new UpdatePageDto(), { title: 'Updated' });
    const invalid = Object.assign(new UpdatePageDto(), { title: 'Updated', expectedUpdatedAt: 'not-a-timestamp' });
    const valid = Object.assign(new UpdatePageDto(), { title: 'Updated', expectedUpdatedAt: '2026-07-27T08:00:00.000Z' });

    await expect(validate(missing)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'expectedUpdatedAt' }),
    ]));
    await expect(validate(invalid)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'expectedUpdatedAt' }),
    ]));
    await expect(validate(valid)).resolves.toEqual([]);
  });
});
