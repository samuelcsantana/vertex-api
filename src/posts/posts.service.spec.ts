import { ConflictException, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import { PostsService } from './posts.service';
import { DatabaseService } from '../database/database.service';
import { UploadsService } from '../uploads/uploads.service';
import { posts } from '../database/schema';

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
    extractBucketKeyFromUrl?: jest.Mock;
    deleteFiles?: jest.Mock;
    // Simulates the "postgres" driver rejecting mid-transaction (e.g. a
    // unique constraint violation) instead of resolving normally.
    transactionRejectsWith?: unknown;
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

    const transaction =
      'transactionRejectsWith' in options
        ? jest.fn().mockRejectedValue(options.transactionRejectsWith)
        : jest
            .fn()
            .mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const findMany = options.findMany ?? jest.fn().mockResolvedValue([]);
    // Defaults to an existing bare row: update()'s pre-cleanup snapshot
    // fetch goes through this, and most tests assume the post exists.
    // Tests exercising "post not found" pass their own findFirst.
    const findFirst =
      options.findFirst ??
      jest.fn().mockResolvedValue({ id: 'post-1', content: 'Body' });

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
      extractBucketKeyFromUrl:
        options.extractBucketKeyFromUrl ?? jest.fn().mockReturnValue(null),
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

    it.each([
      ['posts_slug_unique', 'slug'],
      ['posts_slug_en_unique', 'slugEn'],
      ['posts_slug_es_unique', 'slugEs'],
    ])(
      'turns a %s violation into a friendly ConflictException naming "%s"',
      async (constraint_name, field) => {
        // Drizzle wraps the driver's PostgresError in its own error class —
        // the real #code/#constraint_name live on .cause, not the thrown
        // error itself (mirrors what "postgres"/porsager actually throws).
        const drizzleError = new Error('insert failed');
        (drizzleError as { cause?: unknown }).cause = {
          code: '23505',
          constraint_name,
        };
        const { service } = createService({
          transactionRejectsWith: drizzleError,
        });

        await expect(
          service.create(
            { title: 'Hello', slug: 'hello', content: 'Body' },
            'author-1',
          ),
        ).rejects.toThrow(ConflictException);
        await expect(
          service.create(
            { title: 'Hello', slug: 'hello', content: 'Body' },
            'author-1',
          ),
        ).rejects.toThrow(new RegExp(field));
      },
    );

    it('rethrows unrelated errors unchanged', async () => {
      const dbError = new Error('connection lost');
      const { service } = createService({ transactionRejectsWith: dbError });

      await expect(
        service.create(
          { title: 'Hello', slug: 'hello', content: 'Body' },
          'author-1',
        ),
      ).rejects.toThrow(dbError);
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

    it('matches only the default slug column for "pt" or no locale', async () => {
      const findFirst = jest.fn().mockResolvedValue(rawPostWithTopics);
      const { service } = createService({ findFirst });

      await service.findPublishedBySlug('hello');

      const [{ where }] = findFirst.mock.calls[0] as [{ where: unknown }];
      expect(where).toEqual(
        and(eq(posts.slug, 'hello'), eq(posts.isPublished, true)),
      );
    });

    it('falls back to the default slug when slugEn is null, for locale "en"', async () => {
      const findFirst = jest.fn().mockResolvedValue(rawPostWithTopics);
      const { service } = createService({ findFirst });

      await service.findPublishedBySlug('hello', 'en');

      const [{ where }] = findFirst.mock.calls[0] as [{ where: unknown }];
      expect(where).toEqual(
        and(
          or(
            eq(posts.slugEn, 'hello'),
            and(isNull(posts.slugEn), eq(posts.slug, 'hello')),
          ),
          eq(posts.isPublished, true),
        ),
      );
    });

    it('falls back to the default slug when slugEs is null, for locale "es"', async () => {
      const findFirst = jest.fn().mockResolvedValue(rawPostWithTopics);
      const { service } = createService({ findFirst });

      await service.findPublishedBySlug('hello', 'es');

      const [{ where }] = findFirst.mock.calls[0] as [{ where: unknown }];
      expect(where).toEqual(
        and(
          or(
            eq(posts.slugEs, 'hello'),
            and(isNull(posts.slugEs), eq(posts.slug, 'hello')),
          ),
          eq(posts.isPublished, true),
        ),
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

    it('throws NotFoundException before updating when the post does not exist', async () => {
      const findFirst = jest.fn().mockResolvedValue(undefined);
      const { service } = createService({ findFirst });

      await expect(
        service.update('missing', { title: 'Updated' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('deletes bucket media the edit dropped, keeping what is still referenced', async () => {
      // Old post: cover + one inline image. Updated post (refetched inside
      // the tx): new cover, same inline image — only the old cover key
      // should be deleted.
      const findFirst = jest.fn().mockResolvedValue({
        id: 'post-1',
        content: '![x](https://bucket/inline-1.png)',
        coverUrl: 'https://bucket/old-cover.png',
      });
      const txFindFirst = jest.fn().mockResolvedValue({
        ...rawPostWithTopics,
        content: '![x](https://bucket/inline-1.png)',
        coverUrl: 'https://bucket/new-cover.png',
      });
      const extractBucketKeysFromContent = jest
        .fn()
        .mockImplementation((content: string) =>
          content.includes('inline-1') ? ['inline-1.png'] : [],
        );
      const extractBucketKeyFromUrl = jest
        .fn()
        .mockImplementation((url: string | null) =>
          url ? url.replace('https://bucket/', '') : null,
        );
      const deleteFiles = jest.fn().mockResolvedValue(undefined);
      const { service } = createService({
        findFirst,
        txFindFirst,
        extractBucketKeysFromContent,
        extractBucketKeyFromUrl,
        deleteFiles,
      });

      await service.update('post-1', {
        coverUrl: 'https://bucket/new-cover.png',
      });

      expect(deleteFiles).toHaveBeenCalledWith(['old-cover.png']);
    });

    it('does not attempt cleanup when the edit drops no media', async () => {
      const findFirst = jest.fn().mockResolvedValue({
        id: 'post-1',
        content: 'Body',
        coverUrl: 'https://bucket/cover.png',
      });
      const txFindFirst = jest.fn().mockResolvedValue({
        ...rawPostWithTopics,
        coverUrl: 'https://bucket/cover.png',
      });
      const extractBucketKeyFromUrl = jest
        .fn()
        .mockImplementation((url: string | null) =>
          url ? url.replace('https://bucket/', '') : null,
        );
      const deleteFiles = jest.fn().mockResolvedValue(undefined);
      const { service } = createService({
        findFirst,
        txFindFirst,
        extractBucketKeyFromUrl,
        deleteFiles,
      });

      await service.update('post-1', { title: 'Updated' });

      expect(deleteFiles).not.toHaveBeenCalled();
    });

    it('still resolves when post-update cleanup fails', async () => {
      const findFirst = jest.fn().mockResolvedValue({
        id: 'post-1',
        content: 'Body',
        coverUrl: 'https://bucket/old-cover.png',
      });
      const extractBucketKeyFromUrl = jest
        .fn()
        .mockImplementation((url: string | null) =>
          url ? url.replace('https://bucket/', '') : null,
        );
      const deleteFiles = jest.fn().mockRejectedValue(new Error('S3 down'));
      const { service } = createService({
        findFirst,
        extractBucketKeyFromUrl,
        deleteFiles,
      });

      await expect(
        service.update('post-1', { coverUrl: undefined }),
      ).resolves.toEqual(flattenedPost);
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

    it('cleans up bucket-hosted covers in every locale', async () => {
      const deleteReturning = jest.fn().mockResolvedValue([
        {
          id: 'post-1',
          content: 'no images',
          coverUrl: 'https://bucket/cover-pt.png',
          coverUrlEn: 'https://bucket/cover-en.png',
          coverUrlEs: null,
        },
      ]);
      const extractBucketKeyFromUrl = jest
        .fn()
        .mockImplementation((url: string | null) =>
          url ? url.replace('https://bucket/', '') : null,
        );
      const deleteFiles = jest.fn().mockResolvedValue(undefined);
      const { service } = createService({
        deleteReturning,
        extractBucketKeyFromUrl,
        deleteFiles,
      });

      await service.remove('post-1');

      expect(deleteFiles).toHaveBeenCalledWith([
        'cover-pt.png',
        'cover-en.png',
      ]);
    });

    it('scans all content locales and deduplicates shared keys', async () => {
      const deleteReturning = jest.fn().mockResolvedValue([
        {
          id: 'post-1',
          content: 'pt-body',
          contentEn: 'en-body',
          contentEs: 'es-body',
        },
      ]);
      // The same image reused across translations must be deleted once.
      const extractBucketKeysFromContent = jest
        .fn()
        .mockImplementation((content: string) =>
          content === 'es-body'
            ? ['shared.png', 'es-only.png']
            : ['shared.png'],
        );
      const deleteFiles = jest.fn().mockResolvedValue(undefined);
      const { service } = createService({
        deleteReturning,
        extractBucketKeysFromContent,
        deleteFiles,
      });

      await service.remove('post-1');

      expect(extractBucketKeysFromContent).toHaveBeenCalledTimes(3);
      expect(deleteFiles).toHaveBeenCalledWith(['shared.png', 'es-only.png']);
    });
  });
});
