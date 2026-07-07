import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { DatabaseService } from '../database/database.service';

describe('CommentsService.findAllForPost', () => {
  it('returns whatever the query layer returns', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([{ id: 'c1', content: 'Nice post' }]);
    const databaseService = {
      db: { query: { comments: { findMany } } },
    } as unknown as DatabaseService;
    const service = new CommentsService(databaseService);

    await expect(service.findAllForPost('post-1')).resolves.toEqual([
      { id: 'c1', content: 'Nice post' },
    ]);
  });
});

describe('CommentsService.create', () => {
  function createService(options: {
    postsFindFirst?: jest.Mock;
    insertReturning?: jest.Mock;
  }) {
    const postsFindFirst =
      options.postsFindFirst ?? jest.fn().mockResolvedValue(undefined);
    const insertReturning =
      options.insertReturning ?? jest.fn().mockResolvedValue([]);
    const insertValues = jest
      .fn()
      .mockReturnValue({ returning: insertReturning });
    const insert = jest.fn().mockReturnValue({ values: insertValues });

    const databaseService = {
      db: { query: { posts: { findFirst: postsFindFirst } }, insert },
    } as unknown as DatabaseService;

    return { service: new CommentsService(databaseService), insertValues };
  }

  it('throws NotFoundException when the post does not exist', async () => {
    const { service } = createService({});

    await expect(
      service.create('missing-post', 'user-1', { content: 'Hi' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException when the post has comments disabled', async () => {
    const postsFindFirst = jest
      .fn()
      .mockResolvedValue({ id: 'post-1', allowComments: false });
    const { service } = createService({ postsFindFirst });

    await expect(
      service.create('post-1', 'user-1', { content: 'Hi' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates the comment when the post allows comments', async () => {
    const postsFindFirst = jest
      .fn()
      .mockResolvedValue({ id: 'post-1', allowComments: true });
    const insertReturning = jest
      .fn()
      .mockResolvedValue([{ id: 'c1', content: 'Hi' }]);
    const { service, insertValues } = createService({
      postsFindFirst,
      insertReturning,
    });

    const result = await service.create('post-1', 'user-1', {
      content: 'Hi',
    });

    expect(insertValues).toHaveBeenCalledWith({
      postId: 'post-1',
      authorId: 'user-1',
      content: 'Hi',
    });
    expect(result).toEqual({ id: 'c1', content: 'Hi' });
  });
});

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
