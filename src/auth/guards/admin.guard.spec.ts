import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

function createContext(user?: Partial<JwtPayload>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  it('allows a request from an admin user', () => {
    const context = createContext({ role: 'admin' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a request from a regular user', () => {
    const context = createContext({ role: 'user' });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects a request with no user at all', () => {
    const context = createContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
