import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { DatabaseService } from '../database/database.service';
import { JwtPayload } from './interfaces/jwt-payload.interface';

describe('AuthService — OAuth exchange codes', () => {
  let service: AuthService;
  let signAsync: jest.Mock;

  const payload: JwtPayload = {
    sub: 'user-1',
    email: 'user@example.com',
    role: 'user',
    name: 'Test User',
    avatarUrl: null,
  };

  beforeEach(() => {
    signAsync = jest.fn().mockResolvedValue('fake.jwt.token');
    const jwtService = { signAsync } as unknown as JwtService;
    const databaseService = {} as DatabaseService;

    service = new AuthService(databaseService, jwtService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('exchanges a freshly minted code for a real access token', async () => {
    const code = service.createOAuthExchangeCode(payload);
    const token = await service.exchangeOAuthCode(code);

    expect(token).toBe('fake.jwt.token');
    expect(signAsync).toHaveBeenCalledWith(payload);
  });

  it('is single-use: exchanging the same code twice fails the second time', async () => {
    const code = service.createOAuthExchangeCode(payload);
    await service.exchangeOAuthCode(code);

    await expect(service.exchangeOAuthCode(code)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a code that was never issued', async () => {
    await expect(service.exchangeOAuthCode('never-issued')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a code after its 60-second TTL has elapsed', async () => {
    jest.useFakeTimers();
    const code = service.createOAuthExchangeCode(payload);

    jest.advanceTimersByTime(60_001);

    await expect(service.exchangeOAuthCode(code)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('still accepts a code just under the TTL', async () => {
    jest.useFakeTimers();
    const code = service.createOAuthExchangeCode(payload);

    jest.advanceTimersByTime(59_000);

    await expect(service.exchangeOAuthCode(code)).resolves.toBe(
      'fake.jwt.token',
    );
  });

  it('issues a different code on every call, even for the same payload', () => {
    const codeA = service.createOAuthExchangeCode(payload);
    const codeB = service.createOAuthExchangeCode(payload);

    expect(codeA).not.toBe(codeB);
  });
});

describe('AuthService — register/login/getProfile', () => {
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

  describe('getProfile', () => {
    it('returns the profile shape for an existing user', async () => {
      const findFirst = jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        role: 'admin',
        name: 'Test User',
        avatarUrl: null,
        githubId: 'gh-1',
      });
      const service = createService(findFirst);

      const profile = await service.getProfile('user-1');

      expect(profile).toEqual({
        sub: 'user-1',
        email: 'user@example.com',
        role: 'admin',
        name: 'Test User',
        avatarUrl: null,
        githubId: 'gh-1',
      });
    });

    it('throws NotFoundException for a user that does not exist', async () => {
      const findFirst = jest.fn().mockResolvedValue(undefined);
      const service = createService(findFirst);

      await expect(service.getProfile('missing-user')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
