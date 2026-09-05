import { ContentTreeError } from '../../content-tree/content-tree.types';
import { BusinessException } from './business-error';

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

  it('publishes a stable conflict contract for referenced attachments', () => {
    const error = new BusinessException(
      'ATTACHMENT_REFERENCED',
      undefined,
      { pages: [{ id: 'page-1', title: 'Page' }] },
    );

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      statusCode: 409,
      code: 'ATTACHMENT_REFERENCED',
      message: 'Attachment is referenced by the current revision',
      error: 'Conflict',
      details: { pages: [{ id: 'page-1', title: 'Page' }] },
    });
  });
});
