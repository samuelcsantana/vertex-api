import { NotFoundException } from '@nestjs/common';
import { TopicsService } from './topics.service';
import { DatabaseService } from '../database/database.service';

describe('TopicsService', () => {
  function createService(options: {
    findMany?: jest.Mock;
    insertReturning?: jest.Mock;
    updateReturning?: jest.Mock;
    deleteReturning?: jest.Mock;
  }) {
    const findMany = options.findMany ?? jest.fn().mockResolvedValue([]);

    const insertReturning =
      options.insertReturning ?? jest.fn().mockResolvedValue([]);
    const insertValues = jest.fn().mockReturnValue({
      returning: insertReturning,
    });
    const insert = jest.fn().mockReturnValue({ values: insertValues });

    const updateReturning =
      options.updateReturning ?? jest.fn().mockResolvedValue([]);
    const updateWhere = jest.fn().mockReturnValue({
      returning: updateReturning,
    });
    const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
    const update = jest.fn().mockReturnValue({ set: updateSet });

    const deleteReturning =
      options.deleteReturning ?? jest.fn().mockResolvedValue([]);
    const deleteWhere = jest.fn().mockReturnValue({
      returning: deleteReturning,
    });
    const del = jest.fn().mockReturnValue({ where: deleteWhere });

    const databaseService = {
      db: {
        query: { topics: { findMany } },
        insert,
        update,
        delete: del,
      },
    } as unknown as DatabaseService;

    return {
      service: new TopicsService(databaseService),
      insertValues,
      updateSet,
    };
  }

  describe('create', () => {
    it('slugifies the name before inserting', async () => {
      const insertReturning = jest
        .fn()
        .mockResolvedValue([
          { id: 't1', name: 'Cafés Especiais', slug: 'cafes-especiais' },
        ]);
      const { service, insertValues } = createService({ insertReturning });

      const result = await service.create({ name: 'Cafés Especiais' });

      expect(insertValues).toHaveBeenCalledWith({
        name: 'Cafés Especiais',
        slug: 'cafes-especiais',
      });
      expect(result).toEqual({
        id: 't1',
        name: 'Cafés Especiais',
        slug: 'cafes-especiais',
      });
    });
  });

  describe('findAll', () => {
    it('returns whatever the query layer returns', async () => {
      const findMany = jest
        .fn()
        .mockResolvedValue([{ id: 't1', name: 'A', slug: 'a' }]);
      const { service } = createService({ findMany });

      await expect(service.findAll()).resolves.toEqual([
        { id: 't1', name: 'A', slug: 'a' },
      ]);
    });
  });

  describe('update', () => {
    it('re-slugifies the name on rename', async () => {
      const updateReturning = jest
        .fn()
        .mockResolvedValue([
          { id: 't1', name: 'Renamed Topic', slug: 'renamed-topic' },
        ]);
      const { service, updateSet } = createService({ updateReturning });

      await service.update('t1', { name: 'Renamed Topic' });

      expect(updateSet).toHaveBeenCalledWith({
        name: 'Renamed Topic',
        slug: 'renamed-topic',
      });
    });

    it('throws NotFoundException when the topic does not exist', async () => {
      const updateReturning = jest.fn().mockResolvedValue([]);
      const { service } = createService({ updateReturning });

      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('returns the deleted topic', async () => {
      const deleteReturning = jest
        .fn()
        .mockResolvedValue([{ id: 't1', name: 'A', slug: 'a' }]);
      const { service } = createService({ deleteReturning });

      await expect(service.remove('t1')).resolves.toEqual({
        id: 't1',
        name: 'A',
        slug: 'a',
      });
    });

    it('throws NotFoundException when the topic does not exist', async () => {
      const deleteReturning = jest.fn().mockResolvedValue([]);
      const { service } = createService({ deleteReturning });

      await expect(service.remove('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
