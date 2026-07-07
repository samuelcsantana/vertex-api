import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
