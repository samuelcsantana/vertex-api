import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { DatabaseService } from '../database/database.service';
import { UploadsService } from '../uploads/uploads.service';

describe('UsersService', () => {
  function createService(options: {
    findMany?: jest.Mock;
    findFirst?: jest.Mock;
    updateReturning?: jest.Mock;
    txFindFirstPost?: jest.Mock;
    txDeleteUserReturning?: jest.Mock;
    extractBucketKeyFromUrl?: jest.Mock;
    deleteFiles?: jest.Mock;
  }) {
    const findMany = options.findMany ?? jest.fn().mockResolvedValue([]);
    const findFirst =
      options.findFirst ?? jest.fn().mockResolvedValue(undefined);

    const updateReturning =
      options.updateReturning ?? jest.fn().mockResolvedValue([]);
    const updateWhere = jest.fn().mockReturnValue({
      returning: updateReturning,
    });
    const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
    const update = jest.fn().mockReturnValue({ set: updateSet });

    const txFindFirstPost =
      options.txFindFirstPost ?? jest.fn().mockResolvedValue(undefined);
    const txDeleteCommentsWhere = jest.fn().mockResolvedValue(undefined);
    const txDeleteComments = jest
      .fn()
      .mockReturnValue({ where: txDeleteCommentsWhere });

    const txDeleteUserReturning =
      options.txDeleteUserReturning ?? jest.fn().mockResolvedValue([]);
    const txDeleteUserWhere = jest
      .fn()
      .mockReturnValue({ returning: txDeleteUserReturning });

    let deleteCallCount = 0;
    const txDelete = jest.fn().mockImplementation((): { where: jest.Mock } => {
      deleteCallCount += 1;
      // First delete() call in remove() targets comments, second targets users.
      return deleteCallCount === 1
        ? (txDeleteComments() as { where: jest.Mock })
        : { where: txDeleteUserWhere };
    });

    const tx = {
      query: { posts: { findFirst: txFindFirstPost } },
      delete: txDelete,
    };

    const transaction = jest
      .fn()
      .mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const databaseService = {
      db: {
        query: { users: { findMany, findFirst } },
        update,
        transaction,
      },
    } as unknown as DatabaseService;

    const deleteFiles =
      options.deleteFiles ?? jest.fn().mockResolvedValue(undefined);
    const uploadsService = {
      extractBucketKeyFromUrl:
        options.extractBucketKeyFromUrl ?? jest.fn().mockReturnValue(null),
      deleteFiles,
    } as unknown as UploadsService;

    return {
      service: new UsersService(databaseService, uploadsService),
      updateSet,
      txDeleteCommentsWhere,
      txDeleteUserWhere,
      deleteFiles,
    };
  }

  describe('findAll', () => {
    it('returns whatever the query layer returns', async () => {
      const findMany = jest
        .fn()
        .mockResolvedValue([{ id: 'u1', email: 'a@example.com' }]);
      const { service } = createService({ findMany });

      await expect(service.findAll()).resolves.toEqual([
        { id: 'u1', email: 'a@example.com' },
      ]);
    });
  });

  describe('setBanned', () => {
    it('rejects banning your own account', async () => {
      const { service } = createService({});

      await expect(service.setBanned('u1', true, 'u1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('updates isBanned for another user', async () => {
      const updateReturning = jest
        .fn()
        .mockResolvedValue([{ id: 'u2', isBanned: true }]);
      const { service, updateSet } = createService({ updateReturning });

      const result = await service.setBanned('u2', true, 'admin-1');

      expect(updateSet).toHaveBeenCalledWith({ isBanned: true });
      expect(result).toEqual({ id: 'u2', isBanned: true });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      const updateReturning = jest.fn().mockResolvedValue([]);
      const { service } = createService({ updateReturning });

      await expect(
        service.setBanned('missing', true, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('rejects deleting your own account', async () => {
      const { service } = createService({});

      await expect(service.remove('u1', 'u1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the user has authored posts', async () => {
      const txFindFirstPost = jest
        .fn()
        .mockResolvedValue({ id: 'post-1', authorId: 'u2' });
      const { service } = createService({ txFindFirstPost });

      await expect(service.remove('u2', 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('cascades comments and deletes the user', async () => {
      const txDeleteUserReturning = jest
        .fn()
        .mockResolvedValue([{ id: 'u2', email: 'u2@example.com' }]);
      const { service, txDeleteCommentsWhere } = createService({
        txDeleteUserReturning,
      });

      const result = await service.remove('u2', 'admin-1');

      expect(txDeleteCommentsWhere).toHaveBeenCalled();
      expect(result).toEqual({ id: 'u2', email: 'u2@example.com' });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      const txDeleteUserReturning = jest.fn().mockResolvedValue([]);
      const { service } = createService({ txDeleteUserReturning });

      await expect(service.remove('missing', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateSelf', () => {
    const existing = {
      id: 'u1',
      email: 'u1@example.com',
      name: 'Old Name',
      displayName: 'oldnick',
      avatarUrl: 'https://bucket/avatars/u1/old.png',
    };

    it('updates the provided fields, keeping the rest', async () => {
      const findFirst = jest.fn().mockResolvedValue(existing);
      const updateReturning = jest
        .fn()
        .mockResolvedValue([{ id: 'u1', displayName: 'newnick' }]);
      const { service, updateSet } = createService({
        findFirst,
        updateReturning,
      });

      const result = await service.updateSelf('u1', {
        displayName: 'newnick',
      });

      expect(updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Old Name',
          displayName: 'newnick',
          avatarUrl: existing.avatarUrl,
        }),
      );
      expect(result).toEqual({ id: 'u1', displayName: 'newnick' });
    });

    it('clears the avatar on "" and deletes the old bucket-hosted object', async () => {
      const findFirst = jest.fn().mockResolvedValue(existing);
      const updateReturning = jest
        .fn()
        .mockResolvedValue([{ id: 'u1', avatarUrl: null }]);
      const extractBucketKeyFromUrl = jest
        .fn()
        .mockReturnValue('avatars/u1/old.png');
      const { service, updateSet, deleteFiles } = createService({
        findFirst,
        updateReturning,
        extractBucketKeyFromUrl,
      });

      await service.updateSelf('u1', { avatarUrl: '' });

      expect(updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ avatarUrl: null }),
      );
      expect(deleteFiles).toHaveBeenCalledWith(['avatars/u1/old.png']);
    });

    it('does not delete a replaced avatar hosted outside the bucket', async () => {
      const findFirst = jest.fn().mockResolvedValue({
        ...existing,
        avatarUrl: 'https://lh3.googleusercontent.com/photo.jpg',
      });
      const updateReturning = jest
        .fn()
        .mockResolvedValue([{ id: 'u1', avatarUrl: 'https://bucket/new.png' }]);
      const { service, deleteFiles } = createService({
        findFirst,
        updateReturning,
      });

      await service.updateSelf('u1', { avatarUrl: 'https://bucket/new.png' });

      expect(deleteFiles).not.toHaveBeenCalled();
    });

    it('still resolves when old-avatar cleanup fails', async () => {
      const findFirst = jest.fn().mockResolvedValue(existing);
      const updateReturning = jest
        .fn()
        .mockResolvedValue([{ id: 'u1', avatarUrl: null }]);
      const extractBucketKeyFromUrl = jest
        .fn()
        .mockReturnValue('avatars/u1/old.png');
      const deleteFiles = jest.fn().mockRejectedValue(new Error('S3 down'));
      const { service } = createService({
        findFirst,
        updateReturning,
        extractBucketKeyFromUrl,
        deleteFiles,
      });

      await expect(
        service.updateSelf('u1', { avatarUrl: '' }),
      ).resolves.toEqual({ id: 'u1', avatarUrl: null });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      const { service } = createService({});

      await expect(
        service.updateSelf('missing', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeSelf', () => {
    it('allows a user to delete their own account (no self-block, unlike remove)', async () => {
      const txDeleteUserReturning = jest
        .fn()
        .mockResolvedValue([{ id: 'u1', email: 'u1@example.com' }]);
      const { service, txDeleteCommentsWhere } = createService({
        txDeleteUserReturning,
      });

      const result = await service.removeSelf('u1');

      expect(txDeleteCommentsWhere).toHaveBeenCalled();
      expect(result).toEqual({ id: 'u1', email: 'u1@example.com' });
    });

    it('still refuses to delete a user who has authored posts', async () => {
      const txFindFirstPost = jest
        .fn()
        .mockResolvedValue({ id: 'post-1', authorId: 'u1' });
      const { service } = createService({ txFindFirstPost });

      await expect(service.removeSelf('u1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when the user does not exist', async () => {
      const txDeleteUserReturning = jest.fn().mockResolvedValue([]);
      const { service } = createService({ txDeleteUserReturning });

      await expect(service.removeSelf('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
