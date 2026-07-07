import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { DatabaseService } from '../database/database.service';

describe('UsersService', () => {
  function createService(options: {
    findMany?: jest.Mock;
    updateReturning?: jest.Mock;
    txFindFirstPost?: jest.Mock;
    txDeleteUserReturning?: jest.Mock;
  }) {
    const findMany = options.findMany ?? jest.fn().mockResolvedValue([]);

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
    const txDelete = jest.fn().mockImplementation(() => {
      deleteCallCount += 1;
      // First delete() call in remove() targets comments, second targets users.
      return deleteCallCount === 1
        ? txDeleteComments()
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
        query: { users: { findMany } },
        update,
        transaction,
      },
    } as unknown as DatabaseService;

    return {
      service: new UsersService(databaseService),
      updateSet,
      txDeleteCommentsWhere,
      txDeleteUserWhere,
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

      await expect(
        service.setBanned('u1', true, 'u1'),
      ).rejects.toThrow(BadRequestException);
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
});
