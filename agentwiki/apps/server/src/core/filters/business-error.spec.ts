import { ContentTreeError } from '../../content-tree/content-tree.types';

describe('BusinessException HTTP labels', () => {
  it('labels a gone immutable revision as Gone', () => {
    const error = new ContentTreeError('CONTENT_TREE_REVISION_GONE', 'Revision is not available');

    expect(error.getStatus()).toBe(410);
    expect(error.getResponse()).toEqual(expect.objectContaining({
      statusCode: 410,
      code: 'CONTENT_TREE_REVISION_GONE',
      message: 'Revision is not available',
      error: 'Gone',
    }));
  });
});
