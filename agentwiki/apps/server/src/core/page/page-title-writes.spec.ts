import { BadRequestException } from '@nestjs/common';
import { PageService } from './page.service';
import { ReviewService } from '../../review/review.service';

// Call the real service entry before any persistence dependency is available.
// Invalid explicit titles must be rejected without reaching database writes.
describe('Page title write boundaries', () => {
  it.each(['   ', '\t\n', '\u3000'])('rejects blank titles at direct create/update/proposal entry: %p', async title => {
    const principal = { userId: 'user' } as any;
    await expect(PageService.prototype.create.call({} as any, { title } as any, principal)).rejects.toBeInstanceOf(BadRequestException);
    await expect(PageService.prototype.update.call({} as any, 'page', { title } as any, principal)).rejects.toBeInstanceOf(BadRequestException);
    for (const item of [
      { type: 'create_page', payload: { title } },
      { type: 'update_page', payload: { changes: { title } } },
    ]) {
      await expect(ReviewService.prototype.propose.call({} as any, principal, 'space', 'Proposal', item)).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
