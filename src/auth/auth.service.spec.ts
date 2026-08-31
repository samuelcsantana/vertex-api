import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { DatabaseService } from '../database/database.service';

describe('AuthService — OAuth exchange codes', () => {
  const storedUser = {
    id: 'user-1',
    email: 'user@example.com',
    role: 'user' as const,
    name: 'Test User',
    avatarUrl: null,
  };

  // Independent re-implementation of the service's hashing, so a failure here
  // means the scheme changed rather than both sides drifting together.
  function hashOf(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  /**
   * A fake standing in for the one table this flow touches.
   *
   * It keeps whatever the service inserted and hands that same row back to the
   * DELETE ... RETURNING, then forgets it — which is what lets the TTL tests
   * assert against the expiry the service itself computed instead of one the
   * test made up. What it cannot model is the part that now lives in Postgres:
   * that two simultaneous exchanges of one code produce exactly one winner is
   * a property of the DELETE, not of this class, and is covered in the e2e
   * suite against a real database.
   */
  function createService(options: {
    user?: typeof storedUser | undefined;
    pruneError?: Error;
  }) {
    const user = 'user' in options ? options.user : storedUser;

    let row: { codeHash: string; userId: string; expiresAt: Date } | null =
      null;

    const insertValues = jest.fn((values: typeof row) => {
      row = values;
      return Promise.resolve(undefined);
    });
    const insert = jest.fn().mockReturnValue({ values: insertValues });

    const returning = jest.fn(() => {
      const consumed = row;
      row = null;
      return Promise.resolve(consumed ? [consumed] : []);
    });

    // The service awaits this object directly when pruning and calls
    // .returning() on it when consuming a code, so it has to be both a
    // thenable and a builder.
    const where = jest.fn(() => ({
      returning,
      then: (
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) =>
        (options.pruneError
          ? Promise.reject(options.pruneError)
          : Promise.resolve(undefined)
        ).then(onFulfilled, onRejected),
    }));
    const del = jest.fn().mockReturnValue({ where });

    const userFindFirst = jest.fn().mockResolvedValue(user);
    const signAsync = jest.fn().mockResolvedValue('fake.jwt.token');

    const databaseService = {
      db: {
        query: { users: { findFirst: userFindFirst } },
        insert,
        delete: del,
      },
    } as unknown as DatabaseService;
    const jwtService = { signAsync } as unknown as JwtService;

    return {
      service: new AuthService(databaseService, jwtService),
      insertValues,
      signAsync,
      userFindFirst,
    };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('exchanges a freshly minted code for a real access token', async () => {
    const { service, signAsync } = createService({});

    const code = await service.createOAuthExchangeCode(storedUser.id);
    const token = await service.exchangeOAuthCode(code);

    expect(token).toBe('fake.jwt.token');
    expect(signAsync).toHaveBeenCalledWith({
      sub: 'user-1',
      email: 'user@example.com',
      role: 'user',
      name: 'Test User',
      avatarUrl: null,
    });
  });

  it('stores only a hash of the code, never the code itself', async () => {
    const { service, insertValues } = createService({});

    const code = await service.createOAuthExchangeCode(storedUser.id);

    const stored = insertValues.mock.calls[0][0]!;
    expect(stored.codeHash).toBe(hashOf(code));
    expect(JSON.stringify(stored)).not.toContain(code);
  });

  it('builds the token from the user row as it stands at exchange time', async () => {
    // The reason the row holds a user id instead of a frozen payload: the
    // account was promoted after the code was minted, and the token has to
    // say so. Freezing the payload would issue a seven-day token describing
    // the user as they were up to a minute earlier.
    const { service, signAsync, userFindFirst } = createService({});
    userFindFirst.mockResolvedValue({ ...storedUser, role: 'admin' });

    const code = await service.createOAuthExchangeCode(storedUser.id);
    await service.exchangeOAuthCode(code);

    expect(signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin' }),
    );
  });

  it('is single-use: exchanging the same code twice fails the second time', async () => {
    const { service } = createService({});

    const code = await service.createOAuthExchangeCode(storedUser.id);
    await service.exchangeOAuthCode(code);

    await expect(service.exchangeOAuthCode(code)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a code that was never issued', async () => {
    const { service } = createService({});

    await expect(service.exchangeOAuthCode('never-issued')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a code after its 60-second TTL has elapsed', async () => {
    jest.useFakeTimers();
    const { service } = createService({});
    const code = await service.createOAuthExchangeCode(storedUser.id);

    jest.advanceTimersByTime(60_001);

    await expect(service.exchangeOAuthCode(code)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('still accepts a code just under the TTL', async () => {
    jest.useFakeTimers();
    const { service } = createService({});
    const code = await service.createOAuthExchangeCode(storedUser.id);

    jest.advanceTimersByTime(59_000);

    await expect(service.exchangeOAuthCode(code)).resolves.toBe(
      'fake.jwt.token',
    );
  });

  it('rejects a code whose account no longer exists', async () => {
    const { service } = createService({ user: undefined });

    const code = await service.createOAuthExchangeCode(storedUser.id);

    await expect(service.exchangeOAuthCode(code)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('issues a different code on every call, even for the same user', async () => {
    const { service } = createService({});

    const codeA = await service.createOAuthExchangeCode(storedUser.id);
    const codeB = await service.createOAuthExchangeCode(storedUser.id);

    expect(codeA).not.toBe(codeB);
  });

  it('still returns a code when pruning expired ones fails', async () => {
    // Pruning is housekeeping. Letting its failure escape would turn a
    // successful sign-in into a 500 inside an OAuth popup.
    const { service } = createService({ pruneError: new Error('db down') });

    await expect(
      service.createOAuthExchangeCode(storedUser.id),
    ).resolves.toEqual(expect.any(String));
  });
});

describe('AuthService — register/login/toProfile', () => {
  // Real argon2 throughout this block, deliberately not mocked: the whole
  // point of these tests is confirming a wrong password is actually
  // rejected and a right one actually accepted, which a mocked hash/verify
  // pair couldn't tell you anything about.
  function createService(findFirst: jest.Mock, insertReturning?: jest.Mock) {
    const returning =
      insertReturning ?? jest.fn().mockResolvedValue([{ id: 'user-1' }]);
    const values = jest.fn().mockReturnValue({ returning });
    const insert = jest.fn().mockReturnValue({ values });

    const databaseService = {
      db: { query: { users: { findFirst } }, insert },
    } as unknown as DatabaseService;
    const jwtService = {
      signAsync: jest.fn().mockResolvedValue('fake.jwt.token'),
    } as unknown as JwtService;

    return new AuthService(databaseService, jwtService);
  }

  describe('register', () => {
    it('creates a new user when the email is not already taken', async () => {
      const findFirst = jest.fn().mockResolvedValue(undefined);
      const returning = jest
        .fn()
        .mockResolvedValue([{ id: 'user-1', email: 'new@example.com' }]);
      const service = createService(findFirst, returning);

      const result = await service.register({
        email: 'new@example.com',
        password: 'testpass123',
      });

      expect(result).toEqual({ id: 'user-1', email: 'new@example.com' });
    });

    it('rejects a duplicate email with ConflictException', async () => {
      const findFirst = jest
        .fn()
        .mockResolvedValue({ id: 'existing', email: 'taken@example.com' });
      const service = createService(findFirst);

      await expect(
        service.register({ email: 'taken@example.com', password: 'x' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('rejects a login for an email that does not exist', async () => {
      const findFirst = jest.fn().mockResolvedValue(undefined);
      const service = createService(findFirst);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'x' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects the wrong password for a real user', async () => {
      const passwordHash = await argon2.hash('correct-password');
      const findFirst = jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        passwordHash,
        role: 'user',
        name: null,
        avatarUrl: null,
      });
      const service = createService(findFirst);

      await expect(
        service.login({
          email: 'user@example.com',
          password: 'wrong-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('issues a token for the correct password', async () => {
      const passwordHash = await argon2.hash('correct-password');
      const findFirst = jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        passwordHash,
        role: 'user',
        name: null,
        avatarUrl: null,
      });
      const service = createService(findFirst);

      const token = await service.login({
        email: 'user@example.com',
        password: 'correct-password',
      });

      expect(token).toBe('fake.jwt.token');
    });
  });

  describe('toProfile', () => {
    const row = {
      id: 'user-1',
      email: 'user@example.com',
      role: 'admin',
      name: 'Test User',
      displayName: 'Testy',
      avatarUrl: null,
      githubId: 'gh-1',
      googleId: null,
    } as unknown as Parameters<AuthService['toProfile']>[0];

    it('returns the profile shape for a row the caller already has', () => {
      const findFirst = jest.fn();
      const service = createService(findFirst);

      const profile = service.toProfile(row);

      expect(profile).toEqual({
        sub: 'user-1',
        email: 'user@example.com',
        role: 'admin',
        name: 'Test User',
        displayName: 'Testy',
        avatarUrl: null,
        githubId: 'gh-1',
        googleId: null,
      });
      // The point of the change: no second lookup on a primary key the guard
      // already resolved.
      expect(findFirst).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the row is gone', () => {
      // A token outlives the account it names — deleting your own account does
      // not invalidate the cookie already in your browser.
      const service = createService(jest.fn());

      expect(() => service.toProfile(undefined)).toThrow(NotFoundException);
    });
  });
});
