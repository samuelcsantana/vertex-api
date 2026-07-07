import { NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { DatabaseService } from '../database/database.service';

describe('ProjectsService', () => {
  function createService(options: {
    findMany?: jest.Mock;
    findFirst?: jest.Mock;
    insertReturning?: jest.Mock;
    updateReturning?: jest.Mock;
    deleteReturning?: jest.Mock;
  }) {
    const findMany = options.findMany ?? jest.fn().mockResolvedValue([]);
    const findFirst =
      options.findFirst ?? jest.fn().mockResolvedValue(undefined);

    const insertReturning =
      options.insertReturning ?? jest.fn().mockResolvedValue([]);
    const insertValues = jest
      .fn()
      .mockReturnValue({ returning: insertReturning });
    const insert = jest.fn().mockReturnValue({ values: insertValues });

    const updateReturning =
      options.updateReturning ?? jest.fn().mockResolvedValue([]);
    const updateWhere = jest
      .fn()
      .mockReturnValue({ returning: updateReturning });
    const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
    const update = jest.fn().mockReturnValue({ set: updateSet });

    const deleteReturning =
      options.deleteReturning ?? jest.fn().mockResolvedValue([]);
    const deleteWhere = jest
      .fn()
      .mockReturnValue({ returning: deleteReturning });
    const del = jest.fn().mockReturnValue({ where: deleteWhere });

    const databaseService = {
      db: {
        query: { projects: { findMany, findFirst } },
        insert,
        update,
        delete: del,
      },
    } as unknown as DatabaseService;

    return {
      service: new ProjectsService(databaseService),
      insertValues,
      updateSet,
    };
  }

  describe('create', () => {
    it('inserts the project and returns the created row', async () => {
      const insertReturning = jest
        .fn()
        .mockResolvedValue([{ id: 'p1', title: 'Vertex' }]);
      const { service, insertValues } = createService({ insertReturning });

      const result = await service.create({
        title: 'Vertex',
        description: 'A project',
        techStack: ['TypeScript'],
      });

      expect(insertValues).toHaveBeenCalledWith({
        title: 'Vertex',
        description: 'A project',
        techStack: ['TypeScript'],
      });
      expect(result).toEqual({ id: 'p1', title: 'Vertex' });
    });
  });

  describe('findAll', () => {
    it('returns whatever the query layer returns', async () => {
      const findMany = jest
        .fn()
        .mockResolvedValue([{ id: 'p1', title: 'Vertex' }]);
      const { service } = createService({ findMany });

      await expect(service.findAll()).resolves.toEqual([
        { id: 'p1', title: 'Vertex' },
      ]);
    });
  });

  describe('findById', () => {
    it('returns the project when found', async () => {
      const findFirst = jest
        .fn()
        .mockResolvedValue({ id: 'p1', title: 'Vertex' });
      const { service } = createService({ findFirst });

      await expect(service.findById('p1')).resolves.toEqual({
        id: 'p1',
        title: 'Vertex',
      });
    });

    it('throws NotFoundException when no project matches the id', async () => {
      const { service } = createService({});

      await expect(service.findById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates the project and returns the new row', async () => {
      const updateReturning = jest
        .fn()
        .mockResolvedValue([{ id: 'p1', title: 'Renamed' }]);
      const { service, updateSet } = createService({ updateReturning });

      await service.update('p1', { title: 'Renamed' });

      expect(updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Renamed' }),
      );
    });

    it('throws NotFoundException when the project does not exist', async () => {
      const { service } = createService({});

      await expect(service.update('missing', { title: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('returns the deleted project', async () => {
      const deleteReturning = jest
        .fn()
        .mockResolvedValue([{ id: 'p1', title: 'Vertex' }]);
      const { service } = createService({ deleteReturning });

      await expect(service.remove('p1')).resolves.toEqual({
        id: 'p1',
        title: 'Vertex',
      });
    });

    it('throws NotFoundException when the project does not exist', async () => {
      const { service } = createService({});

      await expect(service.remove('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
