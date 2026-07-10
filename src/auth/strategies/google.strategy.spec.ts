import { UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Profile } from 'passport-google-oauth20';
import { GoogleStrategy } from './google.strategy';
import { DatabaseService } from '../../database/database.service';
import { GoogleAlreadyLinkedException } from '../exceptions/google-link.exceptions';

const baseUser = {
  id: 'user-1',
  email: 'visitor@example.com',
  name: 'Existing Name',
  avatarUrl: 'https://example.com/existing.png',
  role: 'user' as const,
  googleId: null,
};

const googleProfile = {
  id: 'google-123',
  displayName: 'Google Name',
  emails: [{ value: 'visitor@example.com' }],
  photos: [{ value: 'https://lh3.googleusercontent.com/photo.jpg' }],
} as unknown as Profile;

function createStrategy(options: {
  findFirst?: jest.Mock;
  updateReturning?: jest.Mock;
  insertReturning?: jest.Mock;
}) {
  const findFirst = options.findFirst ?? jest.fn().mockResolvedValue(undefined);

  const updateReturning =
    options.updateReturning ?? jest.fn().mockResolvedValue([baseUser]);
  const updateWhere = jest.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set: updateSet });

  const insertReturning =
    options.insertReturning ?? jest.fn().mockResolvedValue([baseUser]);
  const insertValues = jest
    .fn()
    .mockReturnValue({ returning: insertReturning });
  const insert = jest.fn().mockReturnValue({ values: insertValues });

  const databaseService = {
    db: {
      query: { users: { findFirst } },
      update,
      insert,
    },
  } as unknown as DatabaseService;

  return {
    strategy: new GoogleStrategy(databaseService),
    updateSet,
    insertValues,
  };
}

// Fake Fastify request carrying (or not) the signed link cookie.
function requestWith(linkUserId: string | null): FastifyRequest {
  return {
    cookies: linkUserId ? { link_user_id: `signed:${linkUserId}` } : {},
    unsignCookie: (value: string) => ({
      valid: true,
      value: value.replace('signed:', ''),
    }),
  } as unknown as FastifyRequest;
}

function runValidate(
  strategy: GoogleStrategy,
  req: FastifyRequest,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    strategy
      .validate(req, 'at', 'rt', googleProfile, (err, payload) =>
        err instanceof Error ? reject(err) : resolve(payload),
      )
      .catch((error: unknown) =>
        reject(error instanceof Error ? error : new Error(String(error))),
      );
  });
}

describe('GoogleStrategy — link flow', () => {
  it('attaches googleId to the logged-in user, preserving their avatar', async () => {
    // First findFirst call: conflict check (none). Second: the current user.
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(baseUser);
    const { strategy, updateSet } = createStrategy({ findFirst });

    await runValidate(strategy, requestWith('user-1'));

    expect(updateSet).toHaveBeenCalledWith({
      googleId: 'google-123',
      avatarUrl: baseUser.avatarUrl,
    });
  });

  it('rejects linking a Google account already linked to someone else', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ ...baseUser, id: 'someone-else' });
    const { strategy } = createStrategy({ findFirst });

    await expect(runValidate(strategy, requestWith('user-1'))).rejects.toThrow(
      GoogleAlreadyLinkedException,
    );
  });

  it('rejects when the user to link to no longer exists', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const { strategy } = createStrategy({ findFirst });

    await expect(runValidate(strategy, requestWith('user-1'))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('GoogleStrategy — login flow', () => {
  it('stores googleId on an email-matched account without clobbering edits', async () => {
    const findFirst = jest.fn().mockResolvedValue(baseUser);
    const { strategy, updateSet } = createStrategy({ findFirst });

    await runValidate(strategy, requestWith(null));

    expect(updateSet).toHaveBeenCalledWith({
      googleId: 'google-123',
      // Fill-if-missing: the user's own edits win over Google's values.
      name: 'Existing Name',
      avatarUrl: baseUser.avatarUrl,
    });
  });

  it('creates a new user carrying the googleId on first login', async () => {
    const { strategy, insertValues } = createStrategy({});

    await runValidate(strategy, requestWith(null));

    const [inserted] = insertValues.mock.calls[0] as [
      { googleId: string; email: string; passwordHash: string },
    ];
    expect(inserted.googleId).toBe('google-123');
    expect(inserted.email).toBe('visitor@example.com');
    expect(inserted.passwordHash).toMatch(/^\$argon2/);
  });
});
