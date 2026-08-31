import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { createTestApp } from './utils/create-test-app';

// Proves the fix through the real stack rather than through the function that
// implements it. The unit spec can be entirely right about which address to
// pick while the option that installs it is wired wrong, and the two look
// identical from the outside — a rate limit that quietly counts the wrong
// thing still returns 200s.
//
// Its own app instance, like rate-limiting.e2e-spec.ts, so its attempts do not
// eat the /auth/login budget other specs rely on.
describe('Rate limit tracking behind a CDN (e2e)', () => {
  let app: NestFastifyApplication;
  const SECRET = 'e2e-edge-shared-secret';

  // What an attacker controls: CloudFront appends to X-Forwarded-For rather
  // than replacing it, so this value survives to the origin and is what
  // request.ip resolves to. Identical on every request below.
  const FORGED_FORWARDED_FOR = '9.9.9.9';

  beforeAll(async () => {
    // Read when the module is built, so it has to be set beforehand.
    process.env.EDGE_SHARED_SECRET = SECRET;
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    delete process.env.EDGE_SHARED_SECRET;
    await app.close();
  });

  const login = (viewerAddress: string) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .set('x-edge-secret', SECRET)
      .set('x-forwarded-for', FORGED_FORWARDED_FOR)
      .set('cloudfront-viewer-address', viewerAddress)
      .send({ email: 'nonexistent@example.com', password: 'wrong' });

  it('spends one viewer budget without touching another behind the same forged header', async () => {
    // Six from one viewer: five answered, the sixth throttled — the limit
    // still works.
    const spent = await Promise.all(
      Array.from({ length: 6 }, () => login('198.51.100.9:53124')),
    );
    const statuses = spent.map((r) => r.status);

    expect(statuses.filter((s) => s === 429).length).toBe(1);
    expect(statuses.filter((s) => s === 401).length).toBe(5);

    // A different viewer, same forged X-Forwarded-For. Before this change
    // both were counted as 9.9.9.9 and this request would have been the
    // seventh of one budget; now it is the first of its own.
    const other = await login('203.0.113.7:41000');

    expect(other.status).toBe(401);
  });

  it('never reaches the limiter at all without the shared secret', async () => {
    // A viewer address offered by someone who did not come through the CDN is
    // the bypass this whole mechanism would otherwise create: the origin is
    // publicly resolvable, so anyone reaching it directly could name their own
    // viewer and mint themselves a fresh budget per request.
    //
    // Two independent things stop that, and this asserts the outer one.
    // EdgeOriginGuard turns the request away before any counting happens, so
    // what comes back is 403 rather than a rate-limit answer. The inner one —
    // the tracker refusing to believe a viewer address that arrives without
    // the secret, even if it is somehow handed one — is covered in
    // client-tracker.spec.ts, and matters precisely because it does not depend
    // on the guard still running first.
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-forwarded-for', '7.7.7.7')
      .set('cloudfront-viewer-address', '198.51.100.42:1')
      .send({ email: 'nonexistent@example.com', password: 'wrong' });

    expect(response.status).toBe(403);
  });
});
