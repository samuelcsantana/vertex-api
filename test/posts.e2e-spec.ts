import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { createTestApp } from './utils/create-test-app';

describe('Posts (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /posts is public and returns an array', async () => {
    const response = await request(app.getHttpServer()).get('/posts');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('GET /posts/:slug 404s for a slug that does not exist', async () => {
    const response = await request(app.getHttpServer()).get(
      '/posts/this-slug-does-not-exist-e2e',
    );

    expect(response.status).toBe(404);
  });

  it('POST /posts rejects an unauthenticated request', async () => {
    const response = await request(app.getHttpServer())
      .post('/posts')
      .send({ title: 'Hijacked post', slug: 'hijacked', content: 'x' });

    expect(response.status).toBe(401);
  });

  it('PATCH /posts/:id rejects an unauthenticated request', async () => {
    const response = await request(app.getHttpServer())
      .patch('/posts/00000000-0000-0000-0000-000000000000')
      .send({ title: 'Hijacked' });

    expect(response.status).toBe(401);
  });

  it('DELETE /posts/:id rejects an unauthenticated request', async () => {
    const response = await request(app.getHttpServer()).delete(
      '/posts/00000000-0000-0000-0000-000000000000',
    );

    expect(response.status).toBe(401);
  });
});
