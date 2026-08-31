import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { EDGE_SECRET_HEADER, EdgeOriginGuard } from './edge-origin.guard';

function contextWithHeaders(
  headers: Record<string, string | string[]>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('EdgeOriginGuard', () => {
  const SECRET = 'a-long-enough-shared-secret';

  it('passes everything through when no secret is configured', () => {
    // Local development, the e2e suite, and any deployment with nothing in
    // front of it. Direct access is legitimate precisely because there is no
    // edge to have come through.
    const guard = new EdgeOriginGuard(undefined);

    expect(guard.canActivate(contextWithHeaders({}))).toBe(true);
  });

  it('accepts a request carrying the configured secret', () => {
    const guard = new EdgeOriginGuard(SECRET);

    expect(
      guard.canActivate(contextWithHeaders({ [EDGE_SECRET_HEADER]: SECRET })),
    ).toBe(true);
  });

  it('rejects a request that reached the origin directly', () => {
    // The whole point: a function URL is publicly resolvable, so this is the
    // only thing standing between the internet and the origin.
    const guard = new EdgeOriginGuard(SECRET);

    expect(() => guard.canActivate(contextWithHeaders({}))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a wrong secret of the same length', () => {
    const guard = new EdgeOriginGuard(SECRET);
    const wrong = 'b'.repeat(SECRET.length);

    expect(() =>
      guard.canActivate(contextWithHeaders({ [EDGE_SECRET_HEADER]: wrong })),
    ).toThrow(ForbiddenException);
  });

  it('rejects a wrong secret of a different length', () => {
    // The length check exists so timingSafeEqual is never handed mismatched
    // buffers, where it throws instead of returning false.
    const guard = new EdgeOriginGuard(SECRET);

    expect(() =>
      guard.canActivate(contextWithHeaders({ [EDGE_SECRET_HEADER]: 'short' })),
    ).toThrow(ForbiddenException);
  });

  it('rejects a repeated header, which arrives as an array', () => {
    // Sending the header twice is the obvious way to try smuggling a value
    // past a comparison that assumes a string.
    const guard = new EdgeOriginGuard(SECRET);

    expect(() =>
      guard.canActivate(
        contextWithHeaders({ [EDGE_SECRET_HEADER]: [SECRET, SECRET] }),
      ),
    ).toThrow(ForbiddenException);
  });
});
