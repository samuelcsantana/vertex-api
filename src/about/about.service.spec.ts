import { AboutService } from './about.service';
import { DatabaseService } from '../database/database.service';

describe('AboutService', () => {
  function createService(options: {
    findFirst?: jest.Mock;
    insertReturning?: jest.Mock;
    updateReturning?: jest.Mock;
  }) {
    const findFirst = options.findFirst ?? jest.fn();

    const insertReturning = options.insertReturning ?? jest.fn();
    const insertValues = jest
      .fn()
      .mockReturnValue({ returning: insertReturning });
    const insert = jest.fn().mockReturnValue({ values: insertValues });

    const updateReturning = options.updateReturning ?? jest.fn();
    const updateWhere = jest
      .fn()
      .mockReturnValue({ returning: updateReturning });
    const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
    const update = jest.fn().mockReturnValue({ set: updateSet });

    const databaseService = {
      db: { query: { aboutContent: { findFirst } }, insert, update },
    } as unknown as DatabaseService;

    return {
      service: new AboutService(databaseService),
      insertValues,
      updateSet,
    };
  }

  describe('get', () => {
    it('returns the existing row when one exists', async () => {
      const findFirst = jest
        .fn()
        .mockResolvedValue({ id: 'about-1', content: 'Hello' });
      const { service } = createService({ findFirst });

      await expect(service.get()).resolves.toEqual({
        id: 'about-1',
        content: 'Hello',
      });
    });

    it('creates an empty row when none exists yet', async () => {
      const findFirst = jest.fn().mockResolvedValue(undefined);
      const insertReturning = jest
        .fn()
        .mockResolvedValue([{ id: 'about-1', content: '' }]);
      const { service, insertValues } = createService({
        findFirst,
        insertReturning,
      });

      const result = await service.get();

      expect(insertValues).toHaveBeenCalledWith({ content: '' });
      expect(result).toEqual({ id: 'about-1', content: '' });
    });
  });

  describe('update', () => {
    it('creates a row when none exists yet', async () => {
      const findFirst = jest.fn().mockResolvedValue(undefined);
      const insertReturning = jest
        .fn()
        .mockResolvedValue([{ id: 'about-1', content: 'New content' }]);
      const { service, insertValues } = createService({
        findFirst,
        insertReturning,
      });

      const result = await service.update({ content: 'New content' });

      expect(insertValues).toHaveBeenCalledWith({ content: 'New content' });
      expect(result).toEqual({ id: 'about-1', content: 'New content' });
    });

    it('updates the existing row when one already exists', async () => {
      const findFirst = jest
        .fn()
        .mockResolvedValue({ id: 'about-1', content: 'Old content' });
      const updateReturning = jest
        .fn()
        .mockResolvedValue([{ id: 'about-1', content: 'Updated content' }]);
      const { service, updateSet } = createService({
        findFirst,
        updateReturning,
      });

      const result = await service.update({ content: 'Updated content' });

      expect(updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Updated content' }),
      );
      expect(result).toEqual({ id: 'about-1', content: 'Updated content' });
    });

    it('persists the optional en/es translations when provided', async () => {
      const findFirst = jest
        .fn()
        .mockResolvedValue({ id: 'about-1', content: 'Old content' });
      const updateReturning = jest.fn().mockResolvedValue([
        {
          id: 'about-1',
          content: 'Conteúdo',
          contentEn: 'Content',
          contentEs: 'Contenido',
        },
      ]);
      const { service, updateSet } = createService({
        findFirst,
        updateReturning,
      });

      await service.update({
        content: 'Conteúdo',
        contentEn: 'Content',
        contentEs: 'Contenido',
      });

      expect(updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Conteúdo',
          contentEn: 'Content',
          contentEs: 'Contenido',
        }),
      );
    });
  });
});
