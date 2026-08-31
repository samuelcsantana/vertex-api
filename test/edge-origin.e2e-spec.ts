import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { createTestApp } from './utils/create-test-app';

// The unit spec covers the comparison. What this one covers is the wiring:
// that the guard is actually global, that it runs for a route nobody
// decorated, and that it turns a direct hit into a 403 rather than being a
// class nothing ever calls. Every other e2e spec in this suite runs with the
// secret unset, which is also the assertion that the default stays open.
describe('Edge origin guard (e2e)', () => {
  let app: NestFastifyApplication;
  const SECRET = 'e2e-edge-shared-secret';

  beforeAll(async () => {
    // Read by the APP_GUARD factory when the module is instantiated, so it has
    // to be set before the app is built.
    process.env.EDGE_SHARED_SECRET = SECRET;
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    delete process.env.EDGE_SHARED_SECRET;
    await app.close();
  });

  it('refuses a request that reached the origin directly', async () => {
    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(403);
  });

  it('serves a request carrying the shared secret', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('x-edge-secret', SECRET);

    expect(response.status).toBe(200);
  });

  it('refuses a request carrying the wrong secret', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('x-edge-secret', 'not-the-secret');

    expect(response.status).toBe(403);
  });
});
