import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { createTestApp } from './utils/create-test-app';

// Its own file/app instance (fresh ThrottlerStorage) so its 6 login
// attempts don't eat into the /auth/login budget the functional tests in
// auth.e2e-spec.ts rely on.
describe('Rate limiting (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('throttles /auth/login after 5 attempts within the window', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nonexistent@example.com', password: 'wrong' });

    const results = await Promise.all(
      Array.from({ length: 6 }, () => attempt()),
    );
    const statuses = results.map((r) => r.status).sort();

    // 5 requests get a real answer (401, invalid credentials); the 6th is
    // throttled (429) regardless of arrival order under concurrency.
    expect(statuses.filter((s) => s === 429).length).toBe(1);
    expect(statuses.filter((s) => s === 401).length).toBe(5);
  });

  it('does not throttle GET /posts at the same volume (separate, more generous bucket)', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app.getHttpServer()).get('/posts'),
      ),
    );

    expect(results.every((r) => r.status === 200)).toBe(true);
  });
});
