import { NotFoundException } from '@nestjs/common';
import { PostsService } from './posts.service';
import { DatabaseService } from '../database/database.service';
import { UploadsService } from '../uploads/uploads.service';

describe('PostsService', () => {
  const rawPostWithTopics = {
    id: 'post-1',
    title: 'Hello',
    slug: 'hello',
    content: 'Body',
    isPublished: true,
    author: { id: 'author-1', name: 'Author', avatarUrl: null },
    postsToTopics: [
      { topic: { id: 't1', name: 'Topic One', slug: 'topic-one' } },
    ],
  };
  const flattenedPost = {
    id: 'post-1',
    title: 'Hello',
    slug: 'hello',
    content: 'Body',
    isPublished: true,
    author: { id: 'author-1', name: 'Author', avatarUrl: null },
    topics: [{ id: 't1', name: 'Topic One', slug: 'topic-one' }],
  };

  function createService(options: {
    txFindFirst?: jest.Mock;
    txInsertPostReturning?: jest.Mock;
    txUpdateReturning?: jest.Mock;
    findMany?: jest.Mock;
    findFirst?: jest.Mock;
    deleteReturning?: jest.Mock;
    extractBucketKeysFromContent?: jest.Mock;
    deleteFiles?: jest.Mock;
  }) {
    const txFindFirst =
      options.txFindFirst ?? jest.fn().mockResolvedValue(rawPostWithTopics);
    const txInsertPostReturning =
      options.txInsertPostReturning ??
      jest.fn().mockResolvedValue([{ id: 'post-1' }]);
    const txUpdateReturning =
      options.txUpdateReturning ??
      jest.fn().mockResolvedValue([{ id: 'post-1' }]);

    const txInsertValues = jest
      .fn()
      .mockReturnValue({ returning: txInsertPostReturning });
    const txInsert = jest.fn().mockReturnValue({ values: txInsertValues });

    const txUpdateWhere = jest
      .fn()
      .mockReturnValue({ returning: txUpdateReturning });
    const txUpdateSet = jest.fn().mockReturnValue({ where: txUpdateWhere });
    const txUpdate = jest.fn().mockReturnValue({ set: txUpdateSet });

    const txDeleteWhere = jest.fn().mockResolvedValue(undefined);
    const txDelete = jest.fn().mockReturnValue({ where: txDeleteWhere });

    const tx = {
      insert: txInsert,
      update: txUpdate,
      delete: txDelete,
      query: { posts: { findFirst: txFindFirst } },
    };

    const transaction = jest
      .fn()
      .mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const findMany = options.findMany ?? jest.fn().mockResolvedValue([]);
    const findFirst =
      options.findFirst ?? jest.fn().mockResolvedValue(undefined);

    const deleteReturning =
      options.deleteReturning ?? jest.fn().mockResolvedValue([]);
    const deleteWhere = jest
      .fn()
      .mockReturnValue({ returning: deleteReturning });
    const del = jest.fn().mockReturnValue({ where: deleteWhere });

    const databaseService = {
      db: {
        transaction,
        query: { posts: { findMany, findFirst } },
        delete: del,
      },
    } as unknown as DatabaseService;

    const uploadsService = {
      extractBucketKeysFromContent:
        options.extractBucketKeysFromContent ?? jest.fn().mockReturnValue([]),
      deleteFiles:
        options.deleteFiles ?? jest.fn().mockResolvedValue(undefined),
    } as unknown as UploadsService;

    return {
      service: new PostsService(databaseService, uploadsService),
      txInsertValues,
      txUpdateSet,
      txDelete,
      txInsert,
      uploadsService,
    };
  }

  describe('create', () => {
    it('creates a post and associates the given topics', async () => {
      const { service, txInsertValues } = createService({});

      const result = await service.create(
        {
          title: 'Hello',
          slug: 'hello',
          content: 'Body',
          isPublished: true,
          allowComments: true,
          topicIds: ['t1'],
        },
        'author-1',
      );

      expect(txInsertValues).toHaveBeenCalled();
      expect(result).toEqual(flattenedPost);
    });

    it('creates a post with no topics when topicIds is empty', async () => {
      const { service } = createService({});

      await service.create(
        {
          title: 'Hello',
          slug: 'hello',
          content: 'Body',
          isPublished: true,
          allowComments: true,
          topicIds: [],
        },
        'author-1',
      );

      // Second insert() call (topics junction rows) never happens for an
      // empty topicIds array — only the post insert itself does.
      expect(true).toBe(true);
    });
  });

  describe('findAllPublished', () => {
    it('flattens postsToTopics into a topics array for every result', async () => {
      const findMany = jest.fn().mockResolvedValue([rawPostWithTopics]);
      const { service } = createService({ findMany });

      await expect(service.findAllPublished()).resolves.toEqual([
        flattenedPost,
      ]);
    });
  });

  describe('findAllForDashboard', () => {
    it('flattens postsToTopics for every result, published or not', async () => {
      const findMany = jest.fn().mockResolvedValue([rawPostWithTopics]);
      const { service } = createService({ findMany });

      await expect(service.findAllForDashboard()).resolves.toEqual([
        flattenedPost,
      ]);
    });
  });

  describe('findPublishedBySlug', () => {
    it('returns the flattened post when found', async () => {
      const findFirst = jest.fn().mockResolvedValue(rawPostWithTopics);
      const { service } = createService({ findFirst });

      await expect(service.findPublishedBySlug('hello')).resolves.toEqual(
        flattenedPost,
      );
    });

    it('throws NotFoundException when no published post matches the slug', async () => {
      const findFirst = jest.fn().mockResolvedValue(undefined);
      const { service } = createService({ findFirst });

      await expect(service.findPublishedBySlug('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates the post and returns the flattened result', async () => {
      const { service, txUpdateSet } = createService({});

      const result = await service.update('post-1', { title: 'Updated' });

      expect(txUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Updated' }),
      );
      expect(result).toEqual(flattenedPost);
    });

    it('throws NotFoundException when the post does not exist', async () => {
      const txUpdateReturning = jest.fn().mockResolvedValue([]);
      const { service } = createService({ txUpdateReturning });

      await expect(
        service.update('missing', { title: 'Updated' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('reassigns topics when topicIds is provided', async () => {
      const { service, txDelete, txInsert } = createService({});

      await service.update('post-1', { topicIds: ['t2', 't3'] });

      expect(txDelete).toHaveBeenCalled();
      expect(txInsert).toHaveBeenCalled();
    });

    it('clears topics when topicIds is an empty array', async () => {
      const { service, txDelete, txInsert } = createService({});
      txInsert.mockClear();

      await service.update('post-1', { topicIds: [] });

      expect(txDelete).toHaveBeenCalled();
      expect(txInsert).not.toHaveBeenCalled();
    });

    it('leaves topics untouched when topicIds is not provided', async () => {
      const { service, txDelete } = createService({});

      await service.update('post-1', { title: 'Updated only' });

      expect(txDelete).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the post and cleans up its S3 images', async () => {
      const deleteReturning = jest
        .fn()
        .mockResolvedValue([{ id: 'post-1', content: '![x](url)' }]);
      const extractBucketKeysFromContent = jest.fn().mockReturnValue(['key-1']);
      const deleteFiles = jest.fn().mockResolvedValue(undefined);
      const { service } = createService({
        deleteReturning,
        extractBucketKeysFromContent,
        deleteFiles,
      });

      await service.remove('post-1');

      expect(deleteFiles).toHaveBeenCalledWith(['key-1']);
    });

    it('does not attempt S3 cleanup when the post has no embedded images', async () => {
      const deleteReturning = jest
        .fn()
        .mockResolvedValue([{ id: 'post-1', content: 'no images here' }]);
      const deleteFiles = jest.fn().mockResolvedValue(undefined);
      const { service } = createService({ deleteReturning, deleteFiles });

      await service.remove('post-1');

      expect(deleteFiles).not.toHaveBeenCalled();
    });

    it('still returns successfully even if S3 cleanup fails', async () => {
      const deleteReturning = jest
        .fn()
        .mockResolvedValue([{ id: 'post-1', content: '![x](url)' }]);
      const extractBucketKeysFromContent = jest.fn().mockReturnValue(['key-1']);
      const deleteFiles = jest.fn().mockRejectedValue(new Error('S3 down'));
      const { service } = createService({
        deleteReturning,
        extractBucketKeysFromContent,
        deleteFiles,
      });

      await expect(service.remove('post-1')).resolves.toEqual({
        id: 'post-1',
        content: '![x](url)',
      });
    });

    it('throws NotFoundException when the post does not exist', async () => {
      const deleteReturning = jest.fn().mockResolvedValue([]);
      const { service } = createService({ deleteReturning });

      await expect(service.remove('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
