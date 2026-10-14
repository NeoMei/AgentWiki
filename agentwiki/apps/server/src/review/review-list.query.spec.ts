import { parseReviewListQuery } from './review-list.query';

describe('review list query validation', () => {
  it('bounds pagination and accepts combined search/date filters', () => {
    expect(parseReviewListQuery({})).toEqual({ page: 1, pageSize: 25 });
    expect(parseReviewListQuery({ page: '2', pageSize: '100', q: '  proposal  ', status: 'approved', from: '2026-10-01T00:00:00Z', to: '2026-10-15T00:00:00Z' })).toMatchObject({ page: 2, pageSize: 100, q: 'proposal', status: 'approved' });
  });
  it.each([
    { page: '-1' }, { page: '0' }, { page: '1.5' }, { page: ['1', '2'] }, { page: '1000001' },
    { pageSize: '101' }, { pageSize: 'NaN' }, { status: 'draft' }, { q: 'x'.repeat(201) },
    { q: ['first', 'second'] }, { spaceId: ['one', 'two'] }, { from: 'yesterday' },
    { from: '2026-10-15T00:00:00Z', to: '2026-10-14T00:00:00Z' },
  ])('rejects malformed or oversized query %j', query => {
    expect(() => parseReviewListQuery(query)).toThrow();
  });
});
