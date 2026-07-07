import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { DatabaseService } from '../database/database.service';

describe('CommentsService.remove', () => {
  const existingComment = {
    id: 'comment-1',
    postId: 'post-1',
    authorId: 'author-1',
    content: 'Hello',
  };

  function createService(comment: unknown = existingComment) {
    const findFirst = jest.fn().mockResolvedValue(comment);
    const where = jest.fn().mockResolvedValue(undefined);
    const del = jest.fn().mockReturnValue({ where });

    const databaseService = {
      db: {
        query: { comments: { findFirst } },
        delete: del,
      },
    } as unknown as DatabaseService;

    return { service: new CommentsService(databaseService), del, where };
  }

  it('allows the comment author to delete their own comment', async () => {
    const { service, del } = createService();

    await service.remove('comment-1', 'author-1', 'user');

    expect(del).toHaveBeenCalled();
  });

  it('allows an admin to delete a comment they do not own', async () => {
    const { service, del } = createService();

    await service.remove('comment-1', 'some-other-admin', 'admin');

    expect(del).toHaveBeenCalled();
  });

  it('rejects a non-owner, non-admin user', async () => {
    const { service, del } = createService();

    await expect(
      service.remove('comment-1', 'someone-else', 'user'),
    ).rejects.toThrow(ForbiddenException);
    expect(del).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the comment does not exist', async () => {
    const { service, del } = createService(null);

    await expect(
      service.remove('missing-comment', 'author-1', 'user'),
    ).rejects.toThrow(NotFoundException);
    expect(del).not.toHaveBeenCalled();
  });
});
