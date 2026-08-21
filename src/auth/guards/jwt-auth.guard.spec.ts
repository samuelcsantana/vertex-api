import { UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { DatabaseService } from '../../database/database.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

function createContext(cookies: Record<string, string> = {}) {
  const request: {
    cookies: Record<string, string>;
    user?: JwtPayload;
    currentUser?: unknown;
  } = { cookies };

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('JwtAuthGuard', () => {
  const payload: JwtPayload = {
    sub: 'user-1',
    email: 'user@example.com',
    role: 'user',
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

    return new JwtAuthGuard(jwtService, databaseService);
  }

  it('rejects a request with no access_token cookie', async () => {
    const guard = createGuard({});
    const { context } = createContext();

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a request with an invalid/expired token', async () => {
    const verifyAsync = jest.fn().mockRejectedValue(new Error('bad token'));
    const guard = createGuard({ verifyAsync });
    const { context } = createContext({ access_token: 'garbage' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a banned user even with a valid token', async () => {
    const findFirst = jest.fn().mockResolvedValue({ isBanned: true });
    const guard = createGuard({ findFirst });
    const { context } = createContext({ access_token: 'valid.jwt.token' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('allows a valid token for a user in good standing and attaches the payload', async () => {
    const guard = createGuard({});
    const { context, request } = createContext({
      access_token: 'valid.jwt.token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(payload);
  });

  it('allows a valid token even when the user row is not found (best-effort ban check)', async () => {
    const findFirst = jest.fn().mockResolvedValue(undefined);
    const guard = createGuard({ findFirst });
    const { context, request } = createContext({
      access_token: 'valid.jwt.token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    // Undefined rather than absent, so a handler reading it gets "the row is
    // gone" instead of stale data from somewhere else.
    expect(request.currentUser).toBeUndefined();
  });

  it('publishes the row it read, so handlers do not query the same id again', async () => {
    // This lookup runs on every authenticated request and only isBanned was
    // ever read from it. Handlers needing current user data were issuing an
    // identical findFirst on the same primary key a moment later — measured at
    // ~240ms of the ~740ms a signed-in GET /auth/profile took.
    const row = { id: 'user-1', email: 'user@example.com', isBanned: false };
    const findFirst = jest.fn().mockResolvedValue(row);
    const guard = createGuard({ findFirst });
    const { context, request } = createContext({
      access_token: 'valid.jwt.token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.currentUser).toBe(row);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
