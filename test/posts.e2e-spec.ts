import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TestingModule } from '@nestjs/testing';
import { like } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp } from './utils/create-test-app';
import { createAdminUser, createAuthenticatedUser } from './utils/auth-helpers';
import { DatabaseService } from '../src/database/database.service';
import { posts, users } from '../src/database/schema';

const uniqueSlug = (label: string) =>
  `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe('Posts (e2e)', () => {
  let app: NestFastifyApplication;
  let moduleFixture: TestingModule;

  beforeAll(async () => {
    ({ app, moduleFixture } = await createTestApp());
  });

  afterAll(async () => {
    const databaseService = moduleFixture.get(DatabaseService);
    // Posts first: authorId references users with the default (restrictive)
    // FK behavior, so an e2e author row can't be deleted while it still has
    // posts pointing at it.
    await databaseService.db.delete(posts).where(like(posts.slug, 'e2e-%'));
    await databaseService.db
      .delete(users)
      .where(like(users.email, 'e2e-%@example.com'));

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

  describe('authenticated but non-admin', () => {
    it('POST /posts rejects a logged-in user who is not an admin', async () => {
      const { cookie } = await createAuthenticatedUser(
        app,
        moduleFixture,
        'poster',
      );

      const response = await request(app.getHttpServer())
        .post('/posts')
        .set('Cookie', cookie)
        .send({
          title: 'Hijacked',
          slug: uniqueSlug('nonadmin'),
          content: 'x',
        });

      expect(response.status).toBe(403);
    });
  });

  describe('admin happy path', () => {
    it('creates, reads, updates, and deletes a post end to end', async () => {
      const { cookie } = await createAdminUser(app, moduleFixture, 'poster');
      const slug = uniqueSlug('happy-path');

      const createResponse = await request(app.getHttpServer())
        .post('/posts')
        .set('Cookie', cookie)
        .send({
          title: 'E2E Post',
          slug,
          content: 'Body',
          isPublished: true,
        });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body).toMatchObject({ title: 'E2E Post', slug });
      const postId = (createResponse.body as { id: string }).id;

      const readResponse = await request(app.getHttpServer()).get(
        `/posts/${slug}`,
      );
      expect(readResponse.status).toBe(200);
      expect(readResponse.body).toMatchObject({ id: postId });

      const updateResponse = await request(app.getHttpServer())
        .patch(`/posts/${postId}`)
        .set('Cookie', cookie)
        .send({ title: 'E2E Post Updated' });
      expect(updateResponse.status).toBe(200);
      expect((updateResponse.body as { title: string }).title).toBe(
        'E2E Post Updated',
      );

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/posts/${postId}`)
        .set('Cookie', cookie);
      expect(deleteResponse.status).toBe(200);

      const afterDeleteResponse = await request(app.getHttpServer()).get(
        `/posts/${slug}`,
      );
      expect(afterDeleteResponse.status).toBe(404);
    });
  });

  describe('GET /dashboard/posts', () => {
    it('rejects an unauthenticated request', async () => {
      const response = await request(app.getHttpServer()).get(
        '/dashboard/posts',
      );

      expect(response.status).toBe(401);
    });

    it('rejects a logged-in user who is not an admin', async () => {
      const { cookie } = await createAuthenticatedUser(
        app,
        moduleFixture,
        'dashboard-viewer',
      );

      const response = await request(app.getHttpServer())
        .get('/dashboard/posts')
        .set('Cookie', cookie);

      expect(response.status).toBe(403);
    });

    it('includes unpublished posts for an admin, unlike the public listing', async () => {
      const { cookie } = await createAdminUser(app, moduleFixture, 'dashboard');
      const slug = uniqueSlug('unpublished');

      await request(app.getHttpServer())
        .post('/posts')
        .set('Cookie', cookie)
        .send({
          title: 'E2E Draft',
          slug,
          content: 'Body',
          isPublished: false,
        });

      const dashboardResponse = await request(app.getHttpServer())
        .get('/dashboard/posts')
        .set('Cookie', cookie);
      expect(dashboardResponse.status).toBe(200);
      expect(
        (dashboardResponse.body as { slug: string }[]).some(
          (post) => post.slug === slug,
        ),
      ).toBe(true);

      const publicResponse = await request(app.getHttpServer()).get(
        `/posts/${slug}`,
      );
      expect(publicResponse.status).toBe(404);
    });
  });
});
