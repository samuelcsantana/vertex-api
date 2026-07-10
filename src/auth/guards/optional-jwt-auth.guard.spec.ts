import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import { DatabaseService } from '../../database/database.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

function createContext(cookies: Record<string, string> = {}) {
  const request: {
    cookies: Record<string, string>;
    user?: JwtPayload;
  } = { cookies };

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('OptionalJwtAuthGuard', () => {
  const payload: JwtPayload = {
    sub: 'user-1',
    email: 'user@example.com',
    role: 'admin',
    name: 'Test User',
    avatarUrl: null,
  };

  function createGuard(options: {
    verifyAsync?: jest.Mock;
    findFirst?: jest.Mock;
  }) {
    const verifyAsync =
      options.verifyAsync ?? jest.fn().mockResolvedValue(payload);
    const findFirst =
      options.findFirst ?? jest.fn().mockResolvedValue({ isBanned: false });

    const jwtService = { verifyAsync } as unknown as JwtService;
    const databaseService = {
      db: { query: { users: { findFirst } } },
    } as unknown as DatabaseService;

    return new OptionalJwtAuthGuard(jwtService, databaseService);
  }

  it('passes an anonymous request through without identifying it', async () => {
    const guard = createGuard({});
    const { context, request } = createContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('treats an invalid/expired token as anonymous instead of rejecting', async () => {
    const verifyAsync = jest.fn().mockRejectedValue(new Error('bad token'));
    const guard = createGuard({ verifyAsync });
    const { context, request } = createContext({ access_token: 'garbage' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('treats a banned user as anonymous — no moderation enrichment for them', async () => {
    const findFirst = jest.fn().mockResolvedValue({ isBanned: true });
    const guard = createGuard({ findFirst });
    const { context, request } = createContext({
      access_token: 'valid.jwt.token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('identifies a valid, non-banned session', async () => {
    const guard = createGuard({});
    const { context, request } = createContext({
      access_token: 'valid.jwt.token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(payload);
  });
});
